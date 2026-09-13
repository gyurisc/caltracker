/**
 * Correcting a portion on a photo card.
 *
 * The model judges mass from a photo badly, and the user is standing next to a
 * kitchen scale. So the card has to be editable before it is logged, and every
 * edit is worth recording: a correction is the only ground truth this app will
 * ever have about portion sizes — a real weight, on real food, on a plate the
 * model had already guessed at.
 *
 * The parse is deliberately narrow. `20g` on its own, or `pancake 20g`, and
 * nothing else. A phrase that does not clearly point at something already on
 * the card is not a correction; it is a new meal, and it must fall through to
 * the normal logging path. Guessing wrong here would silently swallow a log.
 */

/** `20g`, `20 g`, `20 gramm`, `1.5g`, `1,5 g` — a weight and nothing else. */
const BARE_WEIGHT = /^(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramm?|grams?)$/i
/** The same, with a name in front: `pancake 20g`. */
const NAMED_WEIGHT = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:g|gr|gramm?|grams?)$/i

export type Correction = { name: string | null; grams: number }

export function parseCorrection(text: string): Correction | null {
  const t = text.trim().toLowerCase()
  if (!t) return null

  const bare = BARE_WEIGHT.exec(t)
  if (bare) return { name: null, grams: Number(bare[1]!.replace(',', '.')) }

  const named = NAMED_WEIGHT.exec(t)
  if (named) return { name: named[1]!.trim(), grams: Number(named[2]!.replace(',', '.')) }

  return null
}

/**
 * Which row on the card the correction points at, or -1 for none.
 *
 * A bare weight is only unambiguous on a one-row card. A named weight has to
 * name a row that is actually there — `pancake 20g` while the card holds rice
 * is someone logging a pancake, not correcting the rice.
 */
export function targetIndex(c: Correction, names: string[]): number {
  if (c.name == null) return names.length === 1 ? 0 : -1

  const exact = names.findIndex((n) => n === c.name)
  if (exact !== -1) return exact

  // `chicken 200g` should reach a row called `chicken breast`.
  const partial = names.findIndex((n) => n.includes(c.name!) || c.name!.includes(n))
  return partial
}
