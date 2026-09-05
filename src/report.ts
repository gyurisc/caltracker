import { lastDays, localDate } from './config.ts'
import { calibrate, TARGET_RATE_HI, TARGET_RATE_LO, type DayPoint } from './calibrate.ts'
import { foodsOn, getDay, getSettings, getSteps, getWeights, recentMisses, totalsFor } from './db.ts'
import { provenanceOf } from './foods.ts'
import { nearMatches } from './similar.ts'
import { vocabTable } from './vocab.ts'
import { activityLabel, deriveKcal, targetKcal } from './nutrition.ts'

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

  return [
    `${date} · ${activityLabel(day.activity)}${day.weight_kg ? ` · ${day.weight_kg} kg` : ''}`,
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
  const entries = needle
    ? all.filter((e) => [e.key, ...e.aliases].some((name) => name.toLowerCase().includes(needle)))
    : all

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
 * The feedback loop: what the scale says about the targets. Intake is what you
 * think you ate; the weight trend says whether the model is calibrated.
 */
export function calibrationReport(windowDays = 28): string {
  const dates = lastDays(windowDays)
  const totals = totalsFor(dates)
  const weights = getWeights(dates)
  const days: DayPoint[] = dates.map((d) => ({
    date: d,
    kcal: totals[d]?.kcal ?? 0,
    weightKg: weights[d] ?? null,
  }))

  const c = calibrate(days)
  const s = getSettings()
  const head = `last ${windowDays} days · ${c.loggedDays} logged · ${c.weighIns} weigh-ins`

  // Steps explain a trend, they never feed the target — the weight trend is the
  // calibration mechanism, and a second activity estimate would muddy it.
  const stepValues = Object.values(getSteps(dates)).filter((v): v is number => v != null)
  const stepLine = stepValues.length
    ? `${n(Math.round(stepValues.reduce((a, b) => a + b, 0) / stepValues.length))} steps/day over ${stepValues.length} days`
    : null

  if (c.verdict === 'not-enough-data') {
    const needs = [
      c.loggedDays < 10 ? `${10 - c.loggedDays} more logged days` : null,
      c.weighIns < 4 ? `${4 - c.weighIns} more weigh-ins` : null,
    ].filter(Boolean)
    return [
      head,
      c.avgKcal == null ? 'no intake yet' : `${n(c.avgKcal)} kcal/day average`,
      c.trendWeightKg == null ? 'no weigh-ins yet' : `${c.trendWeightKg} kg trend`,
      ...(stepLine ? [stepLine] : []),
      '',
      needs.length ? `need ${needs.join(' and ')} before I can estimate` : 'not enough spread yet',
      'weigh every morning, same conditions — that is the input that unlocks this',
    ].join('\n')
  }

  if (c.verdict === 'implausible') {
    const pct0 = (c.ratePctPerWeek ?? 0) * 100
    return [
      head,
      '',
      `${n(c.avgKcal!)} kcal/day average`,
      `${c.trendWeightKg} kg trend · ${c.rateKgPerWeek! > 0 ? '+' : ''}${c.rateKgPerWeek} kg/week (${pct0.toFixed(2)}%)`,
      '',
      'these do not hold together, so I will not estimate a burn rate.',
      'usually mixed sample data, a mistyped weigh-in, or pounds entered as kilos.',
      'pnpm seed:wipe clears the demo fortnight and leaves real rows alone.',
    ].join('\n')
  }

  const pct = (c.ratePctPerWeek ?? 0) * 100
  const band = `${(TARGET_RATE_LO * 100).toFixed(2)}–${(TARGET_RATE_HI * 100).toFixed(2)}%`
  const verdictLine = {
    'on-track': 'on track — change nothing',
    'too-slow': `slower than ${band}/week`,
    'too-fast': `faster than ${band}/week`,
  }[c.verdict]

  const assumed = s.maintenance.rest
  return [
    head,
    '',
    `${n(c.avgKcal!)} kcal/day average`,
    `${c.trendWeightKg} kg trend · ${c.rateKgPerWeek! > 0 ? '+' : ''}${c.rateKgPerWeek} kg/week (${pct.toFixed(2)}%)`,
    '',
    `measured burn ≈ ${n(c.effectiveTDEE!)} kcal/day`,
    `assumed rest maintenance ${n(assumed)} · off by ${n(c.effectiveTDEE! - assumed)}`,
    '',
    ...(stepLine ? [stepLine, ''] : []),
    verdictLine,
    c.adjustKcal === 0
      ? ''
      : c.adjustKcal > 0
        ? `eat about ${n(c.adjustKcal)} kcal/day more`
        : `eat about ${n(Math.abs(c.adjustKcal))} kcal/day less`,
    '',
    'measured burn comes from your own intake and weight trend, not a calculator.',
  ].join('\n')
}
