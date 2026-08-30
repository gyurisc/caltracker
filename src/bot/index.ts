import { Bot } from 'grammy'
import { TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID, lastDays, localDate } from '../config.ts'
import {
  deleteFood, foodsOn, getDay, getSettings, mostRecentFood, setActivity, setWeight, totalsFor,
} from '../db.ts'
import { activityLabel, normalizeActivity, targetKcal } from '../nutrition.ts'
import { isWithinUndoWindow, logText, UNDO_WINDOW_HOURS } from '../service.ts'

const n = (v: number) => Math.round(v).toLocaleString('en-US')

function todayLine(date = localDate()): string {
  const s = getSettings()
  const day = getDay(date)
  const t = totalsFor([date])[date]!
  return `${n(t.kcal)} / ${n(targetKcal(day.activity, s))} kcal · ${t.proteinG.toFixed(0)} / ${s.proteinGoal} g P`
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
        '/week — last 7 days',
        '/weight 74.2 — morning weigh-in',
        '/activity rest|lift|cycle',
        '/undo — remove the most recent item',
        '/target — maintenance, deficit, goals',
        '',
        'Numbers are estimates, not medical advice.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    ),
  )

  bot.command('today', (ctx) => {
    const date = localDate()
    const day = getDay(date)
    const items = foodsOn(date)
    const s = getSettings()
    const t = totalsFor([date])[date]!
    const target = targetKcal(day.activity, s)

    const lines = items.length
      ? items.map((i) => {
          const grams = i.grams ? ` ${i.grams}g${i.cooked == null ? '' : i.cooked ? ' cooked' : ' raw'}` : ''
          return `${i.time}  ${i.name}${grams} · ${i.protein_g.toFixed(0)}g P · ${n(i.kcal)} kcal`
        })
      : ['Nothing logged yet.']

    ctx.reply(
      [
        `${date} · ${activityLabel(day.activity)}${day.weight_kg ? ` · ${day.weight_kg} kg` : ''}`,
        ...lines,
        '',
        todayLine(date),
        `${target - t.kcal >= 0 ? `${n(target - t.kcal)} kcal left` : `${n(t.kcal - target)} kcal over`}`,
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
      return ctx.reply(
        `not in the local table: ${result.unmatched.join(', ')}\nTry a listed food, or add it to src/parse.ts.`,
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
