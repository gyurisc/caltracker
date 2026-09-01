/**
 * The live food vocabulary: SQLite rows, cached in process.
 *
 * Cached because every message parses against it, invalidated on every write so
 * a food added through the bot is usable on the next message — no restart. That
 * is the whole point of the table living in the database rather than in code.
 */
import { allVocab, deleteVocab, seedVocab, upsertVocab, vocabVersion } from './db.ts'
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

/** Find a food by its key or any of its aliases. */
export function findFood(name: string): FoodEntry | undefined {
  const needle = name.trim().toLowerCase()
  return vocabTable().entries.find(
    (e) => e.key === needle || e.aliases.some((a) => a.toLowerCase() === needle),
  )
}

/** Remove a food. Returns false when there was nothing to remove. */
export function removeFood(key: string): boolean {
  const gone = deleteVocab(key)
  if (gone) invalidateVocab()
  return gone
}
