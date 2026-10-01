import { describe, expect, it, vi } from 'vitest'

/**
 * Dates, proved without depending on the host's clock.
 *
 * `pnpm test` runs from `deploy.sh` on the VPS, outside systemd — so it never
 * sees the `TZ` in /etc/caltrack/env, and the box is UTC. A test that quietly
 * read the host's zone would pass on a Mac in Amsterdam and fail on Hetzner,
 * or worse, pass in both while the app files food on the wrong day.
 *
 * So every case below sets the zone itself. There is no static import of
 * ./config.ts here on purpose: it builds its Intl formatters at module load
 * from process.env.TZ, so the zone has to be chosen before the import.
 */
async function inZone(tz: string) {
  process.env.TZ = tz
  vi.resetModules()
  return import('./config.ts')
}

// A box in Falkenstein, a laptop in Amsterdam, and two zones far enough either
// side of UTC to catch arithmetic that leaked into local time.
const ZONES = ['UTC', 'Europe/Amsterdam', 'America/Los_Angeles', 'Asia/Tokyo']

describe('date arithmetic is the same on every host', () => {
  it('walks days, months and years identically in every zone', async () => {
    for (const tz of ZONES) {
      const { addDays, weekdayOf, lastDays } = await inZone(tz)

      // Europe/Amsterdam ends DST on 2026-10-25 and starts it on 2026-03-29.
      // These two are pure UTC string arithmetic today, so the loop is a
      // regression guard rather than a proof: it would catch a rewrite that
      // reached for local-time getters and anchored somewhere other than the
      // middle of the day, which is the version that breaks on a DST night.
      expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
      expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
      expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
      expect(addDays('2026-03-29', -1)).toBe('2026-03-28')

      expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
      expect(addDays('2024-03-01', -1)).toBe('2024-02-29')

      expect(weekdayOf('2026-10-25')).toBe(0)
      expect(weekdayOf('2026-10-26')).toBe(1)

      expect(lastDays(3, '2026-01-01')).toEqual(['2025-12-30', '2025-12-31', '2026-01-01'])
      expect(lastDays(1, '2026-10-25')).toEqual(['2026-10-25'])
    }
  })
})

describe('which day an instant belongs to', () => {
  // The whole reason TZ is configuration and not a constant. Get this wrong on
  // the VPS and a 23:00 meal is filed under yesterday, silently, for ever.
  it('puts a late-evening instant on the next day in Amsterdam', async () => {
    const instant = new Date('2026-09-27T22:30:00Z')

    const ams = await inZone('Europe/Amsterdam')
    expect(ams.localDate(instant)).toBe('2026-09-28')

    const utc = await inZone('UTC')
    expect(utc.localDate(instant)).toBe('2026-09-27')
  })

  it('takes the zone from TZ rather than from the host', async () => {
    expect((await inZone('Asia/Tokyo')).TZ).toBe('Asia/Tokyo')
    expect((await inZone('UTC')).TZ).toBe('UTC')
  })

  it('reads 2am twice on the night the clocks go back', async () => {
    // 00:30Z is 02:30 CEST; an hour later 01:30Z is 02:30 CET. Any code that
    // assumed an hour number appears once a day would be wrong here.
    const { localHour } = await inZone('Europe/Amsterdam')
    expect(localHour(new Date('2026-10-25T00:30:00Z'))).toBe(2)
    expect(localHour(new Date('2026-10-25T01:30:00Z'))).toBe(2)
  })

  it('stamps an event with local date and time, not UTC', async () => {
    const { localStamp } = await inZone('Europe/Amsterdam')
    expect(localStamp(new Date('2026-09-27T22:30:00Z'))).toBe('2026-09-28T00:30')
  })
})
