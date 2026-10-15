import { describe, expect, it } from 'vitest'
import { CHECK_INS, dueCheckIn, runCheckIn } from './checkin.ts'

const slot = (name: string) => CHECK_INS.find((c) => c.slot === name)!

describe('which check-in is due', () => {
  it('sends nothing before the morning one', () => {
    expect(dueCheckIn('2026-10-15', 6, undefined)).toBeNull()
  })

  it('sends the morning one from 07:00', () => {
    expect(dueCheckIn('2026-10-15', 7, undefined)?.slot).toBe('morning')
  })

  it('does not send the same one twice', () => {
    expect(dueCheckIn('2026-10-15', 9, '2026-10-15 morning')).toBeNull()
  })

  it('moves on to midday once the morning one went out', () => {
    expect(dueCheckIn('2026-10-15', 11, '2026-10-15 morning')?.slot).toBe('midday')
  })

  it('sends only the latest when it wakes up late, not a backlog', () => {
    // The process was down from 10:00 to 17:00: one evening message, not a
    // midday one followed a minute later by an evening one.
    expect(dueCheckIn('2026-10-15', 17, '2026-10-15 morning')?.slot).toBe('evening')
  })

  it('treats yesterday as not sent today', () => {
    expect(dueCheckIn('2026-10-15', 8, '2026-10-14 evening')?.slot).toBe('morning')
  })

  it('lets a missed evening go once it is late', () => {
    expect(dueCheckIn('2026-10-15', 22, '2026-10-15 midday')).toBeNull()
  })
})

describe('running a check-in', () => {
  it('asks the coach with the slot and when the next one comes', async () => {
    let asked: any
    const ask = async (...args: any[]) => { asked = args; return { ok: true as const, text: 'eat lunch' } }
    await runCheckIn(slot('midday'), ask as never)

    expect(asked[5].checkIn).toEqual({ slot: 'midday', next: '16:00 today' })
  })

  it('opens the message with the compass and the title', async () => {
    const ask = async () => ({ ok: true as const, text: 'eat lunch' })
    const out = await runCheckIn(slot('morning'), ask as never)

    expect(out).toEqual({ ok: true, text: '🧭 *Reggeli coach*\n\neat lunch' })
  })

  it('reports a failure as a failure, never as the coach speaking', async () => {
    // The launchd version sent "Failed to authenticate: OAuth session expired"
    // under the coach heading, because it only checked for empty output.
    const ask = async () => ({ ok: false as const, error: 'coach failed: xAI 401' })
    const out = await runCheckIn(slot('evening'), ask as never)

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toContain('xAI 401')
      expect(out.error).not.toContain('🧭')
    }
  })
})
