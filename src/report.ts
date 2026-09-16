import { lastDays, localDate } from './config.ts'
import {
  ADVICE_CLEAN_SPAN, calibrate, SETTLE_DAYS, TARGET_RATE_HI, TARGET_RATE_LO, type DayPoint,
} from './calibrate.ts'
import {
  foodsOn, getDay, getSettings, getSteps, getWaists, getWeights, recentMisses, totalsFor,
  visionCorrections, visionCounts, whoopDays,
} from './db.ts'
import { provenanceOf } from './foods.ts'
import { matchTier, nearMatches } from './similar.ts'
import { vocabTable } from './vocab.ts'
import { activityLabel, deriveKcal, formulaMaintenance, round1, targetKcal } from './nutrition.ts'

export const n = (v: number) => Math.round(v).toLocaleString('en-US')

/** `1,234 / 1,600 kcal · 98 / 180 g P` — the one-line status both surfaces append. */
export function todayLine(date = localDate()): string {
  const s = getSettings()
  const day = getDay(date)
  const t = totalsFor([date])[date]!
  return `${n(t.kcal)} / ${n(targetKcal(day.activity, s))} kcal · ${t.proteinG.toFixed(0)} / ${s.proteinGoal} g P`
}

/** The body of `/today`: header, item lines, status, remaining. */
export function todayReport(date = localDate()): string {
  const day = getDay(date)
  const items = foodsOn(date)
  const s = getSettings()
  const t = totalsFor([date])[date]!
  const target = targetKcal(day.activity, s)

  const lines = items.length
    ? items.map((i) => {
        const grams = i.grams ? ` ${i.grams}g${i.cooked == null ? '' : i.cooked ? ' cooked' : ' raw'}` : ''
        const est = i.provenance === 'measured' ? '' : '~'
        return `${i.time}  ${i.name}${grams} · ${i.protein_g.toFixed(0)}g P · ${est}${n(i.kcal)} kcal`
      })
    : ['Nothing logged yet.']

  // WHOOP's figures ride on the header line, where the day is described — not
  // among the totals, which are what the target is judged against. Strain is
  // context; putting it beside the calories would invite reading it as one.
  const whoop = [
    day.strain == null ? '' : `strain ${day.strain.toFixed(1)}`,
    day.sleep_h == null ? '' : `${day.sleep_h.toFixed(1)}h sleep`,
    day.recovery == null ? '' : `${Math.round(day.recovery)}% rec`,
  ].filter(Boolean).join(' · ')

  return [
    `${date} · ${activityLabel(day.activity)}${day.weight_kg ? ` · ${day.weight_kg} kg` : ''}`,
    ...(whoop ? [whoop] : []),
    ...lines,
    '',
    todayLine(date),
    target - t.kcal >= 0 ? `${n(target - t.kcal)} kcal left` : `${n(t.kcal - target)} kcal over`,
    ...(items.some((i) => i.provenance !== 'measured') ? ['', '~ estimate, never weighed'] : []),
  ].join('\n')
}

/** The vocabulary backlog: what the parser refused, most frequent first. */
export function missesReport(days = 30): string {
  const misses = recentMisses(days)
  if (misses.length === 0) return `No refused messages in the last ${days} days.`

  const width = Math.max(...misses.map((m) => m.phrase.length))
  const lines = misses.map((m) => {
    const times = m.count === 1 ? '' : ` ×${m.count}`
    return `${m.phrase.padEnd(width)}${times}  · last ${m.lastSeen.replace('T', ' ')}  "${m.lastText}"`
  })

  return [
    `refused in the last ${days} days · ${misses.length} phrase${misses.length === 1 ? '' : 's'}`,
    ...lines,
    '',
    'Each is a missing row in the vocab table (seed rows live in src/foods.ts).',
  ].join('\n')
}

/**
 * Everything the parser knows, with the rate each food is logged at. A query
 * filters on the key and every alias, so `cola` finds `coca cola zero`.
 */
export function vocabReport(query = ''): string {
  const needle = query.trim().toLowerCase()
  const all = [...vocabTable().entries].sort((a, b) => a.key.localeCompare(b.key))
  // Keep only the best tier of match that exists, so `cola` returns coca cola
  // and not chocolate — the letters are in `chocolate`, mid-word, and that hit
  // is noise next to a real one.
  const scored = needle
    ? all.map((e) => ({ e, tier: matchTier([e.key, ...e.aliases], needle) })).filter((m) => m.tier >= 0)
    : all.map((e) => ({ e, tier: 0 }))
  // Exact and word-start are both real matches and belong together: searching
  // `milk` should show `ikea milk chocolate` beside `milk`. Only when neither
  // exists does the mid-word tier get shown at all.
  const bestTier = scored.length ? Math.min(...scored.map((m) => m.tier)) : 0
  const cutoff = Math.max(bestTier, 1)
  const entries = scored
    .filter((m) => m.tier <= cutoff)
    .sort((a, b) => a.tier - b.tier || a.e.key.localeCompare(b.e.key))
    .map((m) => m.e)

  if (entries.length === 0) {
    // Compare against single words too: `kola` is far from `coca cola zero`
    // as a whole, but one edit from the word inside it.
    const aliases = all.flatMap((e) => e.aliases)
    const words = [...new Set(aliases.flatMap((a) => a.split(' ')))]
    const hitWords = new Set(nearMatches(needle, words, 5))
    const near = [
      ...nearMatches(needle, aliases, 3),
      ...aliases.filter((a) => a.split(' ').some((w) => hitWords.has(w))),
    ]
    return [
      `nothing matching "${query.trim()}"`,
      ...(near.length ? [`did you mean: ${[...new Set(near)].join(', ')}?`] : []),
      `${all.length} foods in total · /foods with no search lists them`,
    ].join('\n')
  }

  const width = Math.max(...entries.map((e) => e.key.length))

  const lines = entries.map((e) => {
    const macros = (e.defaultState === 'cooked' ? e.cooked : e.raw) ?? e.raw ?? e.cooked!
    const kcal = macros.kcal ?? deriveKcal(macros.proteinG, macros.carbsG, macros.fatG)
    const per = e.basis === 'each' ? `each ${e.unitGrams ?? 0} g` : 'per 100 g'
    const est = provenanceOf(e) === 'measured' ? ' ' : '~'
    const also = e.aliases.filter((a) => a !== e.key)
    return [
      `${e.key.padEnd(width)} ${est}${String(Math.round(kcal)).padStart(4)} kcal`,
      `${macros.proteinG.toFixed(1).padStart(5)} g P`,
      `${per}${also.length ? `  · ${also.join(', ')}` : ''}`,
    ].join(' · ')
  })

  return [
    needle ? `${entries.length} of ${all.length} foods matching "${query.trim()}"` : `${entries.length} foods`,
    ...lines,
    '',
    '~ never weighed · anything else is refused, not guessed',
  ].join('\n')
}

/**
 * The feedback loop, in stages. From day one it shows intake, weight and a
 * formula estimate; it only prints a measured burn rate once the weigh-ins
 * outlive the first week's water loss, and only advises a change after that.
 */
export function calibrationReport(windowDays = 28): string {
  const dates = lastDays(windowDays)
  const totals = totalsFor(dates)
  const weights = getWeights(dates)
  const stepsByDate = getSteps(dates)
  const days: DayPoint[] = dates.map((d) => ({
    date: d,
    kcal: totals[d]?.kcal ?? 0,
    weightKg: weights[d] ?? null,
  }))

  const c = calibrate(days)
  const s = getSettings()

  const stepValues = Object.values(stepsByDate).filter((v): v is number => v != null)
  const avgSteps = stepValues.length
    ? Math.round(stepValues.reduce((a, b) => a + b, 0) / stepValues.length)
    : null

  const assumed = s.maintenance.rest
  const formula = c.trendWeightKg == null ? null : formulaMaintenance(c.trendWeightKg, s, avgSteps)

  /** Available from the first logged day. */
  const basics = [
    `last ${windowDays} days · ${c.loggedDays} logged · ${c.weighIns} weigh-ins over ${c.weighSpan} days`,
    '',
    c.avgKcal == null ? 'no intake logged yet' : `${n(c.avgKcal)} kcal/day average`,
    c.trendWeightKg == null ? 'no weigh-ins yet' : `${c.trendWeightKg} kg trend`,
    ...(avgSteps ? [`${n(avgSteps)} steps/day over ${stepValues.length} days`] : []),
  ]

  /** A hypothesis to start from, never a measurement. */
  const hypothesis = formula
    ? [
        '',
        `formula says ${n(formula)} kcal/day · you assumed ${n(assumed)} · off by ${n(formula - assumed)}`,
        'that is a calculator, not your body — the weight trend replaces it',
      ]
    : []

  if (c.verdict === 'not-enough-data') {
    const needs = [
      c.loggedDays < 10 ? `${10 - c.loggedDays} more logged days` : null,
      c.weighIns < 4 ? `${4 - c.weighIns} more weigh-ins` : null,
      c.weighSpan < 14 ? `${14 - c.weighSpan} more days of weighing` : null,
    ].filter(Boolean)
    return [
      ...basics,
      ...hypothesis,
      '',
      needs.length ? `need ${needs.join(' and ')} before I can measure` : 'not enough spread yet',
      'weigh every morning, same conditions — that is what unlocks the measured figure',
    ].join('\n')
  }

  const pct = (c.ratePctPerWeek ?? 0) * 100
  const rateLine =
    `${c.rateKgPerWeek! > 0 ? '+' : ''}${c.rateKgPerWeek} kg/week (${pct.toFixed(2)}%)` +
    ` · fitted after the first ${SETTLE_DAYS} days`

  if (c.verdict === 'implausible' || c.verdict === 'settling') {
    const why = c.verdict === 'implausible'
      ? [
          'these do not hold together, so no burn rate.',
          'usually mixed sample data, a mistyped weigh-in, or pounds entered as kilos.',
        ]
      : [
          `${c.cleanSpan} settled days is too few for a burn rate, so I am not printing one.`,
          ADVICE_CLEAN_SPAN - c.cleanSpan > 0
            ? `${ADVICE_CLEAN_SPAN - c.cleanSpan} more mornings on the scale and it turns on.`
            : 'the rate has to steady first — this one is still moving too fast to be fat.',
        ]
    return [...basics, rateLine, ...hypothesis, '', ...why].join('\n')
  }

  const band = `${(TARGET_RATE_LO * 100).toFixed(2)}–${(TARGET_RATE_HI * 100).toFixed(2)}%`
  const verdictLine = {
    'on-track': 'on track — change nothing',
    'too-slow': `slower than ${band}/week`,
    'too-fast': `faster than ${band}/week`,
  }[c.verdict]

  return [
    ...basics,
    rateLine,
    '',
    `measured burn ${n(c.effectiveTDEE!)} kcal/day`,
    `assumed rest maintenance ${n(assumed)} · off by ${n(c.effectiveTDEE! - assumed)}`,
    '',
    verdictLine,
    ...(c.adjustKcal === 0
      ? []
      : [c.adjustKcal > 0
          ? `eat about ${n(c.adjustKcal)} kcal/day more`
          : `eat about ${n(Math.abs(c.adjustKcal))} kcal/day less`]),
    '',
    'measured burn comes from your own intake and weight trend, not a calculator.',
  ].join('\n')
}

/**
 * What the photo reader has been getting right and wrong. The corrections are
 * the substance: a guessed weight beside a weighed one is the only portion
 * ground truth this app collects, and the bias line is the first thing a future
 * calibration would use.
 */
export function visionReport(days = 90): string {
  const counts = visionCounts(days)
  const proposed = counts.proposed ?? 0
  if (proposed === 0) return `no photos read in the last ${days} days`

  const fixes = visionCorrections(days)
  const withBoth = fixes.filter((f) => f.proposedGrams != null && f.proposedGrams > 0)
  const errors = withBoth.map((f) => (f.proposedGrams! - f.actualGrams) / f.actualGrams)
  const bias = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null

  const labels = counts['label.proposed'] ?? 0
  const meals = counts['meal.proposed'] ?? 0

  const lines = [
    `photo cards · last ${days} days`,
    `${proposed} read · ${counts.accepted ?? 0} kept · ${counts.rejected ?? 0} dropped`,
    '',
    // A label read is worth more than a plate read: it becomes a measured row
    // that every later meal reuses, where a plate is one estimate and then gone.
    `${labels} label${labels === 1 ? '' : 's'} · ${counts['label.accepted'] ?? 0} added to your table`,
    `${meals} plate${meals === 1 ? '' : 's'} · ${counts['meal.accepted'] ?? 0} logged` +
      `  · ${fixes.length} portion${fixes.length === 1 ? '' : 's'} corrected`,
  ]

  if (bias != null) {
    const pct = Math.round(Math.abs(bias) * 100)
    lines.push(
      '',
      pct < 5
        ? `no consistent bias — off by ${pct}% on average`
        : `runs ${bias > 0 ? 'heavy' : 'light'} by ${pct}% on the portions you corrected`,
      `over ${errors.length} correction${errors.length === 1 ? '' : 's'} — too few to calibrate on yet`,
    )
  }

  if (fixes.length) {
    lines.push('', ...fixes.slice(-8).map((f) =>
      `${f.ts.slice(5, 10)}  ${f.name}  guessed ${f.proposedGrams ?? '?'}g → ${f.actualGrams}g` +
      (f.countPath ? '  (counted)' : '')))
  }

  return lines.join('\n')
}

/**
 * Waist over time. Deliberately separate from the calorie calibration, which it
 * must never feed: the two answer different questions. The scale cannot tell
 * fat from water from muscle, and a waist that falls while the scale holds
 * steady is the outcome the training is for, not a contradiction to resolve.
 *
 * Thresholds are the WHO/NICE ones for men, quoted as reference points.
 */
export function waistReport(days = 180): string {
  const dates = lastDays(days)
  const waists = getWaists(dates)
  const points = dates
    .map((d) => ({ date: d, cm: waists[d] }))
    .filter((p): p is { date: string; cm: number } => typeof p.cm === 'number')

  if (points.length === 0) return 'no waist measurements yet — /waist 98'

  const latest = points[points.length - 1]!
  const first = points[0]!
  const lines = [`waist ${latest.cm} cm · ${latest.date}`]

  if (points.length > 1) {
    const delta = latest.cm - first.cm
    const weeks = Math.max(1, Math.round(
      (Date.parse(`${latest.date}T12:00:00Z`) - Date.parse(`${first.date}T12:00:00Z`)) / 6.048e8,
    ))
    lines.push(
      `${delta === 0 ? 'no change' : `${delta > 0 ? '+' : ''}${round1(delta)} cm`} over ${weeks} week${weeks === 1 ? '' : 's'}`,
      '',
      ...points.slice(-8).map((p) => `${p.date}  ${p.cm} cm`),
    )
  } else {
    lines.push('one measurement so far — a trend needs a few weeks of them')
  }

  // Reference points, not a verdict. Same tape, same spot, same time of day is
  // what makes the series comparable; the absolute number matters less.
  lines.push(
    '',
    latest.cm >= 102 ? 'men: 94 cm and 102 cm are the usual reference marks — above the second'
      : latest.cm >= 94 ? 'men: 94 cm and 102 cm are the usual reference marks — between the two'
      : 'men: 94 cm and 102 cm are the usual reference marks — below both',
    'measure at the navel, on a breath out, before eating',
  )
  return lines.join('\n')
}

/**
 * What WHOOP saw. Shown beside the day, never folded into it: §17 makes workout
 * kcal display-only, and the burn rate `/trend` reports stays the one derived
 * from intake against the weight trend.
 */
export function whoopReport(days = 7): string {
  const dates = lastDays(days)
  const rows = whoopDays(dates)
  const seen = dates.map((d) => rows[d]).filter((r): r is NonNullable<typeof r> =>
    Boolean(r && (r.sleep_h != null || r.recovery != null || r.strain != null)))

  if (seen.length === 0) return 'no WHOOP data yet — /whoop sync'

  const lines = [`whoop · last ${days} days`, '']
  for (const d of dates) {
    const r = rows[d]
    if (!r || (r.sleep_h == null && r.recovery == null && r.strain == null)) continue
    lines.push(
      `${d.slice(5)}  ` +
      `${r.sleep_h == null ? '  — ' : `${r.sleep_h.toFixed(1)}h`} sleep · ` +
      `${r.recovery == null ? ' —' : String(Math.round(r.recovery)).padStart(2)}% rec · ` +
      `strain ${r.strain == null ? '—' : r.strain.toFixed(1)}` +
      (r.whoop_kcal == null ? '' : ` · ${n(r.whoop_kcal)} kcal`),
    )
  }

  lines.push('', 'context for reading the trend, not an input to it —', 'the target stays on maintenance by activity')
  return lines.join('\n')
}
