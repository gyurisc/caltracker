import { beforeEach, describe, expect, it } from 'vitest'
import { clear, peek, PENDING_TTL_MS, put, size, take } from './pending.ts'
import type { VisionItem } from './vision.ts'

const item: VisionItem = {
  name: 'rice', grams: 200, count: null, cooked: true,
  proteinG: 5, carbsG: 56, fatG: 0.6, kcal: 250, kcalDisputed: false,
}

beforeEach(clear)

describe('the pending card store', () => {
  it('hands back a key short enough for a callback button', () => {
    const key = put({ kind: 'meal', items: [item], note: null })
    // Telegram caps callback_data at 64 bytes, and it carries an action too.
    expect(`log:${key}`.length).toBeLessThan(64)
  })

  it('is single use — a second tap finds nothing', () => {
    const key = put({ kind: 'meal', items: [item], note: null })
    expect(take(key)).toBeDefined()
    expect(take(key)).toBeUndefined()
  })

  it('forgets a card once its time is up', () => {
    const now = Date.now()
    const key = put({ kind: 'meal', items: [item], note: null }, now)
    expect(peek(key)).toBeDefined()
    expect(take(key, now + PENDING_TTL_MS + 1)).toBeUndefined()
  })

  it('sweeps stale cards when a new one arrives', () => {
    const now = Date.now()
    put({ kind: 'meal', items: [item], note: null }, now)
    expect(size()).toBe(1)
    put({ kind: 'meal', items: [item], note: null }, now + PENDING_TTL_MS + 1)
    expect(size()).toBe(1)
  })
})
