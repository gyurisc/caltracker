import { describe, expect, it } from 'vitest'
import { cycleDate } from './whoop.ts'

const cycle = (start: string, offset = '+02:00') => ({ start, timezone_offset: offset })

describe('which day a WHOOP cycle describes', () => {
  it('gives an evening cycle to the next day', () => {
    // A cycle runs sleep-onset to sleep-onset, so one that begins at 21:52 on
    // the 15th covers that night and the whole of the 16th.
    expect(cycleDate(cycle('2026-09-15T19:52:50.370Z'))).toBe('2026-09-16')
  })

  it('gives a cycle that began at local midnight that same day', () => {
    expect(cycleDate(cycle('2026-09-14T22:00:00.000Z'))).toBe('2026-09-15')
  })

  it('keeps two cycles starting on one calendar date apart', () => {
    // Exactly the case that put the 16th's strain on the 15th: both of these
    // start on the 15th in local time, and they are different days.
    const early = cycleDate(cycle('2026-09-14T22:00:00.000Z'))
    const late = cycleDate(cycle('2026-09-15T19:52:50.370Z'))
    expect(early).not.toBe(late)
  })

  it('handles a bedtime after midnight', () => {
    // Asleep at 01:00 on the 16th: the waking hours are still the 16th.
    expect(cycleDate(cycle('2026-09-15T23:00:00.000Z'))).toBe('2026-09-16')
  })

  it('uses the record\'s own offset, not the server\'s', () => {
    expect(cycleDate(cycle('2026-09-15T23:30:00.000Z', '-05:00'))).toBe('2026-09-16')
    expect(cycleDate(cycle('2026-09-15T23:30:00.000Z', '+02:00'))).toBe('2026-09-16')
  })

  it('returns nothing for an unparseable start', () => {
    expect(cycleDate(cycle('not a date'))).toBe('')
  })
})
