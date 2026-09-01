import { Bot } from 'grammy'
import { addDays, TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID, lastDays, localDate } from '../config.ts'
import {
  deleteFood, getDay, getSettings, mostRecentFood, setActivity, setSteps, setWeight, totalsFor,
} from '../db.ts'
import { parseFoodCommand } from '../foodcmd.ts'
import { bareFoodName } from '../parse.ts'
import { nearMatches } from '../similar.ts'
import { activityLabel, deriveKcal, normalizeActivity, targetKcal } from '../nutrition.ts'
import { calibrationReport, n, todayLine, todayReport, vocabReport } from '../report.ts'
import { isWithinUndoWindow, logText, UNDO_WINDOW_HOURS } from '../service.ts'
import { saveFood, vocabTable } from '../vocab.ts'

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
        '/foods — every food I know',
        '/food kefir per100 p3.3 c4 f1 — teach me a food',
        '/week — last 7 days',
        '/trend — measured burn rate vs your targets',
        '/weight 74.2 — morning weigh-in',
        '/activity rest|lift|cycle',
        '/steps 12000 — yesterday, from your phone',
        '/undo — remove the most recent item',
        '/target — maintenance, deficit, goals',
        '',
        'Numbers are estimates, not medical advice.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    ),
  )

  bot.command('today', (ctx) => ctx.reply(todayReport()))

  bot.command('foods', (ctx) => ctx.reply(vocabReport()))

  bot.command('trend', (ctx) => ctx.reply(calibrationReport()))

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
    const row = mostRecentFood()
    if (!row) return ctx.reply('nothing to undo')
    if (!isWithinUndoWindow(row)) return ctx.reply(`nothing recent to undo (older than ${UNDO_WINDOW_HOURS} h)`)
    deleteFood(row.id)
    return ctx.reply(`− ${row.name} · ${n(row.kcal)} kcal · ${todayLine()}`)
  })

  bot.on('message:text', (ctx) => {
    const text = ctx.message.text.trim()
    if (text.startsWith('/')) return ctx.reply('unknown command. /help')

    const result = logText(text)
    if (!result.ok) {
      if (result.unmatched.length === 0) return ctx.reply('nothing to log there.')
      const aliases = vocabTable().entries.flatMap((e) => e.aliases)
      const names = result.unmatched.map(bareFoodName).filter(Boolean).slice(0, 3)

      // A typo one letter from a known food gets a "did you mean", never a
      // template — offering to add `pespi` beside `pepsi` is worse than useless.
      const suggestions = names.flatMap((name) => nearMatches(name, aliases, 2))
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

  bot.on('message:photo', (ctx) =>
    ctx.reply('photo logging needs vision, which is not wired yet. Type the food for now.'),
  )

  bot.catch((err) => console.error('[bot]', err.error))

  return bot
}
