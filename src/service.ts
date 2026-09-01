/** The one logging pipeline. Telegram and the dashboard composer both come through here. */
import { localDate, localTime } from './config.ts'
import { addFoods, type FoodRow, logEvent } from './db.ts'
import { parseMessage } from './parse.ts'
import { vocabTable } from './vocab.ts'

export type LogOutcome =
  | { ok: true; rows: FoodRow[] }
  | { ok: false; unmatched: string[]; needsState: string[] }

export function logText(text: string, opts: { date?: string; time?: string } = {}): LogOutcome {
  const parsed = parseMessage(text, undefined, vocabTable())
  if (!parsed.ok) {
    // A missing state is a question, not a vocabulary gap — keep it out of the
    // parse_miss backlog, which drives what to add to the table.
    if (parsed.needsState.length === 0) {
      logEvent('error', { kind: 'parse_miss', text, unmatched: parsed.unmatched })
    }
    return { ok: false, unmatched: parsed.unmatched, needsState: parsed.needsState }
  }

  const date = opts.date ?? localDate()
  const time = opts.time ?? localTime()

  const rows = addFoods(
    parsed.items.map((i) => ({
      date,
      time,
      mealTag: i.mealTag,
      name: i.name,
      grams: i.grams,
      cooked: i.cooked,
      proteinG: i.proteinG,
      carbsG: i.carbsG,
      fatG: i.fatG,
      kcal: i.kcal,
      source: 'text' as const,
      provenance: i.provenance,
    })),
  )

  logEvent('log', { date, text, ids: rows.map((r) => r.id), kcal: rows.reduce((s, r) => s + r.kcal, 0) })
  return { ok: true, rows }
}

/** How long after a row was written `/undo` will still reach it (PRD §7.1). */
export const UNDO_WINDOW_HOURS = 6

export function isWithinUndoWindow(row: FoodRow, now: Date = new Date()): boolean {
  const [h, m] = row.time.split(':').map(Number)
  const [y, mo, d] = row.date.split('-').map(Number)
  const rowMs = Date.UTC(y!, mo! - 1, d!, h ?? 0, m ?? 0)
  const [nh, nm] = localTime(now).split(':').map(Number)
  const [ny, nmo, nd] = localDate(now).split('-').map(Number)
  const nowMs = Date.UTC(ny!, nmo! - 1, nd!, nh ?? 0, nm ?? 0)
  return nowMs - rowMs <= UNDO_WINDOW_HOURS * 3_600_000
}
