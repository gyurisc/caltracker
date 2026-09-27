import { isAbsolute, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DB_PATH, PORT, ROOT, addDays, fromRoot, lastDays, localDate, weekdayOf, whoopRedirect } from './config.ts'

describe('paths are pinned to the repo, not cwd', () => {
  it('resolves DB_PATH absolutely', () => {
    // Against ROOT and against whatever DB_PATH says — not against the default
    // name, which the test suite deliberately overrides (src/test-setup.ts).
    expect(isAbsolute(DB_PATH)).toBe(true)
    expect(DB_PATH).toBe(resolve(ROOT, process.env.DB_PATH ?? './data/caltrack.db'))
  })

  it('does not move when the working directory does', () => {
    const before = fromRoot('./data/caltrack.db')
    const cwd = process.cwd()
    try {
      process.chdir('/')
      expect(fromRoot('./data/caltrack.db')).toBe(before)
    } finally {
      process.chdir(cwd)
    }
  })

  it('leaves an absolute override alone', () => {
    expect(fromRoot('/var/lib/caltrack.db')).toBe('/var/lib/caltrack.db')
  })
})

describe('the WHOOP redirect follows the host it is reached on', () => {
  // WHOOP matches this character for character against the app registration.
  // Deriving it from PORT pins it to localhost, which is right on the Mac and
  // breaks the connect flow on a public box with an error that only ever says
  // "redirect_uri mismatch" (docs/deploy.md §4).
  it('uses PUBLIC_URL when one is set', () => {
    expect(whoopRedirect('https://rawdog.example.com')).toBe('https://rawdog.example.com/api/whoop/callback')
  })

  it('tolerates a trailing slash, which an env var picks up easily', () => {
    expect(whoopRedirect('https://rawdog.example.com/')).toBe('https://rawdog.example.com/api/whoop/callback')
  })

  it('falls back to localhost and PORT when PUBLIC_URL is unset', () => {
    expect(whoopRedirect(undefined)).toBe(`http://localhost:${PORT}/api/whoop/callback`)
    expect(whoopRedirect('')).toBe(`http://localhost:${PORT}/api/whoop/callback`)
  })
})

describe('date helpers', () => {
  it('crosses a DST boundary without landing on the wrong day', () => {
    // Europe/Amsterdam ends DST on 2026-10-25.
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28')
  })

  it('walks month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('knows weekdays for the activity defaults', () => {
    expect(weekdayOf('2026-08-31')).toBe(1) // Monday
    expect(weekdayOf('2026-08-30')).toBe(0) // Sunday
  })

  it('returns n dates ending at the given day, oldest first', () => {
    const week = lastDays(7, '2026-08-30')
    expect(week).toHaveLength(7)
    expect(week[0]).toBe('2026-08-24')
    expect(week[6]).toBe('2026-08-30')
  })

  it('formats today as YYYY-MM-DD', () => {
    expect(localDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
