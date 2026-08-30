/**
 * The food vocabulary's shape, and the rows the database is seeded with.
 *
 * At runtime the table lives in SQLite (see `vocab` in db.ts) so a new food can
 * be added without a code change or a restart. These constants are the seed and
 * the fallback — edit them only to change what a fresh database starts with.
 */
export type Macros = {
  proteinG: number
  carbsG: number
  fatG: number
  /**
   * Only for table constants whose calories do not come from macros at all
   * (brewed coffee's ~2 kcal is trace compounds). Everything else derives.
   */
  kcal?: number
}

export type FoodEntry = {
  key: string
  aliases: string[]
  basis: 'per100g' | 'each'
  unitGrams?: number
  unitNoun?: string
  defaultGrams?: number
  /** Grams for a named portion of THIS food, overriding GENERIC_PORTIONS. */
  portions?: Record<string, number>
  defaultState: 'raw' | 'cooked'
  /**
   * Where the macros came from. `reference` is a book/model figure nobody weighed —
   * shown with a `~` so an un-verified number never passes as a measured one.
   * `measured` means a scale and a label, entered once. Absent reads as reference.
   */
  provenance?: 'measured' | 'reference'
  raw?: Macros
  cooked?: Macros
}

export type Provenance = 'measured' | 'reference'

export const provenanceOf = (entry: { provenance?: Provenance }): Provenance =>
  entry.provenance ?? 'reference'

/** Per 100 g unless basis is `each`, in which case macros are per unit. */
export const SEED_FOODS: FoodEntry[] = [
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
    portions: { bowl: 200, cup: 190, plate: 250 },
    raw: { proteinG: 7.1, carbsG: 80, fatG: 0.7 },
    cooked: { proteinG: 2.7, carbsG: 28, fatG: 0.3 } },

  { key: 'lettuce', aliases: ['lettuce', 'salad greens', 'rocket'],
    basis: 'per100g', defaultGrams: 50, defaultState: 'raw',
    raw: { proteinG: 1.4, carbsG: 2.9, fatG: 0.2 } },

  { key: 'olive oil', aliases: ['olive oil', 'oil'],
    basis: 'per100g', defaultGrams: 14, defaultState: 'raw',
    portions: { tbsp: 14, tablespoon: 14, tsp: 5, teaspoon: 5, glug: 14, drizzle: 7 },
    raw: { proteinG: 0, carbsG: 0, fatG: 100 } },

  { key: 'yogurt', aliases: ['greek yogurt', 'yoghurt', 'yogurt', 'yopro', 'skyr', 'quark'],
    basis: 'per100g', defaultGrams: 150, defaultState: 'raw',
    portions: { bowl: 200, cup: 200, pot: 150, tub: 500 },
    raw: { proteinG: 11, carbsG: 4, fatG: 0.2 } },

  { key: 'dark chocolate', aliases: ['dark chocolate', 'chocolate'],
    basis: 'per100g', defaultGrams: 25, defaultState: 'raw',
    portions: { square: 10, slice: 10, piece: 10, bar: 100, row: 25 },
    raw: { proteinG: 7.8, carbsG: 46, fatG: 43 } },

  { key: 'milk', aliases: ['semi skimmed milk', 'milk'],
    basis: 'per100g', defaultGrams: 250, defaultState: 'raw',
    portions: { glass: 250, cup: 240, splash: 30, dash: 15 },
    raw: { proteinG: 3.4, carbsG: 4.8, fatG: 1.5 } },

  { key: 'whey', aliases: ['whey protein', 'whey', 'protein shake', 'protein powder'],
    basis: 'each', unitGrams: 30, unitNoun: 'scoop', defaultState: 'raw',
    raw: { proteinG: 24, carbsG: 2, fatG: 1.5 } },

  { key: 'eggs', aliases: ['boiled egg', 'fried egg', 'eggs', 'egg'],
    basis: 'each', unitGrams: 50, defaultState: 'cooked',
    raw: { proteinG: 6.3, carbsG: 0.4, fatG: 4.8 },
    cooked: { proteinG: 6.3, carbsG: 0.4, fatG: 4.8 } },

  // ~4 inch plain pancake, USDA. `each`, because nobody weighs a pancake.
  { key: 'pancake', aliases: ['pancakes', 'pancake'],
    basis: 'each', unitGrams: 40, defaultState: 'cooked',
    cooked: { proteinG: 2.4, carbsG: 11, fatG: 3.7 },
    raw: { proteinG: 2.4, carbsG: 11, fatG: 3.7 } },

  // A supplement, not a food: 0/0/0, so deriveKcal gives 0. Here so the bot
  // stops refusing a daily dose, not to move any total. 5 g is the usual scoop.
  { key: 'creatine', aliases: ['creatine monohydrate', 'creatine'],
    basis: 'per100g', defaultGrams: 5, defaultState: 'raw',
    portions: { scoop: 5, tsp: 5, teaspoon: 5 },
    raw: { proteinG: 0, carbsG: 0, fatG: 0 } },

  { key: 'avocado', aliases: ['avocado'],
    basis: 'per100g', defaultGrams: 200, defaultState: 'raw',
    raw: { proteinG: 2, carbsG: 8.5, fatG: 15 } },
]
