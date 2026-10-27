/** The one logging pipeline. Telegram and the dashboard composer both come through here. */
import { localDate, localTime } from './config.ts'
import { addFoods, type FoodRow, logEvent, mostRecentFood } from './db.ts'
import { round1 } from './nutrition.ts'
import { parseMessage } from './parse.ts'
import { vocabTable } from './vocab.ts'

export type LogOutcome =
  | { ok: true; rows: FoodRow[] }
  | { ok: false; unmatched: string[]; needsState: string[]; implausible: string[] }

export function logText(
  text: string,
  opts: { date?: string; time?: string; photoId?: string | null } = {},
): LogOutcome {
  const parsed = parseMessage(text, undefined, vocabTable())
  if (!parsed.ok) {
    // A missing state is a question, not a vocabulary gap — keep it out of the
    // parse_miss backlog, which drives what to add to the table.
    if (parsed.needsState.length === 0 && parsed.implausible.length === 0) {
      logEvent('error', { kind: 'parse_miss', text, unmatched: parsed.unmatched })
    }
    return {
      ok: false,
      unmatched: parsed.unmatched,
      needsState: parsed.needsState,
      implausible: parsed.implausible,
    }
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
      source: opts.photoId ? ('photo' as const) : ('text' as const),
      provenance: i.provenance,
      photoPath: opts.photoId ?? null,
    })),
  )

  logEvent('log', { date, text, ids: rows.map((r) => r.id), kcal: rows.reduce((s, r) => s + r.kcal, 0) })
  return { ok: true, rows }
}

export type AgainOutcome = { ok: true; row: FoodRow } | { ok: false; error: string }

export const AGAIN_USAGE = 'usage: /again · /again 200g · /again x2 · /again fél'

/**
 * `/again` — the most recent item once more, optionally at another size.
 *
 * It copies the stored row rather than re-parsing its name: a second slice of a
 * pizza that only ever came from a photo is in no table, so typing its name is
 * refused. Everything scales by one factor, kcal included, which keeps a row's
 * explicit trace kcal (brewed coffee) intact rather than re-deriving it.
 *
 * Only the last row, never the whole last meal: one plate photo can log three
 * items, and repeating them all by accident is a silent overcount.
 */
export function logAgain(arg: string): AgainOutcome {
  const last = mostRecentFood()
  if (!last) return { ok: false, error: 'nothing to repeat yet' }

  const a = arg.trim().toLowerCase().replace(',', '.')
  let factor = 1
  if (!a) {
    factor = 1
  } else if (['fél', 'fel', 'half', '1/2'].includes(a)) {
    factor = 0.5
  } else if (/^(?:x|×)\s*\d+(?:\.\d+)?$|^\d+(?:\.\d+)?\s*(?:x|×)$/.test(a)) {
    factor = Number(a.replace(/[x×\s]/g, ''))
  } else {
    const w = a.match(/^(\d+(?:\.\d+)?)\s*(g|gr|gramm|ml)?$/)
    if (!w) return { ok: false, error: AGAIN_USAGE }
    const grams = Number(w[1])
    if (last.grams == null) {
      return { ok: false, error: `${last.name} was logged with no weight — try /again x2 or /again fél` }
    }
    // `/again 2` is far likelier to mean two portions than 2 g.
    if (!w[2] && grams < 10) return { ok: false, error: `${grams} g? for ${grams} portions say /again x${grams}` }
    factor = grams / last.grams
  }
  if (!(factor > 0 && factor <= 10)) return { ok: false, error: AGAIN_USAGE }

  const [row] = addFoods([{
    date: localDate(),
    time: localTime(),
    name: last.name,
    grams: last.grams == null ? null : round1(last.grams * factor),
    cooked: last.cooked == null ? null : last.cooked === 1,
    proteinG: round1(last.protein_g * factor),
    carbsG: round1(last.carbs_g * factor),
    fatG: round1(last.fat_g * factor),
    kcal: Math.round(last.kcal * factor),
    source: 'text',
    provenance: last.provenance,
  }])
  logEvent('log', { date: row!.date, text: `/again ${arg}`.trim(), ids: [row!.id], kcal: row!.kcal, from: last.id })
  return { ok: true, row: row! }
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
