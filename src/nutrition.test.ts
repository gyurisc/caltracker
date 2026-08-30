import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, TARGET_FLOOR, deriveKcal, defaultActivityFor,
  kcalDisagrees, normalizeActivity, targetKcal,
} from './nutrition.ts'

describe('targetKcal', () => {
  it('is maintenance minus deficit for all three activities', () => {
    expect(targetKcal('rest', DEFAULT_SETTINGS)).toBe(1600)
    expect(targetKcal('lifting', DEFAULT_SETTINGS)).toBe(1900)
    expect(targetKcal('cycling', DEFAULT_SETTINGS)).toBe(1800)
  })

  it('floors at 800 so a mis-set maintenance cannot starve the log', () => {
    const broken = { ...DEFAULT_SETTINGS, maintenance: { rest: 900, lifting: 900, cycling: 900 } }
    expect(targetKcal('rest', broken)).toBe(TARGET_FLOOR)
  })
})

describe('normalizeActivity', () => {
  it('maps every surface onto the canonical DB value', () => {
    expect(normalizeActivity('lift')).toBe('lifting')
    expect(normalizeActivity('Lifting')).toBe('lifting')
    expect(normalizeActivity('cycle')).toBe('cycling')
    expect(normalizeActivity(' REST ')).toBe('rest')
  })

  it('rejects unknown input instead of defaulting to rest', () => {
    expect(normalizeActivity('swimming')).toBeNull()
    expect(normalizeActivity('')).toBeNull()
  })
})

describe('defaultActivityFor', () => {
  it('lifts Mon and Thu, cycles Fri, rests otherwise', () => {
    expect(defaultActivityFor(1)).toBe('lifting')
    expect(defaultActivityFor(4)).toBe('lifting')
    expect(defaultActivityFor(5)).toBe('cycling')
    expect(defaultActivityFor(0)).toBe('rest')
    expect(defaultActivityFor(6)).toBe('rest')
  })
})

describe('deriveKcal', () => {
  it('applies 4/4/9', () => {
    expect(deriveKcal(25.7, 0, 16)).toBe(247)
    expect(deriveKcal(0, 0, 0)).toBe(0)
  })

  it('flags a supplied kcal that is more than 15% off', () => {
    expect(kcalDisagrees(400, 420)).toBe(false)
    expect(kcalDisagrees(400, 560)).toBe(true)
    expect(kcalDisagrees(400, 250)).toBe(true)
  })
})
