import { Bot, InlineKeyboard } from 'grammy'
import { addDays, TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID, lastDays, localDate } from '../config.ts'
import {
  deleteFood, foodsOn, foodsWithName, getDay, getSettings, mostRecentFood, setActivity, setSteps,
  setWeight, totalsFor,
} from '../db.ts'
import { formatFoodCommand, parseAliasCommand, parseFoodCommand } from '../foodcmd.ts'
import { bareFoodName } from '../parse.ts'
import { nearMatches } from '../similar.ts'
import { activityLabel, deriveKcal, normalizeActivity, targetKcal } from '../nutrition.ts'
import { round1 } from '../nutrition.ts'
import { calibrationReport, n, todayLine, todayReport, vocabReport } from '../report.ts'
import { isWithinUndoWindow, logText, UNDO_WINDOW_HOURS } from '../service.ts'
import { addAlias, findFood, removeFood, saveFood, vocabTable } from '../vocab.ts'
import { put as putPending, take as takePending } from '../pending.ts'
import { readPhoto, type VisionItem } from '../vision.ts'
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
  const res = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`)
  if (!res.ok) return null
  return Buffer.from(await res.arrayBuffer())
}

/**
 * A name the table already knows keeps the table's macros — those are chosen or
 * measured, and the model's portion guess is the only part worth borrowing.
 */
function resolveAgainstTable(item: VisionItem): { item: VisionItem; known: boolean } {
  const food = findFood(item.name)
  if (!food || item.grams == null) return { item, known: Boolean(food) }
  const scaled = scaleTo(food, item.grams, item.cooked)
  if (!scaled) return { item, known: true }
  return {
    known: true,
    item: { ...item, name: food.key, ...scaled, kcalDisputed: false },
  }
}

export function createBot(): Bot {
  const bot = new Bot(TELEGRAM_BOT_TOKEN)

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
        '/trend — measured burn rate vs your targets',
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

  bot.on('message:text', (ctx) => {
    const text = ctx.message.text.trim()
    if (text.startsWith('/')) return ctx.reply('unknown command. /help')

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
    const image = await downloadPhoto(ctx)
    if (!image) return ctx.api.editMessageText(note.chat.id, note.message_id, 'could not fetch that photo')

    const known = vocabTable().entries.map((e) => e.key)
    const result = await readPhoto(image, ctx.message.caption ?? null, undefined, known)
    if (!result.ok) {
      logEvent('error', { kind: 'vision_fail', error: result.error })
      return ctx.api.editMessageText(note.chat.id, note.message_id, result.error)
    }

    if (result.read.kind === 'label') {
      const l = result.read
      const key = putPending({ kind: 'label', label: l })
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
    const resolved = items.map(resolveAgainstTable)
    const key = putPending({ kind: 'meal', items: resolved.map((r) => r.item), note: caveat })
    const kcal = resolved.reduce((s, r) => s + r.item.kcal, 0)
    const protein = resolved.reduce((s, r) => s + r.item.proteinG, 0)
    const missing = resolved.filter((r) => !r.known)

    return ctx.api.editMessageText(
      note.chat.id, note.message_id,
      [
        `photo · ${resolved.length} item${resolved.length === 1 ? '' : 's'}`,
        '',
        ...resolved.map((r) =>
          `${r.known ? ' ' : '~'} ${r.item.name} ${r.item.grams ?? '?'}g · ` +
          `${r.item.proteinG.toFixed(0)}g P · ${n(r.item.kcal)} kcal` +
          (r.known ? '' : '  (not in your table)')),
        '',
        `${n(kcal)} kcal · ${protein.toFixed(0)} g P`,
        ...(caveat ? [caveat] : []),
        ...(missing.length
          ? ['', `${missing.length} not in your table — logged as an estimate, add later with /food`]
          : []),
      ].join('\n'),
      { reply_markup: new InlineKeyboard().text('Log it', `log:${key}`).text('Cancel', `no:${key}`) },
    )
  })

  bot.on('callback_query:data', async (ctx) => {
    const [action, key] = ctx.callbackQuery.data.split(':')
    if (!key) return ctx.answerCallbackQuery('unknown button')

    if (action === 'no') {
      takePending(key)
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
      })
      const kcal = deriveKcal(l.proteinG, carbsG, l.fatG)
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
      })))
      const total = rows.reduce((s, r) => s + r.kcal, 0)
      logEvent('log', { date: localDate(), text: 'photo', ids: rows.map((r) => r.id), kcal: total })
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
