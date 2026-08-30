/**
 * The live food vocabulary: SQLite rows, cached in process.
 *
 * Cached because every message parses against it, invalidated on every write so
 * a food added through the bot is usable on the next message — no restart. That
 * is the whole point of the table living in the database rather than in code.
 */
import { allVocab, seedVocab, upsertVocab } from './db.ts'
import { type FoodEntry } from './foods.ts'
import { buildTable, type FoodTable } from './parse.ts'

let cache: FoodTable | null = null

export function vocabTable(): FoodTable {
  if (cache) return cache
  seedVocab()
  cache = buildTable(allVocab())
  return cache
}

export function invalidateVocab(): void {
  cache = null
}

/** Add or replace a food. The next parse sees it. */
export function saveFood(entry: FoodEntry): FoodTable {
  upsertVocab(entry)
  invalidateVocab()
  return vocabTable()
}
