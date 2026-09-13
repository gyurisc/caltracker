import { describe, expect, it } from 'vitest'
import { parseCorrection, targetIndex } from './correction.ts'

describe('parsing a correction', () => {
  it('reads a bare weight', () => {
    expect(parseCorrection('20g')).toEqual({ name: null, grams: 20 })
    expect(parseCorrection('20 g')).toEqual({ name: null, grams: 20 })
    expect(parseCorrection('20 gramm')).toEqual({ name: null, grams: 20 })
    expect(parseCorrection(' 53 grams ')).toEqual({ name: null, grams: 53 })
  })

  it('reads a decimal, with either separator', () => {
    expect(parseCorrection('1.5g')).toEqual({ name: null, grams: 1.5 })
    expect(parseCorrection('1,5 g')).toEqual({ name: null, grams: 1.5 })
  })

  it('reads a named weight', () => {
    expect(parseCorrection('pancake 20g')).toEqual({ name: 'pancake', grams: 20 })
    expect(parseCorrection('chicken breast 180 g')).toEqual({ name: 'chicken breast', grams: 180 })
  })

  it('is not a correction without a weight', () => {
    expect(parseCorrection('pancake')).toBeNull()
    expect(parseCorrection('2 eggs')).toBeNull()
    expect(parseCorrection('')).toBeNull()
    expect(parseCorrection('20')).toBeNull()
  })
})

describe('aiming a correction at a row', () => {
  it('takes the only row when the weight is bare', () => {
    expect(targetIndex({ name: null, grams: 20 }, ['pancake'])).toBe(0)
  })

  it('refuses a bare weight when the card has several rows', () => {
    // Which one? Guessing would silently rewrite the wrong line.
    expect(targetIndex({ name: null, grams: 20 }, ['rice', 'chicken'])).toBe(-1)
  })

  it('matches a row by name', () => {
    expect(targetIndex({ name: 'rice', grams: 180 }, ['chicken', 'rice'])).toBe(1)
  })

  it('reaches a longer row name', () => {
    expect(targetIndex({ name: 'chicken', grams: 180 }, ['chicken breast'])).toBe(0)
  })

  it('finds nothing when the name is not on the card', () => {
    // A real new meal, not a correction — it has to fall through to logging.
    expect(targetIndex({ name: 'pancake', grams: 20 }, ['rice', 'chicken'])).toBe(-1)
  })
})
