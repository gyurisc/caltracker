/**
 * PRD §7.4. Local food table first: if every chunk of a message hits the table,
 * the message never reaches Grok.
 */
import { localHour } from './config.ts'
import { provenanceOf, SEED_FOODS, type FoodEntry, type Provenance } from './foods.ts'
import { deriveKcal, round1 } from './nutrition.ts'

export const MEAL_TAGS = ['breakfast', 'lunch', 'snack', 'dinner'] as const
export type MealTag = (typeof MEAL_TAGS)[number]


/**
 * A vocabulary ready to parse against. The alias index is precomputed longest
 * first, so `black coffee` beats `coffee` and `ground beef` beats `beef`.
 */
export type FoodTable = {
  entries: FoodEntry[]
  aliasIndex: { alias: string; entry: FoodEntry }[]
}

export function buildTable(entries: FoodEntry[]): FoodTable {
  return {
    entries,
    aliasIndex: entries
      .flatMap((entry) => entry.aliases.map((alias) => ({ alias, entry })))
      .sort((a, b) => b.alias.length - a.alias.length),
  }
}

/**
 * The seed rows, for tests and for any caller with no database. Production goes
 * through `vocabTable()` so a food added at runtime is visible immediately.
 */
export const SEED_TABLE = buildTable(SEED_FOODS)

export type ParsedItem = {
  name: string
  provenance: Provenance
  grams: number | null
  cooked: boolean | null
  mealTag: MealTag | null
  proteinG: number
  carbsG: number
  fatG: number
  kcal: number
}

export type ParseResult =
  | { ok: true; items: ParsedItem[] }
  /** `needsState` holds foods that matched but did not say raw or cooked. */
  | { ok: false; unmatched: string[]; needsState: string[] }

/** Never crashes at midnight: hour 0 is breakfast. */
export function mealTagFromClock(hour: number = localHour()): MealTag {
  if (hour < 11) return 'breakfast'
  if (hour < 15) return 'lunch'
  if (hour < 18) return 'snack'
  return 'dinner'
}

function findMealWord(text: string): MealTag | null {
  for (const tag of MEAL_TAGS) if (new RegExp(`\\b${tag}\\b`).test(text)) return tag
  if (/\bsupper\b/.test(text)) return 'dinner'
  if (/\bbrekkie\b|\bbreakfast\b/.test(text)) return 'breakfast'
  return null
}

function splitChunks(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/\band\b/g, ',')
    .split(/[,\n+]|\bwith\b|\bplus\b/)
    .map((c) => c.trim())
    .filter(Boolean)
}

function readGrams(chunk: string): number | null {
  const kg = chunk.match(/(\d+(?:\.\d+)?)\s*kg\b/)
  if (kg) return Number(kg[1]) * 1000
  const g = chunk.match(/(\d+(?:\.\d+)?)\s*(?:g|gr|gram|grams|ml)\b/)
  if (g) return Number(g[1])
  return null
}

function readCount(chunk: string): number | null {
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
  const w = chunk.match(/^\s*(a|an|one|two|three|four|five|six)\b/)
  if (w) return words[w[1]!]!
  // A bare leading number that is not a weight: "2 eggs", not "170g".
  const n = chunk.match(/^\s*(\d+(?:\.\d+)?)(?!\s*(?:g|gr|gram|grams|kg|ml)\b)\s*/)
  if (n) return Number(n[1])
  return null
}

function readFraction(chunk: string): number | null {
  const m = chunk.match(/\b(?:half|halve|quarter|third)\b|1\/2|1\/4|3\/4/)
  if (!m) return null
  return FRACTIONS[m[0] === 'halve' ? 'half' : m[0]] ?? null
}

/** Grams for a named portion — the food's own table wins over the generic one. */
function readPortion(chunk: string, entry: FoodEntry): number | null {
  const table = { ...GENERIC_PORTIONS, ...(entry.portions ?? {}) }
  for (const noun of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${noun}s?\\b`).test(chunk)) return table[noun]!
  }
  return null
}

function readState(chunk: string): 'raw' | 'cooked' | null {
  if (/\bcooked\b|\bgrilled\b|\bfried\b|\bpan.?fried\b|\bbrowned\b|\bboiled\b|\broasted\b/.test(chunk)) return 'cooked'
  if (/\braw\b|\buncooked\b|\bdry\b/.test(chunk)) return 'raw'
  return null
}

/** Grams for a named portion, when the food itself does not override it. */
const GENERIC_PORTIONS: Record<string, number> = {
  tbsp: 15, tablespoon: 15, tsp: 5, teaspoon: 5,
  cup: 240, glass: 250, bowl: 250, plate: 300,
  scoop: 30, handful: 30, piece: 50, slice: 30, square: 10, bar: 100,
}
const PORTION_WORDS = new RegExp(
  `\\b(?:${Object.keys(GENERIC_PORTIONS).join('|')}|pot|tub|glug|drizzle|splash|dash|row|whole)s?\\b`, 'g')

/** Fractions of a normal serving. */
const FRACTIONS: Record<string, number> = {
  half: 0.5, quarter: 0.25, third: 0.34, '1/2': 0.5, '1/4': 0.25, '3/4': 0.75,
}
const FRACTION_WORDS = /\b(?:half|halve|quarter|third)\b|(?:1\/2|1\/4|3\/4)/g

/**
 * Adjectives that do not change the macros of any row in this table.
 * Anything that DOES change them (fat free, skimmed, low fat) is deliberately
 * absent, so it refuses instead of logging the wrong row.
 */
const NOISE_WORDS =
  /\b(?:large|small|medium|big|extra|fresh|organic|plain|free.range|scrambled|poached|hard|soft|home.?made|left.?over)\b/g

const QUANTITY = /\b\d+(?:\.\d+)?\s*(?:g|gr|gram|grams|kg|ml)?\b/g
const NUMBER_WORDS = /\b(?:a|an|one|two|three|four|five|six)\b/g
const STATE_WORDS = /\b(?:cooked|grilled|fried|pan.?fried|browned|boiled|roasted|raw|uncooked|dry)\b/g
const MEAL_WORDS = /\b(?:breakfast|lunch|snack|dinner|supper|brekkie)\b/g
const FILLER = /\b(?:the|of|some|with|plus|and|my|for)\b/g

type Match = { entry: FoodEntry; start: number; end: number }

/**
 * Every food in the chunk, longest alias first and non-overlapping, so
 * `black coffee` beats `coffee` and two foods in one breath both survive.
 */
function findMatches(chunk: string, table: FoodTable): Match[] {
  const taken: [number, number][] = []
  const found: Match[] = []
  for (const { alias, entry } of table.aliasIndex) {
    const re = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(chunk)) !== null) {
      const start = m.index
      const end = start + m[0].length
      if (taken.some(([s, e]) => start < e && end > s)) continue
      taken.push([start, end])
      found.push({ entry, start, end })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/**
 * Whatever the matched foods and their modifiers did not account for.
 * Anything left with letters in it is an unknown food, and the message is
 * refused rather than logged short — a silent undercount is worse than a no.
 */
function residual(chunk: string, matches: Match[]): string {
  let rest = chunk
  for (const m of matches) {
    rest = rest.slice(0, m.start) + ' '.repeat(m.end - m.start) + rest.slice(m.end)
  }
  return rest
    .replace(FRACTION_WORDS, ' ')
    .replace(QUANTITY, ' ')
    .replace(PORTION_WORDS, ' ')
    .replace(NOISE_WORDS, ' ')
    .replace(NUMBER_WORDS, ' ')
    .replace(STATE_WORDS, ' ')
    .replace(MEAL_WORDS, ' ')
    .replace(FILLER, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

/**
 * The food-shaped part of a refused chunk: `1 palacsinta` -> `palacsinta`.
 * Used to prefill a `/food` template, so the reply to a refusal is actionable.
 */
export function bareFoodName(chunk: string): string {
  return residual(chunk.toLowerCase(), [])
}

/**
 * A count immediately before a food belongs to that food, not to the previous
 * one: in `rice 200g 2 eggs` the `2` is the eggs'.
 */
function segmentStart(chunk: string, at: number): number {
  const before = chunk.slice(0, at)
  // A trailing run of quantity words belongs to the food that follows:
  // in `rice 200g half an avocado`, `half an` is the avocado's.
  const lead = before.match(
    /(?:\b(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|half|halve|quarter|third|of|tbsp|tablespoons?|tsp|teaspoons?|cups?|glass|glasses|bowls?|plates?|scoops?|handfuls?|pieces?|slices?|squares?|bars?|pots?|tubs?)\b\s*|1\/2\s*|1\/4\s*|3\/4\s*)+$/,
  )
  return lead ? at - lead[0].length : at
}

function buildItem(entry: FoodEntry, segment: string, mealTag: MealTag | null): ParsedItem {
  const chunk = segment
  const state = readState(chunk) ?? entry.defaultState
  const macros = (state === 'cooked' ? entry.cooked : entry.raw) ?? entry.raw ?? entry.cooked!
  const grams = readGrams(chunk)
  const count = readCount(chunk)
  const fraction = readFraction(chunk)
  const portion = readPortion(chunk, entry)
  const unit = entry.unitGrams ?? 100

  // An explicit weight beats everything; then a named portion; then units.
  let finalGrams: number
  if (grams != null) {
    finalGrams = grams
  } else if (portion != null) {
    finalGrams = portion * (count ?? 1) * (fraction ?? 1)
  } else if (entry.basis === 'each') {
    finalGrams = unit * (count ?? 1) * (fraction ?? 1)
  } else {
    finalGrams = (entry.defaultGrams ?? 100) * (count ?? 1) * (fraction ?? 1)
  }

  finalGrams = Math.round(finalGrams * 10) / 10
  const factor = entry.basis === 'each' ? finalGrams / unit : finalGrams / 100

  const proteinG = round1(macros.proteinG * factor)
  const carbsG = round1(macros.carbsG * factor)
  const fatG = round1(macros.fatG * factor)
  // Table constants may carry a trace kcal that no macro accounts for; everything else derives.
  const kcal = macros.kcal != null ? Math.round(macros.kcal * factor) : deriveKcal(proteinG, carbsG, fatG)

  const isCooked = entry.raw && entry.cooked && entry.basis === 'per100g' ? state === 'cooked' : null

  return {
    name: entry.key, provenance: provenanceOf(entry), grams: finalGrams, cooked: isCooked,
    mealTag, proteinG, carbsG, fatG, kcal,
  }
}

/**
 * Every chunk must hit the table. One miss and the whole message is handed off
 * (to vision, or to a confirm card) rather than half-logged.
 */
export function parseMessage(
  message: string,
  now: Date = new Date(),
  table: FoodTable = SEED_TABLE,
): ParseResult {
  const chunks = splitChunks(message)
  if (chunks.length === 0) return { ok: false, unmatched: [], needsState: [] }

  const messageMeal = findMealWord(message.toLowerCase())
  const mealTag = messageMeal ?? mealTagFromClock(Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: process.env.TZ || 'Europe/Amsterdam' }).format(now),
  ))

  const items: ParsedItem[] = []
  const unmatched: string[] = []
  const needsState: string[] = []

  for (const chunk of chunks) {
    const matches = findMatches(chunk, table)
    const leftover = residual(chunk, matches)

    // A chunk that is only a meal word ("lunch:") is context, not food.
    if (matches.length === 0 && leftover.length === 0) continue

    // Refuse the chunk if anything in it went unrecognized, rather than
    // logging the part we understood and dropping the rest.
    if (matches.length === 0 || leftover.length > 1) { unmatched.push(chunk); continue }

    const bounds = matches.map((m, i) => (i === 0 ? 0 : segmentStart(chunk, m.start)))
    const segments = matches.map((m, i) => chunk.slice(bounds[i]!, bounds[i + 1] ?? chunk.length))

    // Some foods weigh so differently dry and cooked that guessing is worse
    // than refusing. Ask instead of defaulting.
    const ambiguous = matches
      .map((m, i) => (m.entry.stateRequired && readState(segments[i]!) === null ? m.entry.key : null))
      .filter((k): k is string => k !== null)
    if (ambiguous.length) { needsState.push(...ambiguous); continue }

    matches.forEach((m, i) => {
      items.push(buildItem(m.entry, segments[i]!, mealTag))
    })
  }

  if (unmatched.length > 0 || needsState.length > 0 || items.length === 0) {
    return { ok: false, unmatched, needsState }
  }
  return { ok: true, items }
}
