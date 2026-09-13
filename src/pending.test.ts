import { beforeEach, describe, expect, it } from 'vitest'
import { clear, latestMeal, peek, PENDING_TTL_MS, put, replace, size, take } from './pending.ts'
import type { VisionItem } from './vision.ts'

const item: VisionItem = {
  name: 'rice', grams: 200, count: null, gramsStated: false, cooked: true,
  proteinG: 5, carbsG: 56, fatG: 0.6, kcal: 250, kcalDisputed: false,
}

const card = (over: Partial<{ items: VisionItem[]; chatId: number }> = {}) => ({
  kind: 'meal' as const,
  items: [item],
  note: null,
  chatId: 1,
  messageId: 2,
  proposed: [item],
  ...over,
})

beforeEach(clear)

describe('the pending card store', () => {
  it('hands back a key short enough for a callback button', () => {
    const key = put(card())
    // Telegram caps callback_data at 64 bytes, and it carries an action too.
    expect(`log:${key}`.length).toBeLessThan(64)
  })

  it('is single use — a second tap finds nothing', () => {
    const key = put(card())
    expect(take(key)).toBeDefined()
    expect(take(key)).toBeUndefined()
  })

  it('forgets a card once its time is up', () => {
    const now = Date.now()
    const key = put(card(), now)
    expect(peek(key)).toBeDefined()
    expect(take(key, now + PENDING_TTL_MS + 1)).toBeUndefined()
  })

  it('sweeps stale cards when a new one arrives', () => {
    const now = Date.now()
    put(card(), now)
    expect(size()).toBe(1)
    put(card(), now + PENDING_TTL_MS + 1)
    expect(size()).toBe(1)
  })
})

describe('finding the card a correction refers to', () => {
  it('picks the newest card in that chat', () => {
    const now = Date.now()
    put(card(), now)
    const newer = put(card(), now + 1000)
    expect(latestMeal(1, now + 2000)?.key).toBe(newer)
  })

  it('does not reach into another chat', () => {
    put(card({ chatId: 99 }))
    expect(latestMeal(1)).toBeUndefined()
  })

  it('rewrites a card in place, keeping its key and its clock', () => {
    const now = Date.now()
    const key = put(card(), now)
    const fixed = { ...item, grams: 20 }
    replace(key, card({ items: [fixed] }))
    expect(peek(key)?.kind === 'meal' && peek(key)).toBeTruthy()
    const after = peek(key)
    expect(after?.at).toBe(now)
    if (after?.kind === 'meal') expect(after.items[0]!.grams).toBe(20)
  })
})
