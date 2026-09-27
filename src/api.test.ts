import { beforeAll, describe, expect, it } from 'vitest'
import { api } from './api.ts'
import { logText } from './service.ts'
import { localDate } from './config.ts'
import { addDays } from './config.ts'

type WeekDay = { date: string; kcal: number; items: number; rows: { name: string; grams: number }[] }

describe('GET /api/state', () => {
  let week: WeekDay[]

  beforeAll(async () => {
    // Two days with food and one deliberately left empty, so the week carries
    // all three cases the dashboard has to render.
    // `rice` alone would come back needsState — that is a question, not a
    // parse failure, and it writes nothing.
    const wrote = logText('rice 200g cooked', { date: addDays(localDate(), -1) })
    expect(wrote.ok).toBe(true)
    logText('banana', { date: addDays(localDate(), -2) })

    const res = await api.request('/state')
    expect(res.status).toBe(200)
    week = ((await res.json()) as { week: WeekDay[] }).week
  })

  it('returns seven days', () => {
    expect(week).toHaveLength(7)
  })

  // The dashboard shows each day's entries, not just its totals. `items` next
  // to this is a COUNT from totalsFor, which is why the rows cannot use that
  // name: the array would silently replace the number.
  it('carries the food rows for each day', () => {
    const yesterday = week.find((d) => d.date === addDays(localDate(), -1))!
    expect(yesterday.rows.map((r) => r.name)).toContain('rice')
    expect(yesterday.rows[0]!.grams).toBe(200)
    expect(yesterday.items).toBe(1)
  })

  it('gives a day with nothing logged an empty array, not undefined', () => {
    const empty = week.find((d) => d.date === addDays(localDate(), -5))!
    expect(empty.rows).toEqual([])
  })
})
