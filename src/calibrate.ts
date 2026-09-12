/**
 * Turns the log into a feedback controller.
 *
 * The maintenance figures in settings are assumptions. What actually happened —
 * intake averaged over weeks against the weight trend over the same weeks — is
 * evidence, and it back-calculates an effective TDEE that no activity
 * calculator can give you. Pure math, no I/O, so it is testable on fixtures.
 */

/** kcal per kg of body mass change. A convention, not a constant of nature. */
export const KCAL_PER_KG = 7700

/** Loss rate worth aiming at, as a fraction of bodyweight per week. */
export const TARGET_RATE_LO = 0.0025
export const TARGET_RATE_HI = 0.005

/**
 * Outside these, the inputs contradict each other — mixed demo data, a mistyped
 * weigh-in, a scale in the wrong unit. Better to say so than to print a
 * confident number derived from nonsense.
 */
export const PLAUSIBLE_TDEE = { lo: 1000, hi: 6000 }
export const PLAUSIBLE_RATE_PCT = 0.02

/**
 * The first week of any deficit sheds water and glycogen, not fat. Weigh-ins
 * inside that window are dropped from the fit — otherwise the whoosh sets the
 * slope and the implied burn rate comes out hundreds of kcal too high.
 */
export const SETTLE_DAYS = 7

/** Below this there is not enough signal to say anything honest. */
export const MIN_LOGGED_DAYS = 10
export const MIN_WEIGH_INS = 4
/** Clean days needed to show a burn estimate at all. */
export const MIN_CLEAN_SPAN = 7
/** Clean days needed before the estimate is allowed to advise a change. */
export const ADVICE_CLEAN_SPAN = 14
/** Above this weekly rate the trend is still water, whatever the span says. */
export const SETTLING_RATE_PCT = 0.01
/**
 * Calendar days from the first weigh-in to the last — NOT the window length,
 * which is a constant and made this guard a no-op. A fortnight is the minimum
 * that outlives the first week's water and glycogen drop; below it the fitted
 * rate is mostly the whoosh, and the burn rate it implies is nonsense.
 */
export const MIN_SPAN_DAYS = 14

export type DayPoint = {
  date: string
  kcal: number
  weightKg: number | null
}

export type Calibration = {
  /** Days in the window that have any food logged. */
  loggedDays: number
  windowDays: number
  weighIns: number
  /** Calendar days from the first weigh-in to the last. */
  weighSpan: number
  /** Calendar days of weigh-ins after the first week's water loss. */
  cleanSpan: number
  /** Mean intake across logged days only — blank days are missing data, not fasts. */
  avgKcal: number | null
  /** Latest trailing 7-day mean weight, which is the number to watch. */
  trendWeightKg: number | null
  /** Least-squares slope over the window, kg per week. Negative is loss. */
  rateKgPerWeek: number | null
  /** That rate as a fraction of bodyweight per week. */
  ratePctPerWeek: number | null
  /** avgKcal + what the weight change implies. Null until the data supports it. */
  effectiveTDEE: number | null
  verdict:
    | 'not-enough-data'
    | 'settling'
    | 'implausible'
    | 'on-track'
    | 'too-slow'
    | 'too-fast'
  /** Suggested change to average daily intake, kcal. 0 when on track. */
  adjustKcal: number
}

/** Trailing mean of the last `window` values, ignoring gaps. */
export function trailingMean(values: (number | null)[], window: number): number | null {
  const recent = values.slice(-window).filter((v): v is number => v != null)
  if (recent.length === 0) return null
  return recent.reduce((a, b) => a + b, 0) / recent.length
}

/**
 * Least-squares slope in units per day. Regression rather than first-vs-last,
 * because a single retained-water morning should not set the trend.
 */
export function slopePerDay(points: { x: number; y: number }[]): number | null {
  if (points.length < 2) return null
  const n = points.length
  const meanX = points.reduce((s, p) => s + p.x, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY)
    den += (p.x - meanX) ** 2
  }
  if (den === 0) return null
  return num / den
}

export function calibrate(days: DayPoint[]): Calibration {
  const logged = days.filter((d) => d.kcal > 0)
  const weights = days
    .map((d, i) => (d.weightKg == null ? null : { x: i, y: d.weightKg }))
    .filter((p): p is { x: number; y: number } => p !== null)

  // Fit on the weigh-ins after the settling window, not on all of them.
  const firstWeighIn = weights.length ? weights[0]!.x : 0
  const clean = weights.filter((p) => p.x >= firstWeighIn + SETTLE_DAYS)
  const fit = clean.length >= MIN_WEIGH_INS ? clean : weights
  const cleanSpan = clean.length ? clean.at(-1)!.x - clean[0]!.x + 1 : 0

  const avgKcal = logged.length ? logged.reduce((s, d) => s + d.kcal, 0) / logged.length : null
  const trendWeightKg = trailingMean(days.map((d) => d.weightKg), 7)

  const perDay = slopePerDay(fit)
  const rateKgPerWeek = perDay == null ? null : perDay * 7
  const ratePctPerWeek =
    rateKgPerWeek == null || !trendWeightKg ? null : rateKgPerWeek / trendWeightKg

  const weighSpan = weights.length ? weights.at(-1)!.x - weights[0]!.x + 1 : 0
  const enough =
    logged.length >= MIN_LOGGED_DAYS &&
    weights.length >= MIN_WEIGH_INS &&
    weighSpan >= MIN_SPAN_DAYS &&
    cleanSpan >= MIN_CLEAN_SPAN

  if (!enough || avgKcal == null || rateKgPerWeek == null) {
    return {
      loggedDays: logged.length,
      windowDays: days.length,
      weighIns: weights.length,
      weighSpan,
      cleanSpan,
      avgKcal: avgKcal == null ? null : Math.round(avgKcal),
      trendWeightKg: trendWeightKg == null ? null : Math.round(trendWeightKg * 10) / 10,
      rateKgPerWeek: rateKgPerWeek == null ? null : Math.round(rateKgPerWeek * 100) / 100,
      ratePctPerWeek,
      effectiveTDEE: null,
      verdict: 'not-enough-data',
      adjustKcal: 0,
    }
  }

  // Energy out = energy in + energy drawn from tissue. Losing weight means the
  // rate is negative, so subtracting it ADDS that tissue energy to the estimate:
  // 1,800 kcal while losing 0.35 kg/week implies burning about 2,185.
  const effectiveTDEE = Math.round(avgKcal - (rateKgPerWeek / 7) * KCAL_PER_KG)

  const lossPct = -(ratePctPerWeek ?? 0)

  if (
    effectiveTDEE < PLAUSIBLE_TDEE.lo ||
    effectiveTDEE > PLAUSIBLE_TDEE.hi ||
    Math.abs(ratePctPerWeek ?? 0) > PLAUSIBLE_RATE_PCT
  ) {
    return {
      loggedDays: logged.length,
      windowDays: days.length,
      weighIns: weights.length,
      weighSpan,
      cleanSpan,
      avgKcal: Math.round(avgKcal),
      trendWeightKg: Math.round(trendWeightKg! * 10) / 10,
      rateKgPerWeek: Math.round(rateKgPerWeek * 100) / 100,
      ratePctPerWeek,
      effectiveTDEE: null,
      verdict: 'implausible',
      adjustKcal: 0,
    }
  }

  // Numbers are shown, but a calorie change needs a clean fortnight AND a rate
  // that is not obviously still water. Wrong advice here is worse than none.
  const settling =
    cleanSpan < ADVICE_CLEAN_SPAN || Math.abs(ratePctPerWeek ?? 0) > SETTLING_RATE_PCT

  let verdict: Calibration['verdict'] = 'on-track'
  if (settling) verdict = 'settling'
  else if (lossPct < TARGET_RATE_LO) verdict = 'too-slow'
  else if (lossPct > TARGET_RATE_HI) verdict = 'too-fast'

  // Aim at the middle of the band, and move intake by whole hundreds — the
  // measurement is not precise enough to justify pretending otherwise.
  const midRate = (TARGET_RATE_LO + TARGET_RATE_HI) / 2
  const wantKcal = effectiveTDEE - (midRate * trendWeightKg! * KCAL_PER_KG) / 7
  const adjustKcal =
    verdict === 'on-track' || verdict === 'settling' ? 0 : Math.round((wantKcal - avgKcal) / 50) * 50

  return {
    loggedDays: logged.length,
    windowDays: days.length,
    weighIns: weights.length,
    weighSpan,
    cleanSpan,
    avgKcal: Math.round(avgKcal),
    trendWeightKg: Math.round(trendWeightKg! * 10) / 10,
    rateKgPerWeek: Math.round(rateKgPerWeek * 100) / 100,
    ratePctPerWeek,
    effectiveTDEE,
    verdict,
    adjustKcal,
  }
}
