import { describe, expect, it } from 'vitest'
import { mealTagFromClock, parseMessage } from './parse.ts'

const at = (hhmm: string) => new Date(`2026-08-30T${hhmm}:00Z`)

function items(msg: string, now = at('12:00')) {
  const r = parseMessage(msg, now)
  if (!r.ok) throw new Error(`did not parse: ${JSON.stringify(r.unmatched)}`)
  return r.items
}

describe('black coffee', () => {
  it('logs 2 kcal without an API call', () => {
    const [c] = items('black coffee')
    expect(c!.name).toBe('black coffee')
    expect(c!.kcal).toBe(2)
  })
})

describe('minced meat 170g cooked', () => {
  it('lands inside the PRD §13.2 band of 361-489 kcal and 37-50 g protein', () => {
    const [m] = items('minced meat 170g cooked')
    expect(m!.grams).toBe(170)
    expect(m!.cooked).toBe(true)
    expect(m!.kcal).toBeGreaterThanOrEqual(361)
    expect(m!.kcal).toBeLessThanOrEqual(489)
    expect(m!.proteinG).toBeGreaterThanOrEqual(37)
    expect(m!.proteinG).toBeLessThanOrEqual(50)
  })

  it('reads raw as a different row, not a scaled one', () => {
    const cooked = items('minced meat 170g cooked')[0]!
    const raw = items('minced meat 170g raw')[0]!
    expect(raw.cooked).toBe(false)
    expect(raw.proteinG).toBeLessThan(cooked.proteinG)
  })
})

describe('counts', () => {
  it('parses "2 eggs" as two units', () => {
    const [e] = items('2 eggs')
    expect(e!.grams).toBe(100)
    expect(e!.proteinG).toBeCloseTo(12.6, 1)
  })

  it('does not read a weight as a count', () => {
    const [r] = items('rice 200g')
    expect(r!.grams).toBe(200)
  })
})

describe('multiple items', () => {
  it('splits a comma list and an "and"', () => {
    const parsed = items('black coffee, 2 eggs and rice 150g')
    expect(parsed.map((i) => i.name)).toEqual(['black coffee', 'eggs', 'rice'])
  })

  it('refuses the whole message when any chunk misses the table', () => {
    const r = parseMessage('black coffee, pad thai')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.unmatched).toContain('pad thai')
  })
})

describe('never drops food silently', () => {
  it('logs both foods when a chunk has no punctuation', () => {
    const parsed = items('2 eggs rice 200g')
    expect(parsed.map((i) => i.name)).toEqual(['eggs', 'rice'])
    expect(parsed[0]!.grams).toBe(100)
    expect(parsed[1]!.grams).toBe(200)
  })

  it('attaches a leading count to the food that follows it, not the one before', () => {
    const parsed = items('rice 200g 2 eggs')
    expect(parsed.map((i) => [i.name, i.grams])).toEqual([['rice', 200], ['eggs', 100]])
  })

  it('refuses the chunk when one of the foods is unknown', () => {
    const r = parseMessage('chicken quinoa 100g')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.unmatched).toContain('chicken quinoa 100g')
  })

  it('handles three foods run together', () => {
    const parsed = items('chicken 200g cooked rice 250g olive oil 14g')
    expect(parsed.map((i) => i.name)).toEqual(['chicken', 'rice', 'olive oil'])
  })

  it('reads a common misspelling of minced meat', () => {
    expect(items('minced meet 180g cooked')[0]!.name).toBe('minced meat')
  })
})

describe('everyday phrasing', () => {
  it('ignores adjectives that do not change the macros', () => {
    expect(items('large banana')[0]!.grams).toBe(118)
    expect(items('free range eggs')[0]!.name).toBe('eggs')
    expect(items('scrambled eggs')[0]!.name).toBe('eggs')
  })

  it('still refuses an adjective that DOES change the macros', () => {
    expect(parseMessage('fat free yogurt 150g').ok).toBe(false)
  })

  it('reads named portions, per food where they differ', () => {
    expect(items('1 tbsp olive oil')[0]!.grams).toBe(14)
    expect(items('a bowl of rice')[0]!.grams).toBe(200)
    expect(items('a glass of milk')[0]!.grams).toBe(250)
    expect(items('2 slices dark chocolate')[0]!.grams).toBe(20)
    expect(items('2 scoops whey')[0]!.proteinG).toBeCloseTo(48, 0)
  })

  it('reads fractions of a serving', () => {
    expect(items('half an avocado')[0]!.grams).toBe(100)
    expect(items('half a banana')[0]!.grams).toBe(59)
  })

  it('keeps a portion phrase attached to the food it precedes', () => {
    const parsed = items('rice 200g half an avocado')
    expect(parsed.map((i) => [i.name, i.grams])).toEqual([['rice', 200], ['avocado', 100]])
  })

  it('lets an explicit weight beat a portion word', () => {
    expect(items('a bowl of rice 150g')[0]!.grams).toBe(150)
  })
})

describe('pancake', () => {
  it('logs one pancake with derived kcal', () => {
    const [p] = items('one pancake')
    expect(p!.name).toBe('pancake')
    expect(p!.grams).toBe(40)
    expect(p!.kcal).toBe(87)
  })

  it('scales by count and accepts the plural', () => {
    const [p] = items('3 pancakes')
    expect(p!.grams).toBe(120)
    expect(p!.kcal).toBe(261)
  })

  it('still refuses palacsinta, which is not in the table', () => {
    expect(parseMessage('1 palacsinta', at('12:00')).ok).toBe(false)
  })
})

describe('provenance', () => {
  it('marks table rows as reference, since none has been weighed yet', () => {
    expect(items('black coffee')[0]!.provenance).toBe('reference')
    expect(items('2 eggs')[0]!.provenance).toBe('reference')
  })
})

describe('creatine', () => {
  it('logs the daily dose at zero kcal', () => {
    const [c] = items('5 gram creatine')
    expect(c!.name).toBe('creatine')
    expect(c!.grams).toBe(5)
    expect(c!.kcal).toBe(0)
    expect(c!.proteinG).toBe(0)
  })

  it('defaults to a 5 g serving, and a scoop is 5 g not the generic 30 g', () => {
    expect(items('creatine')[0]!.grams).toBe(5)
    expect(items('a scoop of creatine')[0]!.grams).toBe(5)
  })

  it('does not steal the weight from a food beside it', () => {
    const parsed = items('creatine and rice 200g')
    expect(parsed.map((i) => [i.name, i.grams])).toEqual([['creatine', 5], ['rice', 200]])
  })

  it('still refuses kreatin, which is not in the table', () => {
    expect(parseMessage('5 gram kreatin', at('12:00')).ok).toBe(false)
  })
})

describe('meal tags', () => {
  it('does not crash at midnight', () => {
    expect(mealTagFromClock(0)).toBe('breakfast')
    expect(mealTagFromClock(23)).toBe('dinner')
  })

  it('takes an explicit meal word over the clock', () => {
    const [c] = items('dinner: steak 200g')
    expect(c!.mealTag).toBe('dinner')
  })
})
