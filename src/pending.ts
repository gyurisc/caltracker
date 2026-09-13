/**
 * PRD §7.1. Telegram caps `callback_data` at 64 bytes, so a parsed plate cannot
 * ride in the button. It waits here under a short key, and the button carries
 * only that key plus an action.
 *
 * In-process and deliberately not persisted: a confirm card that outlives a
 * restart would be a card the user no longer remembers sending.
 */
import type { VisionLabel, VisionItem } from './vision.ts'

export const PENDING_TTL_MS = 30 * 60 * 1000

export type PendingCard =
  | { kind: 'meal'; items: VisionItem[]; note: string | null }
  | { kind: 'label'; label: VisionLabel }

export type Pending = PendingCard & { at: number }

const store = new Map<string, Pending>()

function sweep(now: number): void {
  for (const [key, value] of store) {
    if (now - value.at > PENDING_TTL_MS) store.delete(key)
  }
}

/** Short key: it has to fit in 64 bytes alongside an action word. */
export function put(entry: PendingCard, now = Date.now()): string {
  sweep(now)
  const key = Math.random().toString(36).slice(2, 10)
  store.set(key, { ...entry, at: now })
  return key
}

export function take(key: string, now = Date.now()): Pending | undefined {
  sweep(now)
  const found = store.get(key)
  if (found) store.delete(key)
  return found
}

export function peek(key: string): Pending | undefined {
  return store.get(key)
}

export function size(): number {
  return store.size
}

/** Tests only. */
export function clear(): void {
  store.clear()
}
