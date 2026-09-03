import { describe, expect, it } from 'vitest'
import { formatFoodCommand, parseFoodCommand } from './foodcmd.ts'

const ok = (s: string) => {
  const r = parseFoodCommand(s)
  if (!r.ok) throw new Error(r.error)
  return r.entry
}
const err = (s: string) => {
  const r = parseFoodCommand(s)
  if (r.ok) throw new Error('expected a refusal')
  return r.error
}

describe('/food', () => {
  it('reads a per-100g row off a label', () => {
    const e = ok('kefir per100 p3.3 c4 f1')
    expect(e.key).toBe('kefir')
    expect(e.basis).toBe('per100g')
    expect(e.raw).toEqual({ proteinG: 3.3, carbsG: 4, fatG: 1 })
    expect(e.provenance).toBe('measured')
  })

  it('reads a countable row with its unit weight', () => {
    const e = ok('bagel each 85g p9 c48 f1.5')
    expect(e.basis).toBe('each')
    expect(e.unitGrams).toBe(85)
  })

  it('accepts the ways you would naturally write per 100 g', () => {
    for (const basis of ['per100', 'per100g', 'per-100g', '100g']) {
      const e = ok(`kefir ${basis} p3.3 c4 f1`)
      expect(e.basis).toBe('per100g')
      expect(e.key).toBe('kefir')
    }
  })

  it('keeps a multi-word name together', () => {
    expect(ok('peanut butter per100 p25 c20 f50').key).toBe('peanut butter')
  })

  it('takes a default serving, state and extra aliases', () => {
    const e = ok('skyr per100 p11.5 c4 f0.2 g170 cooked +icelandic skyr, isey')
    expect(e.defaultGrams).toBe(170)
    expect(e.defaultState).toBe('cooked')
    expect(e.cooked).toEqual(e.raw)
    expect(e.aliases).toEqual(['icelandic skyr', 'isey', 'skyr'])
  })

  it('marks a guess as reference so it renders with ~', () => {
    expect(ok('kefir per100 p3.3 c4 f1 est').provenance).toBe('reference')
  })

  it('never accepts kcal — there is no syntax for it', () => {
    expect(err('kefir per100 p3.3 c4 f1 kcal60')).toContain('did not understand')
  })

  it('refuses macros that cannot fit in 100 g', () => {
    expect(err('mystery per100 p50 c50 f50')).toContain('more than 100 g')
  })

  it('takes a comma as the decimal point, as a Hungarian keyboard types it', () => {
    const e = ok('chocolate cookie each 20g p1,1 c12 f4,4 est')
    expect(e.raw).toEqual({ proteinG: 1.1, carbsG: 12, fatG: 4.4 })
    expect(ok('bagel each 85,5g p9 c48 f1.5').unitGrams).toBe(85.5)
    // Both notations mean the same thing, in the same command.
    expect(ok('kefir per100 p3,3 c4 f1')).toEqual(ok('kefir per100 p3.3 c4 f1'))
  })

  it('says what is missing rather than only reprinting the grammar', () => {
    expect(err('cookie p1.1 c12 f4.4')).toContain('say per100, or each')
    expect(err('per100 p1 c1 f1')).toContain('needs a name')
  })

  it('refuses an incomplete row', () => {
    expect(err('kefir per100 p3.3')).toContain('need all three macros')
    expect(err('bagel each p9 c48 f1.5')).toContain('weight of one')
    expect(err('kefir')).toContain('usage:')
    expect(err('')).toContain('usage:')
  })
})

describe('formatFoodCommand', () => {
  it('round-trips through the parser', () => {
    for (const line of [
      'kefir per100 p3.3 c4 f1',
      'bagel each 85g p9 c48 f1.5',
      'skyr per100 p11.5 c4 f0.2 g170 cooked +icelandic skyr, isey',
      'kefir per100 p3.3 c4 f1 est',
    ]) {
      const first = ok(line)
      const second = ok(formatFoodCommand(first).replace(/^\/food /, ''))
      expect(second).toEqual(first)
    }
  })

  it('produces a command you can paste back', () => {
    expect(formatFoodCommand(ok('kefir per100 p3.3 c4 f1 g250 +kefyr')))
      .toBe('/food kefir per100 p3.3 c4 f1 g250 +kefyr')
  })
})
