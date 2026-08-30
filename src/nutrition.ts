/** PRD §7.2. Pure math, no I/O. */

export const ACTIVITIES = ['rest', 'lifting', 'cycling'] as const
export type Activity = (typeof ACTIVITIES)[number]

export type Settings = {
  proteinGoal: number
  deficit: number
  maintenance: Record<Activity, number>
}

export const DEFAULT_SETTINGS: Settings = {
  proteinGoal: 180,
  deficit: 500,
  maintenance: { rest: 2100, lifting: 2400, cycling: 2300 },
}

/** Never let a mis-set maintenance starve the log. */
export const TARGET_FLOOR = 800

/** Grok's kcal may drift this far from the derived figure before we log an error. */
export const KCAL_TOLERANCE = 0.15

const ACTIVITY_ALIASES: Record<string, Activity> = {
  rest: 'rest', off: 'rest', none: 'rest',
  lift: 'lifting', lifting: 'lifting', lifts: 'lifting', gym: 'lifting', weights: 'lifting',
  cycle: 'cycling', cycling: 'cycling', bike: 'cycling', ride: 'cycling',
}

/**
 * One canonical set (PRD §7.1). The bot says `lift`, the DB stores `lifting`,
 * the dashboard shows `Lift`. Unknown input is rejected — never defaulted to rest,
 * because silently logging a rest day quietly changes the calorie target.
 */
export function normalizeActivity(input: string): Activity | null {
  return ACTIVITY_ALIASES[input.trim().toLowerCase()] ?? null
}

export function activityLabel(a: Activity): string {
  return { rest: 'Rest', lifting: 'Lift', cycling: 'Cycle' }[a]
}

/** Mon + Thu lift, Fri cycles, everything else rests. Overridable per day. */
export function defaultActivityFor(weekday: number): Activity {
  if (weekday === 1 || weekday === 4) return 'lifting'
  if (weekday === 5) return 'cycling'
  return 'rest'
}

export function maintenanceFor(activity: Activity, s: Settings): number {
  return s.maintenance[activity]
}

export function targetKcal(activity: Activity, s: Settings): number {
  return Math.max(TARGET_FLOOR, maintenanceFor(activity, s) - s.deficit)
}

/**
 * kcal is derived, never accepted (PRD §7.2). Atwater on total carbs, so
 * fibrous foods read slightly high — the PRD asks us to err high, not low.
 */
export function deriveKcal(proteinG: number, carbsG: number, fatG: number): number {
  return Math.round(4 * proteinG + 4 * carbsG + 9 * fatG)
}

/** True when a supplied kcal is too far from the derived one to be a rounding difference. */
export function kcalDisagrees(derived: number, supplied: number): boolean {
  if (!Number.isFinite(supplied)) return false
  const base = Math.max(derived, 1)
  return Math.abs(supplied - derived) / base > KCAL_TOLERANCE
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
