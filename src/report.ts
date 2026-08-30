import { localDate } from './config.ts'
import { foodsOn, getDay, getSettings, recentMisses, totalsFor } from './db.ts'
import { provenanceOf } from './foods.ts'
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

/** Everything the parser knows, with the rate each food is logged at. */
export function vocabReport(): string {
  const entries = [...vocabTable().entries].sort((a, b) => a.key.localeCompare(b.key))
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
    `${entries.length} foods`,
    ...lines,
    '',
    '~ never weighed · anything else is refused, not guessed',
  ].join('\n')
}
