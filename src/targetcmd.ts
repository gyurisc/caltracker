/**
 * `/target <field> <value>` — the only way to move a calorie or protein target.
 *
 *   /target                 prints them
 *   /target protein 170     the protein goal, in grams
 *   /target deficit 400     kcal below maintenance
 *   /target rest 2400       maintenance for a rest day
 *   /target lift 2600       …a lifting day. `cycle` too.
 *
 * This exists because `POST /api/settings` was the only way to change these,
 * and a dashboard served to the public internet cannot keep a write route —
 * there is no auth in this app, by design (PRD §15). Telegram is allowlisted to
 * one user id, so it is the surface that can safely hold a write.
 */
import { normalizeActivity, type Activity, type Settings } from './nutrition.ts'

export type TargetCommand =
  // One member per kind, not `'protein' | 'deficit'` in a single one: a union
  // of literals inside a member does not discriminate, so patchFor could not
  // narrow its way to `activity`.
  | { ok: true; kind: 'protein'; value: number }
  | { ok: true; kind: 'deficit'; value: number }
  | { ok: true; kind: 'maintenance'; activity: Activity; value: number }
  | { ok: false; error: string }

const USAGE = 'usage: /target protein 170 · /target deficit 400 · /target rest|lift|cycle 2400'

/**
 * Bounds wide enough for any real person and narrow enough to catch a slip.
 * A maintenance figure is the difference between a sane day and a nonsense one,
 * and nothing downstream questions it.
 */
const RANGE = {
  protein: [1, 400],
  deficit: [0, 1500],
  maintenance: [800, 6000],
} as const

export function parseTargetCommand(input: string): TargetCommand {
  const [field, raw, ...rest] = input.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!field) return { ok: false, error: USAGE }
  if (!raw || rest.length) return { ok: false, error: `${field} needs one number\n${USAGE}` }

  // A Hungarian keyboard types `450,5`; refusing that produced a bare usage
  // line that said nothing about the comma (see foodcmd.ts for the same fix).
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value)) return { ok: false, error: `"${raw}" is not a number\n${USAGE}` }

  const within = (kind: keyof typeof RANGE) => {
    const [lo, hi] = RANGE[kind]
    return value >= lo && value <= hi
  }
  const outOfRange = (kind: keyof typeof RANGE) =>
    ({ ok: false, error: `${value} is outside ${RANGE[kind][0]}–${RANGE[kind][1]} for ${field}` }) as const

  if (field === 'protein') {
    return within('protein') ? { ok: true, kind: 'protein', value } : outOfRange('protein')
  }
  if (field === 'deficit') {
    return within('deficit') ? { ok: true, kind: 'deficit', value } : outOfRange('deficit')
  }

  // Not a known field name, so it has to be an activity — and an unrecognised
  // one is refused rather than defaulted, because a silent `rest` would move
  // the day's target by hundreds of kcal with nothing to say so.
  const activity = normalizeActivity(field)
  if (!activity) return { ok: false, error: `no target called "${field}"\n${USAGE}` }

  return within('maintenance')
    ? { ok: true, kind: 'maintenance', activity, value }
    : outOfRange('maintenance')
}

/** The settings patch a parsed command implies, against the current values. */
export function patchFor(
  cmd: Extract<TargetCommand, { ok: true }>,
  current: Settings,
): Partial<Settings> {
  if (cmd.kind === 'protein') return { proteinGoal: cmd.value }
  if (cmd.kind === 'deficit') return { deficit: cmd.value }
  // saveSettings merges shallowly, so the whole record has to go back.
  return { maintenance: { ...current.maintenance, [cmd.activity]: cmd.value } }
}
