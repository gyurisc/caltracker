/**
 * `/food` — add or update a row in the vocabulary from a packet label.
 *
 *   /food kefir per100 p3.3 c4 f1
 *   /food kefir per100 p3.3 c4 f1 g250        default serving 250 g
 *   /food bagel each 85g p9 c48 f1.5          countable, 85 g each
 *   /food chicken thigh per100 p24 c0 f11 cooked
 *   /food kefir per100 p3.3 c4 f1 est         a guess, not off a label
 *   /food skyr per100 p11.5 c4 f0.2 +icelandic skyr
 *
 * Never takes kcal: the caller supplies macros and deriveKcal applies 4/4/9.
 */
import { type FoodEntry } from './foods.ts'

export type FoodCommand =
  | { ok: true; entry: FoodEntry }
  | { ok: false; error: string }

const USAGE = 'usage: /food <name> per100|each <n>g p<protein> c<carbs> f<fat> [g<serving>] [raw|cooked] [est] [+alias]'

const num = (token: string, prefix: string): number | null => {
  const m = token.match(new RegExp(`^${prefix}(\\d+(?:\\.\\d+)?)$`))
  return m ? Number(m[1]) : null
}

export function parseFoodCommand(input: string): FoodCommand {
  const tokens = input.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { ok: false, error: USAGE }

  // The name is everything before the basis word, so multi-word foods work.
  const basisAt = tokens.findIndex((t) => t === 'per100' || t === 'each')
  if (basisAt < 1) return { ok: false, error: USAGE }

  const key = tokens.slice(0, basisAt).join(' ')
  const basis = tokens[basisAt] === 'each' ? 'each' : 'per100g'
  const rest = tokens.slice(basisAt + 1)

  let unitGrams: number | null = null
  let defaultGrams: number | null = null
  let proteinG: number | null = null
  let carbsG: number | null = null
  let fatG: number | null = null
  let defaultState: 'raw' | 'cooked' = 'raw'
  let provenance: 'measured' | 'reference' = 'measured'
  const aliases: string[] = []
  let collecting = false

  for (const token of rest) {
    if (token.startsWith('+')) { collecting = true; if (token.length > 1) aliases.push(token.slice(1)); continue }
    if (collecting) { aliases.push(token); continue }

    if (token === 'raw' || token === 'cooked') { defaultState = token; continue }
    if (token === 'est' || token === '~') { provenance = 'reference'; continue }

    const unit = token.match(/^(\d+(?:\.\d+)?)g$/)
    if (unit && basis === 'each' && unitGrams === null) { unitGrams = Number(unit[1]); continue }

    const p = num(token, 'p'); if (p !== null) { proteinG = p; continue }
    const c = num(token, 'c'); if (c !== null) { carbsG = c; continue }
    const f = num(token, 'f'); if (f !== null) { fatG = f; continue }
    const g = num(token, 'g'); if (g !== null) { defaultGrams = g; continue }

    return { ok: false, error: `did not understand "${token}"\n${USAGE}` }
  }

  if (proteinG === null || carbsG === null || fatG === null) {
    return { ok: false, error: `need all three macros: p, c and f\n${USAGE}` }
  }
  if (basis === 'each' && unitGrams === null) {
    return { ok: false, error: `"each" needs the weight of one, e.g. each 85g\n${USAGE}` }
  }
  if ([proteinG, carbsG, fatG].some((v) => v < 0)) return { ok: false, error: 'macros cannot be negative' }
  if (basis === 'per100g' && proteinG + carbsG + fatG > 100) {
    return { ok: false, error: `${proteinG} + ${carbsG} + ${fatG} is more than 100 g per 100 g — are those per serving?` }
  }

  // Multi-word aliases arrive as separate tokens; rejoin and drop the key itself.
  const extra = aliases.join(' ').split(',').map((a) => a.trim()).filter((a) => a && a !== key)

  return {
    ok: true,
    entry: {
      key,
      aliases: [...new Set([...extra, key])],
      basis,
      ...(unitGrams === null ? {} : { unitGrams }),
      ...(defaultGrams === null ? {} : { defaultGrams }),
      defaultState,
      provenance,
      raw: { proteinG, carbsG, fatG },
      ...(defaultState === 'cooked' ? { cooked: { proteinG, carbsG, fatG } } : {}),
    },
  }
}
