/**
 * The live food vocabulary: SQLite rows, cached in process.
 *
 * Cached because every message parses against it, invalidated on every write so
 * a food added through the bot is usable on the next message — no restart. That
 * is the whole point of the table living in the database rather than in code.
 */
import { allVocab, seedVocab, upsertVocab, vocabVersion } from './db.ts'
import { type FoodEntry } from './foods.ts'
import { buildTable, type FoodTable } from './parse.ts'

let cache: FoodTable | null = null
let cachedVersion: string | null = null

export function vocabTable(): FoodTable {
  // One indexed settings read per message, which is cheaper than rebuilding the
  // alias index — and it means another process's write is seen immediately.
  const version = vocabVersion()
  if (cache && cachedVersion === version) return cache
  seedVocab()
  cache = buildTable(allVocab())
  cachedVersion = vocabVersion()
  return cache
}

export function invalidateVocab(): void {
  cache = null
  cachedVersion = null
}

/** Add or replace a food. The next parse sees it. */
export function saveFood(entry: FoodEntry): FoodTable {
  upsertVocab(entry)
  invalidateVocab()
  return vocabTable()
}
