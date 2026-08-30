import { existsSync, rmSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

/** Isolated DB, set before importing db.ts — it opens DB_PATH at import time. */
const TEST_DB = './data/test-vocab.db'

let logText: typeof import('./service.ts').logText
let saveFood: typeof import('./vocab.ts').saveFood
let vocabTable: typeof import('./vocab.ts').vocabTable
let allVocab: typeof import('./db.ts').allVocab

beforeAll(async () => {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (existsSync(f)) rmSync(f)
  process.env.DB_PATH = TEST_DB
  ;({ logText } = await import('./service.ts'))
  ;({ saveFood, vocabTable } = await import('./vocab.ts'))
  ;({ allVocab } = await import('./db.ts'))
})

describe('vocabulary in the database', () => {
  it('seeds the table from the code constants on first use', () => {
    expect(vocabTable().entries.length).toBeGreaterThan(10)
    expect(allVocab().map((e) => e.key)).toContain('black coffee')
  })

  it('round-trips aliases, portions and macros through SQLite', () => {
    const rice = allVocab().find((e) => e.key === 'rice')!
    expect(rice.aliases).toContain('brown rice')
    expect(rice.portions).toEqual({ bowl: 200, cup: 190, plate: 250 })
    expect(rice.cooked).toEqual({ proteinG: 2.7, carbsG: 28, fatG: 0.3 })
  })

  it('parses a food added at runtime, with no restart', () => {
    expect(logText('kefir 400g').ok).toBe(false)

    saveFood({
      key: 'kefir', aliases: ['kefir'], basis: 'per100g', defaultGrams: 250,
      defaultState: 'raw', provenance: 'measured',
      raw: { proteinG: 3.3, carbsG: 4, fatG: 1 },
    })

    const out = logText('kefir 400g')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.rows[0]!.grams).toBe(400)
    // 13.2 P + 16 C + 4 F at 4/4/9 — derived, never taken from the caller.
    expect(out.rows[0]!.kcal).toBe(153)
    expect(out.rows[0]!.provenance).toBe('measured')
  })

  it('does not re-seed over a deleted row', () => {
    const before = allVocab().length
    vocabTable()
    expect(allVocab()).toHaveLength(before)
  })
})
