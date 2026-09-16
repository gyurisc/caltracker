import { Bot, type Context, InlineKeyboard } from 'grammy'
import { addDays, PORT, TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID, lastDays, localDate } from '../config.ts'
import {
  deleteFood, foodsOn, foodsWithName, getDay, getSettings, mostRecentFood, setActivity, setSteps,
  setWaist, setWeight, totalsFor,
} from '../db.ts'
import { formatFoodCommand, parseAliasCommand, parseFoodCommand } from '../foodcmd.ts'
import { bareFoodName } from '../parse.ts'
import { nearMatches } from '../similar.ts'
import { activityLabel, deriveKcal, normalizeActivity, targetKcal } from '../nutrition.ts'
import { round1 } from '../nutrition.ts'
import {
  calibrationReport, n, todayLine, todayReport, visionReport, vocabReport, waistReport,
  whoopReport,
} from '../report.ts'
import { isWithinUndoWindow, logText, UNDO_WINDOW_HOURS } from '../service.ts'
import { addAlias, findFood, removeFood, saveFood, vocabTable } from '../vocab.ts'
import { latestMeal, put as putPending, replace as replacePending, take as takePending } from '../pending.ts'
import { parseCorrection, targetIndex } from '../correction.ts'
import { prepareImage, readPrepared, type VisionItem } from '../vision.ts'
import { deletePhoto, readPhoto as readStoredPhoto, savePhoto } from '../photos.ts'
import { askCoach, forget, historyFor, remember } from '../coach.ts'
import {
  configured as whoopConfigured, connected as whoopConnected,
  forgetTokens as forgetWhoop, syncRecent as syncWhoop,
} from '../whoop.ts'
import { addFoods, logEvent } from '../db.ts'
import { scaleTo } from '../parse.ts'

/** Telegram rejects anything over 4096 characters, so long reports go in parts. */
const TELEGRAM_LIMIT = 3900

function chunk(text: string): string[] {
  if (text.length <= TELEGRAM_LIMIT) return [text]
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > TELEGRAM_LIMIT) {
      parts.push(current)
      current = ''
    }
    current = current ? `${current}\n${line}` : line
  }
  if (current) parts.push(current)
  return parts
}

async function replyLong(ctx: { reply: (t: string) => Promise<unknown> }, text: string): Promise<void> {
  for (const part of chunk(text)) await ctx.reply(part)
}

/** Largest thumbnail Telegram offers; the server resizes it anyway. */
async function downloadPhoto(ctx: {
  message?: { photo?: { file_id: string }[] }
  getFile: () => Promise<{ file_path?: string }>
}): Promise<Buffer | null> {
  const sizes = ctx.message?.photo
  if (!sizes?.length) return null
  const file = await ctx.getFile()
  if (!file.file_path) return null
  const res = await fetch(
    `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`,
    { signal: AbortSignal.timeout(30_000) },
  )
  if (!res.ok) return null
  return Buffer.from(await res.arrayBuffer())
}

/**
 * A name the table already knows keeps the table's macros — those are chosen or
 * measured, and the model's portion guess is the only part worth borrowing.
 */
/**
 * One renderer for the confirm card, because a correction rewrites the same
 * message the photo produced. Each line says where its weight came from, so it
 * is visible at a glance which numbers are measured and which are guessed —
 * the same job the `~` marker does in the daily log.
 */
/**
 * A weight typed while a photo card is open corrects that card instead of
 * logging a new meal — but only when it plainly refers to a row already there.
 * Anything ambiguous falls through to normal logging, because swallowing a real
 * meal into a card edit would be a silent loss, the failure this app guards
 * against everywhere else.
 *
 * Returns true when the message was consumed as a correction.
 */
async function applyCorrection(ctx: Context, text: string): Promise<boolean> {
  const chatId = ctx.chat?.id
  if (chatId == null) return false

  const parsed = parseCorrection(text)
  if (!parsed) return false

  const found = latestMeal(chatId)
  if (!found || found.pending.kind !== 'meal') return false

  const { items, note: caveat, messageId } = found.pending
  const idx = targetIndex(parsed, items.map((i) => i.name))
  if (idx === -1) return false

  const before = items[idx]!
  const food = findFood(before.name)
  const scaled = food ? scaleTo(food, parsed.grams, before.cooked) : null

  // Off the table there are no per-gram macros to rescale from, so scale what
  // the model gave by the ratio of the weights. Crude, but it beats leaving a
  // corrected weight sitting beside uncorrected macros.
  const ratio = before.grams && before.grams > 0 ? parsed.grams / before.grams : 1
  const macros = scaled ?? {
    proteinG: round1(before.proteinG * ratio),
    carbsG: round1(before.carbsG * ratio),
    fatG: round1(before.fatG * ratio),
    kcal: Math.round(before.kcal * ratio),
  }

  const after: VisionItem = {
    ...before, ...macros,
    grams: parsed.grams,
    correctedFrom: before.correctedFrom ?? before.grams,
    kcalDisputed: false,
  }
  const next = items.map((i, k) => (k === idx ? after : i))
  replacePending(found.key, { ...found.pending, items: next })

  logEvent('vision', {
    action: 'corrected',
    name: before.name,
    proposedGrams: after.correctedFrom,
    actualGrams: parsed.grams,
    countPath: before.count != null && Boolean(food),
    matched: Boolean(food),
  })

  await ctx.api.editMessageText(chatId, messageId, mealCard(next, caveat), {
    reply_markup: new InlineKeyboard()
      .text('Log it', `log:${found.key}`)
      .text('Cancel', `no:${found.key}`),
  })
  await ctx.reply(`${before.name} → ${parsed.grams}g. tap Log it when the card is right.`)
  return true
}

export function mealCard(items: VisionItem[], caveat: string | null): string {
  const kcal = items.reduce((s, i) => s + i.kcal, 0)
  const protein = items.reduce((s, i) => s + i.proteinG, 0)
  const missing = items.filter((i) => !findFood(i.name))

  return [
    `photo · ${items.length} item${items.length === 1 ? '' : 's'}`,
    '',
    ...items.map((i) => {
      const known = Boolean(findFood(i.name))
      return `${known ? ' ' : '~'} ${i.name} ${i.grams ?? '?'}g · ` +
        `${i.proteinG.toFixed(0)}g P · ${n(i.kcal)} kcal` +
        (i.correctedFrom != null
          ? `  (you weighed it; I guessed ${i.correctedFrom}g)`
          : i.gramsStated ? '  (weight you gave)'
          : i.count != null && known ? `  (${i.count} × your weighing)`
          : known ? '' : '  (not in your table)')
    }),
    '',
    `${n(kcal)} kcal · ${protein.toFixed(0)} g P`,
    ...(caveat ? [caveat] : []),
    ...(missing.length
      ? ['', `${missing.length} not in your table — logged as an estimate, add later with /food`]
      : []),
    // Only offered where it would change something. Asking whether a weight was
    // weighed, when the weight came from the user in the first place, reads as
    // the card not having listened.
    ...(items.every((i) => i.gramsStated)
      ? []
      : [
          '',
          items.length === 1
            ? 'weighed it? send the grams and I will correct this'
            : 'weighed one? send e.g. `rice 180g` to correct that line',
        ]),
  ].join('\n')
}

/** What the model proposed, beside what the table made of it. */
function proposalRecord(proposed: VisionItem[], resolved: VisionItem[]) {
  return proposed.map((p, idx) => ({
    name: p.name,
    grams: p.grams,
    count: p.count,
    stated: p.gramsStated,
    resolvedName: resolved[idx]?.name ?? null,
    resolvedGrams: resolved[idx]?.grams ?? null,
    matched: Boolean(resolved[idx] && findFood(resolved[idx]!.name)),
  }))
}

export function resolveAgainstTable(item: VisionItem): {
  item: VisionItem
  known: boolean
  counted: boolean
} {
  const food = findFood(item.name)
  if (!food) return { item, known: false, counted: false }

  // A countable food the table holds per unit: take the model's COUNT and the
  // unit weight that was measured on a kitchen scale. That turns a portion
  // guess into arithmetic — one pancake is 20 g because it was weighed, not
  // because a photo looked like 30.
  // A weight the user stated, or one a scale in the photo showed, outranks the
  // unit weighing: today's pancake may not be the size of the one that was
  // weighed. Only an eyeballed gram figure gets replaced by arithmetic.
  const byCount =
    !item.gramsStated && food.basis === 'each' && food.unitGrams && item.count != null
      ? item.count * food.unitGrams
      : null

  const grams = byCount ?? item.grams
  if (grams == null) return { item, known: true, counted: false }

  const scaled = scaleTo(food, grams, item.cooked)
  if (!scaled) return { item, known: true, counted: false }
  return {
    known: true,
    counted: byCount != null,
    item: { ...item, name: food.key, grams, ...scaled, kcalDisputed: false },
  }
}

export function createBot(): Bot {
  // grammY defaults to a 500 s API timeout, and polling is sequential, so one
  // slow call stalls every later update. 30 s is well past a normal round trip.
  const bot = new Bot(TELEGRAM_BOT_TOKEN, { client: { timeoutSeconds: 30 } })

  // Single allowlisted user (PRD §10). Everyone else is ignored, not answered.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== TELEGRAM_USER_ID) return
    await next()
  })

  bot.command('start', (ctx) => ctx.reply(`caltrack. ${todayLine()}\n/help for commands.`))

  bot.command('help', (ctx) =>
    ctx.reply(
      [
        'Send food as text: `black coffee` · `minced meat 170g cooked` · `2 eggs, rice 200g`',
        '',
        '/today — eaten, target, items',
        '/foods · /foods cola — what I know, or search it',
        '/food kefir per100 p3.3 c4 f1 — teach me a food',
        '/unfood kefir — forget one',
        '/alias rizs = rice — another name for a food I know',
        '/week — last 7 days',
        '/coach — what to eat next, against today\'s log',
        '/waist 98 — waist in cm, weekly',
        '/whoop — sleep, recovery and strain (context, not a target)',
        '/trend — measured burn rate vs your targets',
        '/vision — how well photo reading is doing',
        '/weight 74.2 — morning weigh-in',
        '/activity rest|lift|cycle',
        '/steps 12000 — yesterday, from your phone',
        '/undo — remove the most recent item',
        '/undo milk · /undo 09:17 — remove any of today\'s',
        '/target — maintenance, deficit, goals',
        '',
        'Numbers are estimates, not medical advice.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    ),
  )

  bot.command('today', (ctx) => replyLong(ctx, todayReport()))

  bot.command('foods', (ctx) => replyLong(ctx, vocabReport((ctx.match ?? '').toString())))

  bot.command('trend', (ctx) => replyLong(ctx, calibrationReport()))

  bot.command('food', (ctx) => {
    const result = parseFoodCommand((ctx.match ?? '').toString())
    if (!result.ok) return ctx.reply(result.error)

    const { entry } = result
    // An alias that already belongs to a different food would shadow it, and
    // the longest-alias rule makes which one wins non-obvious. Refuse instead.
    const clash = vocabTable().entries.find(
      (e) => e.key !== entry.key && e.aliases.some((a) => entry.aliases.includes(a)),
    )
    if (clash) return ctx.reply(`"${entry.aliases.find((a) => clash.aliases.includes(a))}" already belongs to ${clash.key}`)

    const known = vocabTable().entries.some((e) => e.key === entry.key)
    // Not fatal — two genuinely similar foods are allowed — but a near-duplicate
    // is usually a typo, and a silent second row is hard to notice later.
    const nearby = known ? [] : nearMatches(entry.key, vocabTable().entries.map((e) => e.key), 1)
    saveFood(entry)

    const m = entry.raw!
    const kcal = deriveKcal(m.proteinG, m.carbsG, m.fatG)
    const per = entry.basis === 'each' ? `each ${entry.unitGrams} g` : 'per 100 g'
    // Echo what was actually stored. A /food line replaces the whole row, so the
    // serving and the aliases are exactly what you cannot otherwise verify.
    const serving = entry.basis === 'each'
      ? `1 = ${entry.unitGrams} g`
      : `serving ${entry.defaultGrams ?? 100} g${entry.defaultGrams ? '' : ' (default)'}`
    const also = entry.aliases.filter((a) => a !== entry.key)

    return ctx.reply(
      [
        `${known ? 'updated' : 'added'} ${entry.key} · ${per}`,
        `${n(kcal)} kcal · ${m.proteinG} g P · ${m.carbsG} g C · ${m.fatG} g F`,
        `${serving} · ${entry.defaultState}`,
        `also: ${also.length ? also.join(', ') : 'no other names'}`,
        entry.provenance === 'measured' ? 'measured — no ~' : 'estimate — shows ~',
        ...(nearby.length ? ['', `note: very close to "${nearby[0]}" — a typo? /foods to check`] : []),
        '',
        `try: ${entry.key}${entry.basis === 'per100g' && !entry.defaultGrams ? ' 100g' : ''}`,
      ].join('\n'),
    )
  })

  bot.command('vision', (ctx) => replyLong(ctx, visionReport()))

  bot.command('alias', (ctx) => {
    const parsed = parseAliasCommand((ctx.match ?? '').toString())
    if (!parsed.ok) return ctx.reply(parsed.error)
    const { alias, target } = parsed

    const food = findFood(target)
    if (!food) {
      const near = nearMatches(target, vocabTable().entries.flatMap((e) => e.aliases), 3)
      return ctx.reply(
        [
          `I do not know a food called "${target}"`,
          ...(near.length ? [`did you mean: ${[...new Set(near)].join(', ')}?`] : []),
          'the right-hand side has to be a food I already know · /foods lists them',
        ].join('\n'),
      )
    }

    // An alias owned by something else would shadow it, and the longest-alias
    // rule makes which one wins non-obvious. Refuse rather than guess.
    const owner = vocabTable().entries.find((e) => e.aliases.some((a) => a === alias))
    if (owner) {
      return ctx.reply(
        owner.key === food.key
          ? `${food.key} already answers to "${alias}"`
          : `"${alias}" already belongs to ${owner.key}`,
      )
    }

    const next = addAlias(alias, food)
    return ctx.reply(
      [
        `${food.key} now answers to "${alias}"`,
        `also: ${next.aliases.filter((a) => a !== food.key).join(', ')}`,
        '',
        `try: ${alias}${food.basis === 'per100g' ? ' 100g' : ''}`,
      ].join('\n'),
    )
  })

  bot.command('unfood', (ctx) => {
    const name = (ctx.match ?? '').toString().trim().toLowerCase()
    if (!name) return ctx.reply('usage: /unfood <name> — removes a food from the table')

    const entry = findFood(name)
    if (!entry) {
      const near = nearMatches(name, vocabTable().entries.flatMap((e) => e.aliases), 2)
      return ctx.reply(
        near.length ? `no food called "${name}"\ndid you mean: ${near.join(', ')}?` : `no food called "${name}"`,
      )
    }

    // Entries already written keep their own macros, so history is untouched.
    const logged = foodsWithName(entry.key)
    removeFood(entry.key)

    return ctx.reply(
      [
        `removed ${entry.key}`,
        logged
          ? `${logged} logged ${logged === 1 ? 'entry keeps its' : 'entries keep their'} numbers`
          : 'nothing was logged against it',
        '',
        'to put it back:',
        formatFoodCommand(entry),
      ].join('\n'),
    )
  })

  bot.command('week', (ctx) => {
    const s = getSettings()
    const dates = lastDays(7)
    const totals = totalsFor(dates)
    const rows = dates.map((d) => {
      const day = getDay(d)
      const t = totals[d]!
      const target = targetKcal(day.activity, s)
      const flag = t.kcal === 0 ? ' ' : t.kcal > target ? '!' : '.'
      return `${d.slice(5)} ${flag} ${String(n(t.kcal)).padStart(5)} / ${n(target)}   ${t.proteinG.toFixed(0).padStart(3)} g P`
    })
    ctx.reply(['last 7 days', ...rows].join('\n'))
  })

  bot.command('target', (ctx) => {
    const s = getSettings()
    const day = getDay(localDate())
    ctx.reply(
      [
        `today: ${activityLabel(day.activity)}`,
        `maintenance ${n(s.maintenance[day.activity])} − deficit ${n(s.deficit)} = ${n(targetKcal(day.activity, s))} kcal`,
        `protein goal ${s.proteinGoal} g`,
        '',
        `rest ${n(s.maintenance.rest)} · lift ${n(s.maintenance.lifting)} · cycle ${n(s.maintenance.cycling)}`,
      ].join('\n'),
    )
  })

  bot.command('weight', (ctx) => {
    const kg = Number((ctx.match ?? '').toString().replace(',', '.').trim())
    if (!Number.isFinite(kg) || kg <= 0 || kg > 400) return ctx.reply('usage: /weight 74.2')
    setWeight(localDate(), kg)
    return ctx.reply(`weight ${kg} kg · ${localDate()}`)
  })

  bot.command('coach', async (ctx) => {
    const question = (ctx.match ?? '').toString().trim()
    const chatId = ctx.chat.id
    // The model reasons for half a minute. A typing indicator lasts five
    // seconds, so without a placeholder the bot simply looks dead.
    const note = await ctx.reply('thinking about today…')

    const answer = await askCoach(question, historyFor(chatId))
    if (!answer.ok) {
      return ctx.api.editMessageText(note.chat.id, note.message_id, answer.error)
    }

    remember(chatId, [
      { role: 'user', content: question || 'How should I carry on eating today?' },
      { role: 'assistant', content: answer.text },
    ])
    // Edited in place when it fits; a long answer needs its own messages, so
    // the placeholder becomes the first of them.
    const parts = chunk(answer.text)
    await ctx.api.editMessageText(note.chat.id, note.message_id, parts[0]!, {
      parse_mode: 'Markdown',
    }).catch(() => ctx.api.editMessageText(note.chat.id, note.message_id, parts[0]!))
    for (const part of parts.slice(1)) await ctx.reply(part)
    return undefined
  })

  // A follow-up needs a clean slate sometimes — yesterday's thread advising on
  // yesterday's log is worse than starting over.
  bot.command('newcoach', (ctx) => {
    forget(ctx.chat.id)
    return ctx.reply('coach thread cleared. /coach starts fresh.')
  })

  /**
   * WHOOP is context, never a target input (PRD §17). The command shows what it
   * saw and pulls new days in; it does not touch the calorie goal.
   */
  bot.command('whoop', async (ctx) => {
    const arg = (ctx.match ?? '').toString().trim().toLowerCase()

    if (!whoopConfigured()) {
      return ctx.reply('no WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET in .env')
    }
    if (arg === 'connect' || !whoopConnected()) {
      return ctx.reply(
        [
          whoopConnected() ? 'reconnecting WHOOP' : 'WHOOP is not connected yet',
          '',
          `open this on the mac: http://localhost:${PORT}/api/whoop/start`,
        ].join('\n'),
      )
    }
    if (arg === 'disconnect') {
      forgetWhoop()
      return ctx.reply('WHOOP disconnected. /whoop connect to link it again.')
    }

    if (arg === 'sync' || arg === '') {
      // Yesterday as well as today: a night's sleep and its recovery only land
      // once the night is over, so today alone would usually show neither.
      const note = await ctx.reply('asking WHOOP…')
      const days = [addDays(localDate(), -1), localDate()]
      try {
        const { classified, errors: failures } = await syncWhoop(days.length)
        if (classified.length) {
          await ctx.reply(['whoop set the day:', ...classified].join('\n'))
        }
        // A read that failed and a day with nothing recorded look identical once
        // the numbers are blank, so the failure has to be said out loud.
        if (failures.length) {
          return ctx.api.editMessageText(
            note.chat.id, note.message_id,
            [whoopReport(), '', 'some of that did not load:', ...new Set(failures)].join('\n'),
          )
        }
      } catch (e) {
        return ctx.api.editMessageText(note.chat.id, note.message_id, (e as Error).message)
      }
      return ctx.api.editMessageText(note.chat.id, note.message_id, whoopReport())
    }

    return ctx.reply('usage: /whoop · /whoop sync · /whoop connect · /whoop disconnect')
  })

  bot.command('waist', (ctx) => {
    const cm = Number((ctx.match ?? '').toString().replace(',', '.').trim())
    if (!Number.isFinite(cm) || cm < 40 || cm > 200) return ctx.reply('usage: /waist 98')
    setWaist(localDate(), cm)
    return ctx.reply(waistReport())
  })

  bot.command('steps', (ctx) => {
    const arg = (ctx.match ?? '').toString().trim().toLowerCase()
    // Defaults to yesterday: a finished day has a final number, and this is a
    // morning habit alongside the weigh-in.
    const today = arg.endsWith('today')
    const date = today ? localDate() : addDays(localDate(), -1)
    const digits = arg.replace(/today|yesterday/g, '').replace(/[\s,._]/g, '')
    const steps = /^\d+k$/.test(digits) ? Number(digits.slice(0, -1)) * 1000 : Number(digits)

    if (!Number.isInteger(steps) || steps < 0 || steps > 200_000) {
      return ctx.reply('usage: /steps 12000 — yesterday by default, or /steps 12000 today')
    }
    setSteps(date, steps)
    return ctx.reply(`${n(steps)} steps · ${date}${today ? '' : ' (yesterday)'}`)
  })

  bot.command('activity', (ctx) => {
    const activity = normalizeActivity((ctx.match ?? '').toString())
    if (!activity) return ctx.reply('usage: /activity rest|lift|cycle')
    const day = setActivity(localDate(), activity)
    const s = getSettings()
    return ctx.reply(`${activityLabel(day.activity)} · target ${n(targetKcal(day.activity, s))} kcal`)
  })

  bot.command('undo', (ctx) => {
    const arg = (ctx.match ?? '').toString().trim().toLowerCase()

    // Bare /undo keeps the old rule: the most recent row overall, so a 00:15
    // undo still reaches last night's 23:50 meal, but nothing older than the
    // window. A targeted undo is explicit, so it may reach anything today.
    if (!arg) {
      const row = mostRecentFood()
      if (!row) return ctx.reply('nothing to undo')
      if (!isWithinUndoWindow(row)) {
        return ctx.reply(
          [
            `nothing recent to undo (older than ${UNDO_WINDOW_HOURS} h)`,
            'name it instead: /undo milk · /undo 09:17',
          ].join('\n'),
        )
      }
      deleteFood(row.id)
      return ctx.reply(`− ${row.name} · ${n(row.kcal)} kcal · ${todayLine()}`)
    }

    const today = foodsOn(localDate())
    if (today.length === 0) return ctx.reply('nothing logged today')

    const byTime = /^\d{1,2}:\d{2}$/.test(arg)
      ? today.filter((f) => f.time === arg.padStart(5, '0'))
      : []
    const byName = byTime.length
      ? []
      : today.filter((f) => f.name === arg || f.name.includes(arg))

    // Latest match wins: two coffees, /undo coffee removes the second.
    const target = [...byTime, ...byName].at(-1)
    if (!target) {
      const near = nearMatches(arg, today.map((f) => f.name), 2)
      return ctx.reply(
        [
          `no "${arg}" in today's log`,
          ...(near.length ? [`did you mean: ${[...new Set(near)].join(', ')}?`] : []),
          '',
          ...today.map((f) => `${f.time}  ${f.name} · ${n(f.kcal)} kcal`),
        ].join('\n'),
      )
    }

    deleteFood(target.id)
    return ctx.reply(`− ${target.name} ${target.time} · ${n(target.kcal)} kcal · ${todayLine()}`)
  })

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim()
    if (text.startsWith('/')) return ctx.reply('unknown command. /help')

    const corrected = await applyCorrection(ctx, text)
    if (corrected) return

    const result = logText(text)
    if (!result.ok) {
      if (result.implausible.length > 0) {
        // Nearly always a bare number read as a count: `whey 29` is 29 scoops.
        return ctx.reply(
          [
            `that comes to ${result.implausible.join(', ')} — too much for one item, so I did not log it.`,
            'a bare number is a count, not grams:',
            '',
            '29 whey  = 29 scoops',
            'whey 29g = 29 grams',
          ].join('\n'),
        )
      }
      if (result.needsState.length > 0) {
        const food = result.needsState[0]!
        return ctx.reply(
          [
            `${result.needsState.join(', ')}: say dry or cooked.`,
            'dry and cooked weigh about 3x apart, so I will not guess.',
            '',
            `${food} 200g dry`,
            `${food} 200g cooked`,
          ].join('\n'),
        )
      }
      if (result.unmatched.length === 0) return ctx.reply('nothing to log there.')
      const aliases = vocabTable().entries.flatMap((e) => e.aliases)
      const names = result.unmatched.map(bareFoodName).filter(Boolean).slice(0, 3)

      // A typo one letter from a known food gets a "did you mean", never a
      // template — offering to add `pespi` beside `pepsi` is worse than useless.
      // Words are compared too, so `zero cola` reaches `coca cola zero` and
      // `bodyselect why` reaches `bodyselect rizs`, which whole-string distance
      // never would.
      const suggestions = names.flatMap((name) => {
        const whole = nearMatches(name, aliases, 2)
        const words = name.split(' ').filter((w) => w.length > 2)
        const byWord = aliases.filter((alias) => {
          const parts = alias.split(' ')
          return words.some((w) => parts.some((p) => p === w || nearMatches(w, [p], 1).length > 0))
        })
        return [...whole, ...byWord]
      })
      if (suggestions.length) {
        return ctx.reply(
          [
            `not in the local table: ${result.unmatched.join(', ')}`,
            '',
            `did you mean: ${[...new Set(suggestions)].join(', ')}?`,
          ].join('\n'),
        )
      }

      // Otherwise hand back a ready /food line: editing three numbers beats
      // retyping the meal, and it is how a food gets added now.
      return ctx.reply(
        [
          `not in the local table: ${result.unmatched.join(', ')}`,
          ...(names.length
            ? ['', 'add it with the packet macros:', ...names.map((name) => `/food ${name} per100 p? c? f?`)]
            : []),
          '',
          '/foods lists what I know',
        ].join('\n'),
      )
    }
    const kcal = result.rows.reduce((s, r) => s + r.kcal, 0)
    const names = result.rows.map((r) => r.name).join(', ')
    return ctx.reply(`+ ${names} · ${n(kcal)} kcal · ${todayLine()}`)
  })

  bot.on('message:photo', async (ctx) => {
    const note = await ctx.reply('reading the photo…')
    try {
      return await readPhotoInto(ctx, note)
    } catch (e) {
      // Whatever went wrong, the placeholder must not be left saying "reading".
      // A card that never resolves is indistinguishable from a wedged bot.
      console.error('[bot] photo', e)
      logEvent('error', { kind: 'vision_fail', error: String((e as Error).message ?? e) })
      return ctx.api.editMessageText(
        note.chat.id, note.message_id,
        `that photo failed: ${(e as Error).message ?? e}`,
      )
    }
  })

  async function readPhotoInto(ctx: Context, note: { chat: { id: number }; message_id: number }) {
    const image = await downloadPhoto(ctx)
    if (!image) return ctx.api.editMessageText(note.chat.id, note.message_id, 'could not fetch that photo')

    // Stored before the read, because these are the bytes the model sees and
    // the bytes worth keeping. A card that is dropped takes its photo with it.
    let jpeg: Buffer
    try {
      jpeg = await prepareImage(image)
    } catch (e) {
      return ctx.api.editMessageText(note.chat.id, note.message_id, (e as Error).message)
    }
    const photoId = await savePhoto(localDate(), jpeg)

    // A caption that is already a complete log line needs no model at all. The
    // user's own weight beats any portion estimate, the table's macros beat any
    // guess, and it costs nothing and takes no time. The photo still gets kept
    // and attached — it is evidence for the entry, not a question about it.
    const caption = ctx.message?.caption?.trim() ?? ''
    if (caption) {
      const direct = logText(caption, { photoId })
      if (direct.ok) {
        const kcal = direct.rows.reduce((sum, r) => sum + r.kcal, 0)
        const key = putPending({
          kind: 'logged',
          photoId,
          ids: direct.rows.map((r) => r.id),
          caption,
          chatId: note.chat.id,
          messageId: note.message_id,
        })
        return ctx.api.editMessageText(
          note.chat.id, note.message_id,
          [
            `+ ${direct.rows.map((r) => r.name).join(', ')} · ${n(kcal)} kcal · ${todayLine()}`,
            '',
            'read from your caption, photo kept — no guessing needed',
          ].join('\n'),
          { reply_markup: new InlineKeyboard().text('Read the photo instead', `look:${key}`) },
        )
      }
    }

    const known = vocabTable().entries.map((e) => e.key)
    const result = await readPrepared(jpeg, caption || null, undefined, known)
    if (!result.ok) {
      logEvent('error', { kind: 'vision_fail', error: result.error })
      return ctx.api.editMessageText(note.chat.id, note.message_id, result.error)
    }

    if (result.read.kind === 'label') {
      const l = result.read
      const key = putPending({ kind: 'label', label: l, photoId })
      logEvent('vision', {
        action: 'proposed',
        card: 'label',
        name: l.name,
        basis: l.basis,
        kcal: l.kcal,
        kcalDisputed: l.kcalDisputed,
        alreadyKnown: Boolean(findFood(l.name)),
      })
      const per = l.basis === 'each' ? `each ${l.unitGrams ?? '?'} g` : 'per 100 g'
      return ctx.api.editMessageText(
        note.chat.id, note.message_id,
        [
          `label · ${l.name} · ${per}`,
          `${n(l.kcal)} kcal · ${l.proteinG} g P · ${l.carbsG} g C · ${l.fatG} g F`,
          ...(l.fibreG
          ? [`fibre ${l.fibreG} g · counting half of it as carbs, which is what makes the energy match`]
          : []),
          ...(l.kcalDisputed ? ['the printed energy disagrees with the macros; keeping the macros'] : []),
          '',
          'add it to your table?',
        ].join('\n'),
        { reply_markup: new InlineKeyboard().text('Add food', `add:${key}`).text('Cancel', `no:${key}`) },
      )
    }

    const { items, note: caveat } = result.read
    const resolved = items.map(resolveAgainstTable).map((r) => r.item)
    const key = putPending({
      kind: 'meal',
      items: resolved,
      note: caveat,
      chatId: note.chat.id,
      messageId: note.message_id,
      proposed: items,
      photoId,
    })
    logEvent('vision', {
      action: 'proposed',
      card: 'meal',
      items: proposalRecord(items, resolved),
    })

    return ctx.api.editMessageText(
      note.chat.id, note.message_id, mealCard(resolved, caveat),
      { reply_markup: new InlineKeyboard().text('Log it', `log:${key}`).text('Cancel', `no:${key}`) },
    )
  }

  bot.on('callback_query:data', async (ctx) => {
    const [action, key] = ctx.callbackQuery.data.split(':')
    if (!key) return ctx.answerCallbackQuery('unknown button')

    // The caption logged something, but the photo was about something else.
    // Withdraw those rows and read the plate after all.
    if (action === 'look') {
      const held = takePending(key)
      if (!held || held.kind !== 'logged') {
        await ctx.editMessageText('that card expired — send the photo again')
        return ctx.answerCallbackQuery('expired')
      }
      for (const id of held.ids) deleteFood(id)
      await ctx.editMessageText('reading the photo…')
      await ctx.answerCallbackQuery('reading')

      const jpeg = readStoredPhoto(held.photoId)
      if (!jpeg) return ctx.editMessageText('that photo is gone — send it again')

      const known = vocabTable().entries.map((e) => e.key)
      const reread = await readPrepared(jpeg, held.caption, undefined, known)
      if (!reread.ok) return ctx.editMessageText(reread.error)
      if (reread.read.kind !== 'meal') {
        return ctx.editMessageText('that reads as a label, not a plate — send it on its own')
      }

      const resolved = reread.read.items.map(resolveAgainstTable).map((r) => r.item)
      const next = putPending({
        kind: 'meal',
        items: resolved,
        note: reread.read.note,
        chatId: held.chatId,
        messageId: held.messageId,
        proposed: reread.read.items,
        photoId: held.photoId,
      })
      logEvent('vision', {
        action: 'proposed',
        card: 'meal',
        items: proposalRecord(reread.read.items, resolved),
      })
      return ctx.editMessageText(mealCard(resolved, reread.read.note), {
        reply_markup: new InlineKeyboard()
          .text('Log it', `log:${next}`)
          .text('Cancel', `no:${next}`),
      })
    }

    if (action === 'no') {
      const dropped = takePending(key)
      if (dropped?.kind === 'meal') {
        logEvent('vision', {
          action: 'rejected',
          card: 'meal',
          items: dropped.items.map((i) => ({ name: i.name, grams: i.grams })),
        })
      } else if (dropped?.kind === 'label') {
        logEvent('vision', { action: 'rejected', card: 'label', name: dropped.label.name })
      }
      if (dropped?.photoId) deletePhoto(dropped.photoId)
      await ctx.editMessageText('dropped, nothing logged')
      return ctx.answerCallbackQuery('dropped')
    }

    const pending = takePending(key)
    if (!pending) {
      await ctx.editMessageText('that card expired — send the photo again')
      return ctx.answerCallbackQuery('expired')
    }

    if (action === 'add' && pending.kind === 'label') {
      const l = pending.label
      // An EU label's carbohydrate excludes fibre, but the fibre still carries
      // roughly 2 kcal/g. Half of it added to carbs is what makes 4/4/9 land on
      // the printed energy — 61 g on the rye thins derives 307 against 350.
      const carbsG = l.carbsG + (l.fibreG ? l.fibreG / 2 : 0)
      saveFood({
        key: l.name,
        aliases: [l.name],
        basis: l.basis,
        ...(l.basis === 'each' && l.unitGrams ? { unitGrams: l.unitGrams } : {}),
        defaultState: 'raw',
        provenance: 'measured',
        raw: { proteinG: l.proteinG, carbsG: round1(carbsG), fatG: l.fatG },
        photoId: pending.photoId ?? null,
      })
      const kcal = deriveKcal(l.proteinG, carbsG, l.fatG)
      logEvent('vision', { action: 'accepted', card: 'label', name: l.name, kcal })
      await ctx.editMessageText(
        [
          `added ${l.name} · ${n(kcal)} kcal per 100 g`,
          `${l.proteinG} g P · ${round1(carbsG)} g C · ${l.fatG} g F · measured`,
          '',
          `try: ${l.name} 100g`,
        ].join('\n'),
      )
      return ctx.answerCallbackQuery('added')
    }

    if (action === 'log' && pending.kind === 'meal') {
      const rows = addFoods(pending.items.map((i) => ({
        name: i.name,
        grams: i.grams,
        cooked: i.cooked,
        proteinG: i.proteinG,
        carbsG: i.carbsG,
        fatG: i.fatG,
        kcal: i.kcal,
        source: 'photo' as const,
        provenance: 'reference' as const,
        photoPath: pending.photoId ?? null,
      })))
      const total = rows.reduce((s, r) => s + r.kcal, 0)
      logEvent('log', { date: localDate(), text: 'photo', ids: rows.map((r) => r.id), kcal: total })
      logEvent('vision', {
        action: 'accepted',
        card: 'meal',
        items: pending.items.map((i) => ({
          name: i.name,
          grams: i.grams,
          proposedGrams: i.correctedFrom ?? i.grams,
          corrected: i.correctedFrom != null,
        })),
      })
      await ctx.editMessageText(
        `+ ${rows.map((r) => r.name).join(', ')} · ${n(total)} kcal · ${todayLine()}`,
      )
      return ctx.answerCallbackQuery('logged')
    }

    return ctx.answerCallbackQuery('that card no longer matches')
  })

  bot.catch((err) => console.error('[bot]', err.error))

  return bot
}
