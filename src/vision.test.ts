import { describe, expect, it } from 'vitest'
import { interpret } from './vision.ts'

describe('reading a label', () => {
  it('keeps the printed macros and recomputes the energy', () => {
    const r = interpret({
      kind: 'label', name: 'Maasdam', basis: 'per100g',
      proteinG: 26, carbsG: 0.1, fatG: 27, kcal: 347,
    })
    expect(r.ok).toBe(true)
    if (!r.ok || r.read.kind !== 'label') return
    expect(r.read.name).toBe('maasdam')
    expect(r.read.kcal).toBe(347)
    expect(r.read.kcalDisputed).toBe(false)
  })

  it('flags a printed energy that the macros do not support', () => {
    // A misread digit: 26 g of protein and 27 g of fat cannot be 900 kcal.
    const r = interpret({
      kind: 'label', name: 'cheese', basis: 'per100g',
      proteinG: 26, carbsG: 0.1, fatG: 27, kcal: 900,
    })
    if (!r.ok || r.read.kind !== 'label') throw new Error('expected a label')
    expect(r.read.kcal).toBe(347)
    expect(r.read.kcalDisputed).toBe(true)
  })

  it('carries fibre through when the label lists it', () => {
    const r = interpret({
      kind: 'label', name: 'finn crisp', basis: 'per100g',
      proteinG: 10, carbsG: 61, fatG: 2.6, fibreG: 20, kcal: 350,
    })
    if (!r.ok || r.read.kind !== 'label') throw new Error('expected a label')
    expect(r.read.fibreG).toBe(20)
  })
})

describe('reading a plate', () => {
  it('splits the rows and derives each energy from its macros', () => {
    const r = interpret({
      kind: 'meal',
      items: [
        { name: 'Chicken breast', grams: 150, cooked: true, proteinG: 46, carbsG: 0, fatG: 5, kcal: 229 },
        { name: 'rice', grams: 200, cooked: true, proteinG: 5, carbsG: 56, fatG: 0.6, kcal: 250 },
      ],
      note: 'the oil is a guess',
    })
    if (!r.ok || r.read.kind !== 'meal') throw new Error('expected a meal')
    expect(r.read.items).toHaveLength(2)
    expect(r.read.items[0]!.name).toBe('chicken breast')
    expect(r.read.items[0]!.kcal).toBe(229)
    expect(r.read.note).toBe('the oil is a guess')
  })

  it('never takes a kcal it was handed', () => {
    const r = interpret({
      kind: 'meal',
      items: [{ name: 'salad', grams: 100, proteinG: 1, carbsG: 3, fatG: 0.2, kcal: 400 }],
    })
    if (!r.ok || r.read.kind !== 'meal') throw new Error('expected a meal')
    expect(r.read.items[0]!.kcal).toBe(18)
    expect(r.read.items[0]!.kcalDisputed).toBe(true)
  })

  it('drops rows with no name rather than logging "unnamed"', () => {
    const r = interpret({
      kind: 'meal',
      items: [
        { name: '', grams: 10, proteinG: 1, carbsG: 1, fatG: 1 },
        { name: 'bread', grams: 40, proteinG: 3, carbsG: 20, fatG: 1 },
      ],
    })
    if (!r.ok || r.read.kind !== 'meal') throw new Error('expected a meal')
    expect(r.read.items).toHaveLength(1)
  })
})

describe('refusals', () => {
  it('says so when the photo is not food', () => {
    const r = interpret({ kind: 'none' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('does not look like food')
  })

  it('says so when the shape is wrong', () => {
    expect(interpret({ kind: 'meal' }).ok).toBe(false)
    expect(interpret({}).ok).toBe(false)
    expect(interpret(null).ok).toBe(false)
  })

  it('refuses a plate with nothing recognisable on it', () => {
    expect(interpret({ kind: 'meal', items: [] }).ok).toBe(false)
  })
})
