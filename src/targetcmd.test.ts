import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './nutrition.ts'
import { parseTargetCommand, patchFor } from './targetcmd.ts'

const ok = (input: string) => {
  const r = parseTargetCommand(input)
  if (!r.ok) throw new Error(`expected "${input}" to parse: ${r.error}`)
  return r
}

describe('/target <field> <value>', () => {
  it('sets the protein goal and the deficit', () => {
    expect(ok('protein 170')).toMatchObject({ kind: 'protein', value: 170 })
    expect(ok('deficit 400')).toMatchObject({ kind: 'deficit', value: 400 })
  })

  it('takes the activity aliases the rest of the app takes', () => {
    // normalizeActivity is the one place aliases are resolved, so `lift` and
    // `cycle` work here for the same reason they work in /activity.
    expect(ok('rest 2400')).toMatchObject({ kind: 'maintenance', activity: 'rest', value: 2400 })
    expect(ok('lift 2600')).toMatchObject({ kind: 'maintenance', activity: 'lifting' })
    expect(ok('cycle 2500')).toMatchObject({ kind: 'maintenance', activity: 'cycling' })
  })

  it('accepts a comma decimal, because Hungarian keyboards type one', () => {
    expect(ok('deficit 450,5').value).toBe(450.5)
  })

  // A typo that silently set `rest` would move the calorie target by hundreds
  // with nothing to say so — the same reason normalizeActivity returns null.
  it('refuses an unknown field rather than guessing', () => {
    expect(parseTargetCommand('resting 2400').ok).toBe(false)
    expect(parseTargetCommand('protien 170').ok).toBe(false)
  })

  it('refuses a value that is not a number', () => {
    expect(parseTargetCommand('protein lots').ok).toBe(false)
    expect(parseTargetCommand('protein').ok).toBe(false)
  })

  it('refuses figures outside any plausible range', () => {
    expect(parseTargetCommand('protein 1800').ok).toBe(false)   // g, not kcal
    expect(parseTargetCommand('rest 240').ok).toBe(false)       // a digit short
    expect(parseTargetCommand('rest 24000').ok).toBe(false)     // a digit long
    expect(parseTargetCommand('deficit -100').ok).toBe(false)
  })

  it('leaves the other maintenance figures alone', () => {
    const patch = patchFor(ok('lift 2600'), DEFAULT_SETTINGS)
    expect(patch.maintenance).toEqual({
      rest: DEFAULT_SETTINGS.maintenance.rest,
      lifting: 2600,
      cycling: DEFAULT_SETTINGS.maintenance.cycling,
    })
  })
})
