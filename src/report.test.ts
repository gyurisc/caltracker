import { existsSync, rmSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

/** Isolated DB, set before importing db.ts — it opens DB_PATH at import time. */
const TEST_DB = './data/test-report.db'

let logText: typeof import('./service.ts').logText
let missesReport: typeof import('./report.ts').missesReport
let recentMisses: typeof import('./db.ts').recentMisses

beforeAll(async () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (existsSync(f)) rmSync(f)
  process.env.DB_PATH = TEST_DB
  ;({ logText } = await import('./service.ts'))
  ;({ missesReport } = await import('./report.ts'))
  ;({ recentMisses } = await import('./db.ts'))
})

describe('misses', () => {
  it('is empty before anything is refused', () => {
    expect(recentMisses()).toEqual([])
    expect(missesReport()).toContain('No refused messages')
  })

  it('counts a repeated refusal once, with a tally', () => {
    logText('pad thai')
    logText('pad thai')
    logText('sushi')

    const misses = recentMisses()
    expect(misses.map((m) => [m.phrase, m.count])).toEqual([['pad thai', 2], ['sushi', 1]])
    expect(missesReport()).toContain('pad thai')
    expect(missesReport()).toContain('×2')
  })

  it('does not record a message that parses', () => {
    const before = recentMisses().length
    expect(logText('black coffee').ok).toBe(true)
    expect(recentMisses()).toHaveLength(before)
  })
})
