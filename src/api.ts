import { Hono } from 'hono'
import { lastDays, localDate } from './config.ts'
import {
  deleteFood, foodsOn, getDay, getSettings, getSteps, getWeights, mostRecentFood,
  saveSettings, setActivity, setWeight, totalsFor, type DayRow,
} from './db.ts'
import { activityLabel, normalizeActivity, targetKcal, type Activity } from './nutrition.ts'
import { seedSampleData } from './seed.ts'
import { isWithinUndoWindow, logText } from './service.ts'

export const api = new Hono()

/** A malformed body is an empty body, not a 500. */
async function readJson<T extends object>(c: { req: { json: <U>() => Promise<U> } }): Promise<Partial<T>> {
  return c.req.json<Partial<T>>().catch(() => ({}) as Partial<T>)
}

function dayView(day: DayRow) {
  const s = getSettings()
  return {
    date: day.date,
    activity: day.activity,
    activityLabel: activityLabel(day.activity),
    weightKg: day.weight_kg,
    maintenance: s.maintenance[day.activity],
    targetKcal: targetKcal(day.activity, s),
  }
}

/** Everything the dashboard needs in one request. */
api.get('/state', (c) => {
  const date = c.req.query('date') ?? localDate()
  const settings = getSettings()
  const day = getDay(date)

  const weekDates = lastDays(7, date)
  const weekTotals = totalsFor(weekDates)
  const week = weekDates.map((d) => {
    const dayRow = getDay(d)
    return {
      date: d,
      activity: dayRow.activity,
      maintenance: settings.maintenance[dayRow.activity],
      targetKcal: targetKcal(dayRow.activity, settings),
      ...weekTotals[d]!,
    }
  })

  // 30 days: enough for a 7-day rolling mean to have something to roll over.
  const trendDates = lastDays(30, date)
  const weights = getWeights(trendDates)
  const steps = getSteps(trendDates)
  const trendTotals = totalsFor(trendDates)
  const trend = trendDates.map((d) => {
    const dayRow = getDay(d)
    const t = trendTotals[d]!
    return {
      date: d,
      activity: dayRow.activity,
      weightKg: weights[d] ?? null,
      steps: steps[d] ?? null,
      kcal: t.kcal,
      proteinG: t.proteinG,
      carbsG: t.carbsG,
      fatG: t.fatG,
      items: t.items,
      maintenance: settings.maintenance[dayRow.activity],
      targetKcal: targetKcal(dayRow.activity, settings),
    }
  })

  return c.json({
    today: dayView(day),
    settings,
    totals: weekTotals[date] ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, items: 0 },
    items: foodsOn(date),
    week,
    trend,
  })
})

api.post('/log', async (c) => {
  const body = await readJson<{ text: string; date: string }>(c)
  const text = (body.text ?? '').trim()
  if (!text) return c.json({ error: 'empty' }, 400)

  const result = logText(text, { date: body.date })
  if (!result.ok) {
    return c.json(
      { error: 'unmatched', unmatched: result.unmatched, hint: 'Not in the local table yet — photo logging lands with vision.' },
      422,
    )
  }
  return c.json({ rows: result.rows })
})

api.delete('/food/:id', (c) => {
  const row = deleteFood(c.req.param('id'))
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json({ deleted: row })
})

/** Same rule as the bot: most recent row overall, refused past the undo window. */
api.post('/undo', (c) => {
  const row = mostRecentFood()
  if (!row) return c.json({ error: 'nothing to undo' }, 404)
  if (!isWithinUndoWindow(row)) return c.json({ error: 'nothing recent to undo' }, 409)
  deleteFood(row.id)
  return c.json({ deleted: row })
})

api.post('/day/activity', async (c) => {
  const body = await readJson<{ date: string; activity: string }>(c)
  const activity = normalizeActivity(body.activity ?? '')
  if (!activity) return c.json({ error: 'unknown activity' }, 400)
  return c.json({ day: dayView(setActivity(body.date ?? localDate(), activity as Activity)) })
})

api.post('/day/weight', async (c) => {
  const body = await readJson<{ date: string; kg: number }>(c)
  const kg = Number(body.kg)
  if (!Number.isFinite(kg) || kg <= 0 || kg > 400) return c.json({ error: 'bad weight' }, 400)
  return c.json({ day: dayView(setWeight(body.date ?? localDate(), kg)) })
})

api.post('/settings', async (c) => {
  const body = await readJson<Record<string, unknown>>(c)
  const patch: Record<string, unknown> = {}
  if (Number.isFinite(Number(body.proteinGoal))) patch.proteinGoal = Number(body.proteinGoal)
  if (Number.isFinite(Number(body.deficit))) patch.deficit = Number(body.deficit)
  if (body.maintenance && typeof body.maintenance === 'object') patch.maintenance = body.maintenance
  return c.json({ settings: saveSettings(patch) })
})

api.post('/seed', (c) => c.json({ rows: seedSampleData() }))
