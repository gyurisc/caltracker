/**
 * Near-miss matching for refused messages.
 *
 * A typo one letter from a food you already taught should say "did you mean",
 * not offer to create a second, misspelled row beside the real one. It only ever
 * suggests: auto-correcting a message into a different food is the silent-wrong-
 * entry failure this app refuses whole messages to avoid.
 */

/**
 * Damerau-Levenshtein: like Levenshtein, but a transposition costs 1 rather
 * than 2. Real typos are mostly transpositions — `pespi` for `pepsi`.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  // Rows for i-2, i-1 and i. Only three are ever needed.
  let twoBack: number[] = []
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)
  let curr: number[] = []

  for (let i = 1; i <= a.length; i++) {
    curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let best = Math.min(
        curr[j - 1]! + 1,      // insertion
        prev[j]! + 1,          // deletion
        prev[j - 1]! + cost,   // substitution
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoBack[j - 2]! + cost) // transposition
      }
      curr[j] = best
    }
    twoBack = prev
    prev = curr
  }
  return prev[b.length]!
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()

/** How far off a phrase may be and still count as the same word. */
export function tolerance(phrase: string): number {
  if (phrase.length <= 4) return 1
  if (phrase.length <= 10) return 2
  return 3
}

/**
 * Candidates close enough to be a typo of `phrase`, nearest first. Exact
 * matches are excluded — the caller only reaches here when nothing matched.
 */
export function nearMatches(phrase: string, candidates: string[], limit = 3): string[] {
  const needle = normalize(phrase)
  if (!needle) return []
  const max = tolerance(needle)

  const scored = candidates
    .map((candidate) => ({ candidate, d: editDistance(needle, normalize(candidate)) }))
    .filter((s) => s.d > 0 && s.d <= max)
    .sort((a, b) => a.d - b.d || a.candidate.length - b.candidate.length)

  const seen = new Set<string>()
  const out: string[] = []
  for (const { candidate } of scored) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    out.push(candidate)
    if (out.length === limit) break
  }
  return out
}
