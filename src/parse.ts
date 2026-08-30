/**
 * PRD §7.4. Local food table first: if every chunk of a message hits the table,
 * the message never reaches Grok.
 */
import { localHour } from './config.ts'
import { deriveKcal, round1 } from './nutrition.ts'

export const MEAL_TAGS = ['breakfast', 'lunch', 'snack', 'dinner'] as const
export type MealTag = (typeof MEAL_TAGS)[number]

type Macros = {
  proteinG: number
  carbsG: number
  fatG: number
  /**
   * Only for table constants whose calories do not come from macros at all
   * (brewed coffee's ~2 kcal is trace compounds). Everything else derives.
   */
  kcal?: number
}

type FoodEntry = {
  key: string
  aliases: string[]
  basis: 'per100g' | 'each'
  unitGrams?: number
  unitNoun?: string
  defaultGrams?: number
  defaultState: 'raw' | 'cooked'
  raw?: Macros
  cooked?: Macros
}

/** Per 100 g unless basis is `each`, in which case macros are per unit. */
export const FOOD_TABLE: FoodEntry[] = [
  { key: 'black coffee', aliases: ['black coffee', 'coffee', 'espresso', 'americano'],
    basis: 'each', unitGrams: 240, unitNoun: 'cup', defaultState: 'raw',
    raw: { proteinG: 0.3, carbsG: 0, fatG: 0, kcal: 2 } },

  { key: 'tea', aliases: ['green tea', 'black tea', 'tea'],
    basis: 'each', unitGrams: 240, unitNoun: 'cup', defaultState: 'raw',
    raw: { proteinG: 0, carbsG: 0, fatG: 0, kcal: 0 } },

  { key: 'banana', aliases: ['banana', 'bananas'],
    basis: 'each', unitGrams: 118, defaultState: 'raw',
    raw: { proteinG: 1.3, carbsG: 27, fatG: 0.4 } },

  // 85/15 beef mince — the canonical entry, PRD §7.4.
  { key: 'minced meat', aliases: ['minced meat', 'minced meet', 'minced beef', 'ground beef', 'mince', 'gehakt'],
    basis: 'per100g', defaultGrams: 150, defaultState: 'cooked',
    raw: { proteinG: 18.6, carbsG: 0, fatG: 15.0 },
    cooked: { proteinG: 25.7, carbsG: 0, fatG: 16.0 } },

  { key: 'steak', aliases: ['steak', 'sirloin', 'ribeye'],
    basis: 'per100g', defaultGrams: 200, defaultState: 'cooked',
    raw: { proteinG: 22, carbsG: 0, fatG: 6 },
    cooked: { proteinG: 29, carbsG: 0, fatG: 9 } },

  { key: 'chicken', aliases: ['chicken breast', 'chicken'],
    basis: 'per100g', defaultGrams: 150, defaultState: 'cooked',
    raw: { proteinG: 23, carbsG: 0, fatG: 2.6 },
    cooked: { proteinG: 31, carbsG: 0, fatG: 3.6 } },

  { key: 'salmon', aliases: ['salmon'],
    basis: 'per100g', defaultGrams: 150, defaultState: 'cooked',
    raw: { proteinG: 20, carbsG: 0, fatG: 13 },
    cooked: { proteinG: 25, carbsG: 0, fatG: 13 } },

  { key: 'rice', aliases: ['white rice', 'brown rice', 'rice'],
    basis: 'per100g', defaultGrams: 200, defaultState: 'cooked',
    raw: { proteinG: 7.1, carbsG: 80, fatG: 0.7 },
    cooked: { proteinG: 2.7, carbsG: 28, fatG: 0.3 } },

  { key: 'lettuce', aliases: ['lettuce', 'salad greens', 'rocket'],
    basis: 'per100g', defaultGrams: 50, defaultState: 'raw',
    raw: { proteinG: 1.4, carbsG: 2.9, fatG: 0.2 } },

  { key: 'olive oil', aliases: ['olive oil', 'oil'],
    basis: 'per100g', defaultGrams: 14, defaultState: 'raw',
    raw: { proteinG: 0, carbsG: 0, fatG: 100 } },

  { key: 'yogurt', aliases: ['greek yogurt', 'yoghurt', 'yogurt', 'yopro', 'skyr', 'quark'],
    basis: 'per100g', defaultGrams: 150, defaultState: 'raw',
    raw: { proteinG: 11, carbsG: 4, fatG: 0.2 } },

  { key: 'dark chocolate', aliases: ['dark chocolate', 'chocolate'],
    basis: 'per100g', defaultGrams: 25, defaultState: 'raw',
    raw: { proteinG: 7.8, carbsG: 46, fatG: 43 } },

  { key: 'milk', aliases: ['semi skimmed milk', 'milk'],
    basis: 'per100g', defaultGrams: 250, defaultState: 'raw',
    raw: { proteinG: 3.4, carbsG: 4.8, fatG: 1.5 } },

  { key: 'whey', aliases: ['whey protein', 'whey', 'protein shake', 'protein powder'],
    basis: 'each', unitGrams: 30, unitNoun: 'scoop', defaultState: 'raw',
    raw: { proteinG: 24, carbsG: 2, fatG: 1.5 } },

  { key: 'eggs', aliases: ['boiled egg', 'fried egg', 'eggs', 'egg'],
    basis: 'each', unitGrams: 50, defaultState: 'cooked',
    raw: { proteinG: 6.3, carbsG: 0.4, fatG: 4.8 },
    cooked: { proteinG: 6.3, carbsG: 0.4, fatG: 4.8 } },

  { key: 'avocado', aliases: ['avocado'],
    basis: 'per100g', defaultGrams: 100, defaultState: 'raw',
    raw: { proteinG: 2, carbsG: 8.5, fatG: 15 } },
]

/** Longest alias first, so `black coffee` beats `coffee` and `ground beef` beats `beef`. */
const ALIAS_INDEX: { alias: string; entry: FoodEntry }[] = FOOD_TABLE
  .flatMap((entry) => entry.aliases.map((alias) => ({ alias, entry })))
  .sort((a, b) => b.alias.length - a.alias.length)

export type ParsedItem = {
  name: string
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
  | { ok: false; unmatched: string[] }

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

function readState(chunk: string): 'raw' | 'cooked' | null {
  if (/\bcooked\b|\bgrilled\b|\bfried\b|\bpan.?fried\b|\bbrowned\b|\bboiled\b|\broasted\b/.test(chunk)) return 'cooked'
  if (/\braw\b|\buncooked\b/.test(chunk)) return 'raw'
  return null
}

const QUANTITY = /\b\d+(?:\.\d+)?\s*(?:g|gr|gram|grams|kg|ml)?\b/g
const NUMBER_WORDS = /\b(?:a|an|one|two|three|four|five|six)\b/g
const STATE_WORDS = /\b(?:cooked|grilled|fried|pan.?fried|browned|boiled|roasted|raw|uncooked)\b/g
const MEAL_WORDS = /\b(?:breakfast|lunch|snack|dinner|supper|brekkie)\b/g
const FILLER = /\b(?:the|of|some|with|plus|and|my|for)\b/g

type Match = { entry: FoodEntry; start: number; end: number }

/**
 * Every food in the chunk, longest alias first and non-overlapping, so
 * `black coffee` beats `coffee` and two foods in one breath both survive.
 */
function findMatches(chunk: string): Match[] {
  const taken: [number, number][] = []
  const found: Match[] = []
  for (const { alias, entry } of ALIAS_INDEX) {
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
    .replace(QUANTITY, ' ')
    .replace(NUMBER_WORDS, ' ')
    .replace(STATE_WORDS, ' ')
    .replace(MEAL_WORDS, ' ')
    .replace(FILLER, ' ')
    .replace(/[^a-z]+/g, ' ')
    .trim()
}

/**
 * A count immediately before a food belongs to that food, not to the previous
 * one: in `rice 200g 2 eggs` the `2` is the eggs'.
 */
function segmentStart(chunk: string, at: number): number {
  const before = chunk.slice(0, at)
  const lead = before.match(/(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six)\s*$/)
  return lead ? at - lead[0].length : at
}

function buildItem(entry: FoodEntry, segment: string, mealTag: MealTag | null): ParsedItem {
  const chunk = segment
  const state = readState(chunk) ?? entry.defaultState
  const macros = (state === 'cooked' ? entry.cooked : entry.raw) ?? entry.raw ?? entry.cooked!
  const grams = readGrams(chunk)
  const count = readCount(chunk)

  let factor: number
  let finalGrams: number | null

  if (entry.basis === 'each') {
    const unit = entry.unitGrams ?? 100
    if (grams != null) {
      factor = grams / unit
      finalGrams = grams
    } else {
      factor = count ?? 1
      finalGrams = unit * factor
    }
  } else {
    finalGrams = grams ?? (count != null ? count * 100 : entry.defaultGrams ?? 100)
    factor = finalGrams / 100
  }

  const proteinG = round1(macros.proteinG * factor)
  const carbsG = round1(macros.carbsG * factor)
  const fatG = round1(macros.fatG * factor)
  // Table constants may carry a trace kcal that no macro accounts for; everything else derives.
  const kcal = macros.kcal != null ? Math.round(macros.kcal * factor) : deriveKcal(proteinG, carbsG, fatG)

  const isCooked = entry.raw && entry.cooked && entry.basis === 'per100g' ? state === 'cooked' : null

  return { name: entry.key, grams: finalGrams, cooked: isCooked, mealTag, proteinG, carbsG, fatG, kcal }
}

/**
 * Every chunk must hit the table. One miss and the whole message is handed off
 * (to vision, or to a confirm card) rather than half-logged.
 */
export function parseMessage(message: string, now: Date = new Date()): ParseResult {
  const chunks = splitChunks(message)
  if (chunks.length === 0) return { ok: false, unmatched: [] }

  const messageMeal = findMealWord(message.toLowerCase())
  const mealTag = messageMeal ?? mealTagFromClock(Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: process.env.TZ || 'Europe/Amsterdam' }).format(now),
  ))

  const items: ParsedItem[] = []
  const unmatched: string[] = []

  for (const chunk of chunks) {
    const matches = findMatches(chunk)
    const leftover = residual(chunk, matches)

    // A chunk that is only a meal word ("lunch:") is context, not food.
    if (matches.length === 0 && leftover.length === 0) continue

    // Refuse the chunk if anything in it went unrecognized, rather than
    // logging the part we understood and dropping the rest.
    if (matches.length === 0 || leftover.length > 1) { unmatched.push(chunk); continue }

    const bounds = matches.map((m, i) => (i === 0 ? 0 : segmentStart(chunk, m.start)))
    matches.forEach((m, i) => {
      items.push(buildItem(m.entry, chunk.slice(bounds[i]!, bounds[i + 1] ?? chunk.length), mealTag))
    })
  }

  if (unmatched.length > 0 || items.length === 0) return { ok: false, unmatched }
  return { ok: true, items }
}
