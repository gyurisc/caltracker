import { Hono } from 'hono'
import { lastDays, localDate } from './config.ts'
import {
  foodsOn, getDay, getSettings, getSteps, getWaists, getWeights, totalsFor, type DayRow,
} from './db.ts'
import { activityLabel, targetKcal } from './nutrition.ts'

import { readPhoto as readStoredPhoto } from './photos.ts'
import { authorizeUrl, configured as whoopConfigured, exchangeCode } from './whoop.ts'

export const api = new Hono()

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
/**
 * The photo behind a log line. Ids are validated in `readPhoto` before they
 * touch the filesystem — this one comes straight off a URL.
 *
 * Immutable: an id is a hash of the bytes, so a cached copy can never be stale.
 */
/**
 * WHOOP connect, in two hops through a browser. Open /api/whoop/start, approve,
 * and the callback lands back here with a code to exchange.
 */
api.get('/whoop/start', (c) => {
  if (!whoopConfigured()) return c.text('no WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET in .env', 400)
  return c.redirect(authorizeUrl())
})

api.get('/whoop/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state') ?? ''
  const denied = c.req.query('error')
  if (denied) return c.text(`WHOOP said: ${denied}`, 400)
  if (!code) return c.text('no code on that callback', 400)

  try {
    await exchangeCode(code, state)
    return c.text('WHOOP connected. You can close this tab and run /whoop in Telegram.')
  } catch (e) {
    return c.text((e as Error).message, 400)
  }
})

api.get('/photo/:id', (c) => {
  const size = c.req.query('size') === 'thumb' ? 'thumb' : 'full'
  const bytes = readStoredPhoto(c.req.param('id'), size)
  if (!bytes) return c.notFound()
  c.header('content-type', 'image/jpeg')
  c.header('cache-control', 'public, max-age=31536000, immutable')
  return c.body(new Uint8Array(bytes))
})

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
      // `rows`, not `items`: the spread above already carries an `items` count
      // from totalsFor, and an array under that name would silently replace it.
      rows: foodsOn(d),
    }
  })

  // 30 days: enough for a 7-day rolling mean to have something to roll over.
  const trendDates = lastDays(30, date)
  const weights = getWeights(trendDates)
  const waists = getWaists(trendDates)
  const steps = getSteps(trendDates)
  const trendTotals = totalsFor(trendDates)
  const trend = trendDates.map((d) => {
    const dayRow = getDay(d)
    const t = trendTotals[d]!
    return {
      date: d,
      activity: dayRow.activity,
      weightKg: weights[d] ?? null,
      waistCm: waists[d] ?? null,
      steps: steps[d] ?? null,
      strain: dayRow.strain,
      sleepH: dayRow.sleep_h,
      recovery: dayRow.recovery,
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

// Six write routes used to live here: POST /log, /undo, /day/activity,
// /day/weight, /settings, and DELETE /food/:id. They were the server half of
// the composer, the per-row delete, the weight field, the activity chips and
// the editable Targets block in PRD §7.5 — blocks the dashboard never grew.
//
// Nothing called them. The bot writes through service.ts directly, the /cal-*
// commands open SQLite directly, and web/src/api.ts only ever fetched /state.
// They are gone rather than address-gated because the dashboard is now served
// to the internet through a proxy, and behind a proxy every request arrives
// from 127.0.0.1 — an address rule waves it straight through. A route that
// does not exist cannot be exposed by a bad access rule.
//
// Telegram is the write surface now: it is allowlisted to one user id, and
// /target learned to set the goals that only POST /settings could reach.
//
// `POST /api/seed` used to live here. It called seedSampleData() with no flag
// check, so one request put 125 demo rows into a log that had been deliberately
// wiped — which is exactly what happened while testing the access rules. Seeding
// is a first-boot concern and a `pnpm seed` concern; it has no business on a
// port. `pnpm seed:wipe` is the way back if it ever runs again.
