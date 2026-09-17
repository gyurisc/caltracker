import { beforeAll, describe, expect, it } from 'vitest'
import { classify, cycleDate, exchangeForTest, GrantRejected, type WhoopRaw } from './whoop.ts'

const cycle = (start: string, offset = '+02:00') => ({ start, timezone_offset: offset })

describe('which day a WHOOP cycle describes', () => {
  it('gives an evening cycle to the next day', () => {
    // A cycle runs sleep-onset to sleep-onset, so one that begins at 21:52 on
    // the 15th covers that night and the whole of the 16th.
    expect(cycleDate(cycle('2026-09-15T19:52:50.370Z'))).toBe('2026-09-16')
  })

  it('gives a cycle that began at local midnight that same day', () => {
    expect(cycleDate(cycle('2026-09-14T22:00:00.000Z'))).toBe('2026-09-15')
  })

  it('keeps two cycles starting on one calendar date apart', () => {
    // Exactly the case that put the 16th's strain on the 15th: both of these
    // start on the 15th in local time, and they are different days.
    const early = cycleDate(cycle('2026-09-14T22:00:00.000Z'))
    const late = cycleDate(cycle('2026-09-15T19:52:50.370Z'))
    expect(early).not.toBe(late)
  })

  it('handles a bedtime after midnight', () => {
    // Asleep at 01:00 on the 16th: the waking hours are still the 16th.
    expect(cycleDate(cycle('2026-09-15T23:00:00.000Z'))).toBe('2026-09-16')
  })

  it('uses the record\'s own offset, not the server\'s', () => {
    expect(cycleDate(cycle('2026-09-15T23:30:00.000Z', '-05:00'))).toBe('2026-09-16')
    expect(cycleDate(cycle('2026-09-15T23:30:00.000Z', '+02:00'))).toBe('2026-09-16')
  })

  it('returns nothing for an unparseable start', () => {
    expect(cycleDate(cycle('not a date'))).toBe('')
  })
})

const raw = (over: Partial<WhoopRaw> = {}): WhoopRaw => ({
  date: '2026-09-16', sleepH: null, recovery: null, strain: 10,
  rhr: null, hrv: null, whoopKcal: null, workouts: [], errors: [], ...over,
})
const w = (sport: string, strain: number) => ({ sport, strain, kcal: null })

describe('classifying a day from its workouts', () => {
  it('calls a lifting session a lift day', () => {
    expect(classify(raw({ workouts: [w('weightlifting', 9)] }))?.activity).toBe('lifting')
  })

  it('puts cardio in the cycling bucket', () => {
    expect(classify(raw({ workouts: [w('mountain-biking', 7.9)] }))?.activity).toBe('cycling')
    expect(classify(raw({ workouts: [w('running', 6.7)] }))?.activity).toBe('cycling')
  })

  it('takes the hardest session when there were several', () => {
    const call = classify(raw({ workouts: [w('running', 6.7), w('weightlifting', 11)] }))
    expect(call?.activity).toBe('lifting')
  })

  it('ignores a walk to the shops', () => {
    // Strain 3 is a stroll, not a session, and must not lift the target.
    expect(classify(raw({ workouts: [w('walking', 3)] }))?.activity).toBe('rest')
  })

  it('calls a day with no training a rest day', () => {
    expect(classify(raw({ workouts: [] }))?.activity).toBe('rest')
  })

  it('says nothing at all when the sport is unknown', () => {
    // Guessing a bucket would move the calorie target by hundreds of kcal on no
    // evidence. Leaving the day untouched is the honest answer.
    expect(classify(raw({ workouts: [w('surfing', 12)] }))).toBeNull()
  })

  it('says nothing when WHOOP has no cycle for the day', () => {
    // An unworn band or a failed sync looks exactly like a rest day once the
    // numbers are blank. Without this the target silently drops.
    expect(classify(raw({ strain: null, workouts: [] }))).toBeNull()
  })
})

describe('a hand-set day is left alone', () => {
  let setActivity: typeof import('./db.ts').setActivity
  let activityIsManual: typeof import('./db.ts').activityIsManual

  beforeAll(async () => {
    process.env.DB_PATH = './data/test-whoop.db'
    ;({ setActivity, activityIsManual } = await import('./db.ts'))
  })

  it('marks a typed activity manual and a synced one not', () => {
    setActivity('2026-09-15', 'lifting', 'manual')
    expect(activityIsManual('2026-09-15')).toBe(true)

    setActivity('2026-09-14', 'cycling', 'whoop')
    expect(activityIsManual('2026-09-14')).toBe(false)
  })

  it('treats a day nobody has touched as not manual', () => {
    // Which is what lets WHOOP classify it in the first place.
    expect(activityIsManual('2026-01-01')).toBe(false)
  })
})

describe('what costs the grant and what does not', () => {
  // The refresh token is the whole integration: without it, reconnecting needs
  // a browser on the machine at home. Only WHOOP saying the grant is dead may
  // clear it — a bad minute on the network must not.
  it('treats 400 and 401 as the grant being refused', () => {
    expect(new GrantRejected('x')).toBeInstanceOf(Error)
  })

  it('keeps the existing refresh token when a refresh returns none', async () => {
    // Requiring a fresh refresh_token on every refresh is what disconnected
    // this an hour after it was linked. Plenty of providers return only an
    // access token and leave the existing refresh token valid.
    const kept = 'the-original-refresh-token'
    const tokens = await exchangeForTest(
      { access_token: 'new-access', expires_in: 3600 },
      kept,
    )
    expect(tokens.refresh).toBe(kept)
    expect(tokens.access).toBe('new-access')
  })

  it('refuses when there is no refresh token to keep either', async () => {
    await expect(exchangeForTest({ access_token: 'a', expires_in: 3600 }, null))
      .rejects.toBeInstanceOf(GrantRejected)
  })
})
