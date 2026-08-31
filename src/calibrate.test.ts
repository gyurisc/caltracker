import { describe, expect, it } from 'vitest'
import { calibrate, slopePerDay, trailingMean, type DayPoint } from './calibrate.ts'

/** A clean run: steady intake, steady loss at `kgPerWeek`. */
function run(days: number, kcal: number, startKg: number, kgPerWeek: number): DayPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    kcal,
    weightKg: Math.round((startKg + (kgPerWeek / 7) * i) * 10) / 10,
  }))
}

describe('trailingMean', () => {
  it('averages the last n values and skips gaps', () => {
    expect(trailingMean([1, 2, 3, 4], 2)).toBe(3.5)
    expect(trailingMean([1, null, 3], 3)).toBe(2)
    expect(trailingMean([null, null], 2)).toBeNull()
  })
})

describe('slopePerDay', () => {
  it('is negative while losing and flat when steady', () => {
    expect(slopePerDay([{ x: 0, y: 100 }, { x: 10, y: 95 }])).toBeCloseTo(-0.5)
    expect(slopePerDay([{ x: 0, y: 90 }, { x: 5, y: 90 }])).toBe(0)
    expect(slopePerDay([{ x: 1, y: 90 }])).toBeNull()
  })

  it('is not thrown off by one heavy morning', () => {
    const clean = run(28, 1800, 96, -0.35).map((d, i) => ({ x: i, y: d.weightKg! }))
    const spiked = clean.map((p, i) => (i === 14 ? { x: p.x, y: p.y + 1.5 } : p))
    expect(slopePerDay(spiked)!).toBeCloseTo(slopePerDay(clean)!, 1)
  })
})

describe('calibrate', () => {
  it('refuses to guess before there is enough data', () => {
    const c = calibrate(run(6, 1800, 96, -0.35))
    expect(c.verdict).toBe('not-enough-data')
    expect(c.effectiveTDEE).toBeNull()
  })

  it('still reports what it does have while short of the threshold', () => {
    const c = calibrate(run(6, 1800, 96, -0.35))
    expect(c.avgKcal).toBe(1800)
    expect(c.trendWeightKg).toBeGreaterThan(95)
    expect(c.loggedDays).toBe(6)
  })

  it('back-calculates TDEE from intake and the weight trend', () => {
    // 1,800 kcal while losing 0.35 kg/week ≈ 385 kcal/day of deficit.
    const c = calibrate(run(28, 1800, 96, -0.35))
    expect(c.effectiveTDEE).toBeGreaterThan(2100)
    expect(c.effectiveTDEE).toBeLessThan(2250)
    expect(c.rateKgPerWeek).toBeCloseTo(-0.35, 1)
  })

  it('calls a 0.35 kg/week loss on track and suggests no change', () => {
    const c = calibrate(run(28, 1800, 96, -0.35))
    expect(c.verdict).toBe('on-track')
    expect(c.adjustKcal).toBe(0)
  })

  it('calls a stall too slow and suggests eating less', () => {
    const c = calibrate(run(28, 2200, 96, 0))
    expect(c.verdict).toBe('too-slow')
    expect(c.adjustKcal).toBeLessThan(0)
  })

  it('calls a crash too fast and suggests eating more', () => {
    const c = calibrate(run(28, 1200, 96, -1.2))
    expect(c.verdict).toBe('too-fast')
    expect(c.adjustKcal).toBeGreaterThan(0)
  })

  it('ignores unlogged days when averaging intake', () => {
    const days = run(28, 1800, 96, -0.35)
    days[3]!.kcal = 0
    days[9]!.kcal = 0
    // A blank day is a day I forgot to log, not a day I ate nothing.
    expect(calibrate(days).avgKcal).toBe(1800)
    expect(calibrate(days).loggedDays).toBe(26)
  })

  it('refuses to estimate when the inputs contradict each other', () => {
    // The real case that produced this guard: a demo fortnight at 75 kg mixed
    // with a real 95 kg weigh-in, which implied a negative burn rate.
    const days = run(28, 1500, 76, 0).map((d, i) => (i > 24 ? { ...d, weightKg: 95.4 } : d))
    const c = calibrate(days)
    expect(c.verdict).toBe('implausible')
    expect(c.effectiveTDEE).toBeNull()
    expect(c.adjustKcal).toBe(0)
  })

  it('needs weigh-ins, not just food, before it will estimate', () => {
    const days = run(28, 1800, 96, -0.35).map((d, i) => ({ ...d, weightKg: i < 3 ? d.weightKg : null }))
    expect(calibrate(days).verdict).toBe('not-enough-data')
  })
})
