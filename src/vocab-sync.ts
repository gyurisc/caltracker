/**
 * Push the seed rows in src/foods.ts into the live vocab table.
 *
 * Seeding is flag-gated, so editing foods.ts does nothing to a database that has
 * already been seeded. Run this after adding or changing a row there. It upserts
 * by key: rows added at runtime are left alone, and nothing is deleted.
 *   npx tsx src/vocab-sync.ts
 */
import { allVocab, upsertVocab } from './db.ts'
import { SEED_FOODS } from './foods.ts'
import { invalidateVocab } from './vocab.ts'

const before = new Set(allVocab().map((e) => e.key))
for (const entry of SEED_FOODS) upsertVocab(entry)
invalidateVocab()

const added = SEED_FOODS.filter((e) => !before.has(e.key)).map((e) => e.key)
console.log(`synced ${SEED_FOODS.length} seed rows · ${allVocab().length} in vocab`)
if (added.length) console.log(`new: ${added.join(', ')}`)
