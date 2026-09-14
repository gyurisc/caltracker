import { describe, expect, it } from 'vitest'
import { editDistance, matchTier, nearMatches, tolerance } from './similar.ts'

describe('editDistance', () => {
  it('counts a transposition as one, not two', () => {
    expect(editDistance('pespi', 'pepsi')).toBe(1)
    expect(editDistance('taht', 'that')).toBe(1)
  })

  it('handles the ordinary edits', () => {
    expect(editDistance('rice', 'rice')).toBe(0)
    expect(editDistance('rice', 'ice')).toBe(1)
    expect(editDistance('rice', 'rick')).toBe(1)
    expect(editDistance('', 'rice')).toBe(4)
  })
})

describe('nearMatches', () => {
  const vocab = ['pepsi zero sugar', 'black coffee', 'rice', 'skyr', 'chicken breast', 'eggs']

  it('finds the real food behind the typo from the screenshot', () => {
    expect(nearMatches('pespi zero sugar', vocab)[0]).toBe('pepsi zero sugar')
  })

  it('ignores case and punctuation', () => {
    expect(nearMatches('Pespi Zero-Sugar', vocab)[0]).toBe('pepsi zero sugar')
  })

  it('never returns an exact match — the caller already failed to match it', () => {
    expect(nearMatches('rice', vocab)).not.toContain('rice')
  })

  it('stays quiet when nothing is close', () => {
    expect(nearMatches('pad thai', vocab)).toEqual([])
    expect(nearMatches('halloumi', vocab)).toEqual([])
  })

  it('is stricter about short words, where everything looks similar', () => {
    expect(tolerance('rice')).toBe(1)
    expect(tolerance('pepsi zero sugar')).toBe(3)
    // `pho` is a real food two edits from `rice`, and must not be corrected to it.
    expect(nearMatches('pho', vocab)).toEqual([])
  })
})

describe('ranking a food search', () => {
  it('puts a word-boundary hit above one inside a word', () => {
    expect(matchTier(['coca cola zero'], 'cola')).toBe(1)
    expect(matchTier(['dark chocolate', 'chocolate'], 'cola')).toBe(2)
  })

  it('calls an exact name the best match there is', () => {
    expect(matchTier(['rice'], 'rice')).toBe(0)
    expect(matchTier(['dark chocolate', 'etcsoki'], 'etcsoki')).toBe(0)
  })

  it('matches the start of a later word', () => {
    expect(matchTier(['ikea milk chocolate'], 'milk')).toBe(1)
    expect(matchTier(['dark chocolate'], 'choc')).toBe(1)
  })

  it('handles a multi-word needle', () => {
    expect(matchTier(['coca cola zero'], 'coca cola')).toBe(1)
  })

  it('does not treat an accent as a word break', () => {
    expect(matchTier(['étcsoki'], 'csoki')).toBe(2)
    expect(matchTier(['et csoki'], 'csoki')).toBe(1)
  })

  it('says so when nothing matches', () => {
    expect(matchTier(['rice', 'chicken'], 'zzz')).toBe(-1)
    expect(matchTier(['rice'], '')).toBe(-1)
  })
})
