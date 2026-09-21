import { basename } from 'node:path'
import { expect } from 'vitest'

/**
 * Give every test file its own database, before any module can open one.
 *
 * `src/db.ts` opens its connection at import time, so a test file's own
 * `beforeAll` runs far too late: by then the static imports at the top of the
 * file have already bound the connection. `whoop.test.ts` set
 * `DB_PATH = './data/test-whoop2.db'` in a `beforeAll` and looked isolated, but
 * line 2 imported `./whoop.ts` → `./db.ts` → `./config.ts` first, so the flag
 * writes landed in `data/caltrack.db` and every `pnpm test` overwrote the live
 * WHOOP tokens with `{ access: 'winner', refresh: 'rotated' }`. The connection
 * then 401'd against the API until the refresh fired, was told 400, and deleted
 * the grant. `data/test-whoop.db` was never created — the proof it never worked.
 *
 * A setup file is the only hook that runs before the test file is imported,
 * which is what makes this the one place the choice can be made.
 */
const file = expect.getState().testPath
if (!file) throw new Error('test-setup: vitest gave no testPath — cannot isolate the database')
process.env.DB_PATH = `./data/test-${basename(file).replace(/\.test\.ts$/, '')}.db`
