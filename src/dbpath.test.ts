import { describe, expect, it } from 'vitest'
import { db } from './db.ts'

describe('test isolation', () => {
  // src/db.ts opens its database at import time, so a test file that imports
  // anything from src/ has bound the connection before its own beforeAll can
  // redirect DB_PATH. whoop.test.ts did exactly that, and every `pnpm test`
  // wrote its fixture tokens over the live WHOOP grant in data/caltrack.db —
  // silently, for weeks. The suite must never be able to reach that file.
  it('never opens the production database', () => {
    expect(db.name).not.toMatch(/data\/caltrack\.db$/)
  })
})
