import { existsSync, rmSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

const TEST_DB = './data/test-db.db'
let logEvent: typeof import('./db.ts').logEvent
let visionCounts: typeof import('./db.ts').visionCounts

beforeAll(async () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (existsSync(f)) rmSync(f)
  process.env.DB_PATH = TEST_DB
  ;({ logEvent, visionCounts } = await import('./db.ts'))
})

describe('the events table accepts every kind the code can log', () => {
  it('takes a vision event', () => {
    // The TypeScript union and the CHECK constraint have to agree. They did
    // not once: `vision` was legal in the types while the table still refused
    // it, so every photo card threw on insert with nothing in the log to say
    // why. A CHECK is not an additive migration — widening it rebuilds the
    // table, and that is easy to forget.
    expect(() => logEvent('vision', { action: 'proposed' })).not.toThrow()
    expect(visionCounts().proposed).toBe(1)
  })

  it('still takes the older kinds', () => {
    for (const kind of ['log', 'undo', 'weight', 'activity', 'error'] as const) {
      expect(() => logEvent(kind, { probe: true })).not.toThrow()
    }
  })
})
