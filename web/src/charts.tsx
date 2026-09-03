import { useState } from 'react'
import type { TrendDay } from './api.ts'

/**
 * Thirty days of daily bars: calories against target, protein against goal, and
 * macros as stacked energy. One shared geometry, three encodings.
 */

const n = (v: number) => Math.round(v).toLocaleString('en-US')
const dayNum = (d: string) => Number(d.slice(8))
const monthOf = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
const monthDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Validated on the dark surface: lightness band, chroma, CVD and contrast all pass. */
const MACRO = { protein: '#5b8def', carbs: '#189584', fat: '#c4842a' } as const

const W = 720
const H = 96
const PAD_R = 4

type Geom = { x: (i: number) => number; slot: number; bar: number }

function geometry(count: number): Geom {
  const slot = (W - PAD_R) / Math.max(count, 1)
  // 2 px of surface between neighbouring bars, and never thicker than 14 px.
  const bar = Math.max(3, Math.min(14, slot - 2))
  return { x: (i) => i * slot + (slot - bar) / 2, slot, bar }
}

/** Rolling mean over the last `window` logged days — blanks are gaps, not zeros. */
function rollingMean(values: (number | null)[], window = 7): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null)
    if (slice.length < 2) return null
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** A polyline through the defined points only, so a gap breaks the line. */
function segments(points: (number | null)[], toX: (i: number) => number, toY: (v: number) => number) {
  const out: string[] = []
  let run: string[] = []
  points.forEach((v, i) => {
    if (v == null) {
      if (run.length > 1) out.push(run.join(' '))
      run = []
      return
    }
    run.push(`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
  })
  if (run.length > 1) out.push(run.join(' '))
  return out
}

function Axis({ days }: { days: TrendDay[] }) {
  const g = geometry(days.length)
  const every = Math.ceil(days.length / 6)
  return (
    <div className="axis">
      {days.map((d, i) =>
        i % every === 0 ? (
          <span key={d.date} style={{ left: `${((g.x(i) + g.bar / 2) / W) * 100}%` }}>
            {dayNum(d.date)} {monthOf(d.date)}
          </span>
        ) : null,
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ calories */

export function CalorieChart({ days }: { days: TrendDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const g = geometry(days.length)

  const logged = days.filter((d) => d.kcal > 0)
  const mid = median(logged.map((d) => d.kcal))
  const avg = rollingMean(days.map((d) => (d.kcal > 0 ? d.kcal : null)))
  const max = Math.max(1, ...days.map((d) => Math.max(d.kcal, d.maintenance)))
  const y = (v: number) => H - (v / max) * H

  // Distance from target, not over/under: 400 kcal short is as wrong as 400 over.
  const tone = (d: TrendDay) => {
    const off = Math.abs(d.kcal - d.targetKcal)
    return off <= 150 ? 'ok' : off <= 400 ? 'near' : 'far'
  }

  const active = hover != null ? days[hover] : null

  return (
    <section className="panel">
      <div className="chead">
        <h2>Calories</h2>
        <span className="readout">
          {active ? (
            <>
              {monthDay(active.date)} · {active.kcal ? `${n(active.kcal)} / ${n(active.targetKcal)}` : 'nothing logged'}
              {active.kcal ? (
                <b className={tone(active)}>
                  {' '}{active.kcal > active.targetKcal ? '+' : ''}{n(active.kcal - active.targetKcal)}
                </b>
              ) : null}
            </>
          ) : (
            <>median {mid ? n(mid) : '—'} kcal · {logged.length} of {days.length} days logged</>
          )}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="plot" preserveAspectRatio="none" role="img"
           aria-label="Daily calories against target">
        {days.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={i * g.slot} y={0} width={g.slot} height={H} fill="transparent" />
            {d.kcal === 0 ? (
              <rect className="ghost" x={g.x(i)} y={y(d.targetKcal)} width={g.bar} height={H - y(d.targetKcal)} />
            ) : (
              <rect
                className={`mark ${tone(d)} ${hover === i ? 'lit' : ''}`}
                x={g.x(i)} y={y(d.kcal)} width={g.bar} height={Math.max(2, H - y(d.kcal))} rx={Math.min(4, g.bar / 2)}
              />
            )}
            <line className="tick" x1={g.x(i) - 1} x2={g.x(i) + g.bar + 1} y1={y(d.targetKcal)} y2={y(d.targetKcal)} />
          </g>
        ))}

        <polyline className="maintenance"
          points={days.map((d, i) => `${(g.x(i) + g.bar / 2).toFixed(1)},${y(d.maintenance).toFixed(1)}`).join(' ')} />

        {segments(avg, (i) => g.x(i) + g.bar / 2, y).map((p, i) => (
          <polyline key={i} className="avg" points={p} />
        ))}
      </svg>

      <Axis days={days} />
      <p className="caption">
        <i className="sw ok" /> within 150 of target
        <i className="sw near" /> within 400
        <i className="sw far" /> further, over or under
        <i className="sw dash" /> maintenance
        <i className="sw line" /> 7-day average
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------- protein */

export function ProteinChart({ days, goal }: { days: TrendDay[]; goal: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const g = geometry(days.length)

  const logged = days.filter((d) => d.kcal > 0)
  const mid = median(logged.map((d) => d.proteinG))
  const avg = rollingMean(days.map((d) => (d.kcal > 0 ? d.proteinG : null)))
  const max = Math.max(goal * 1.15, ...days.map((d) => d.proteinG))
  const y = (v: number) => H - (v / max) * H

  const active = hover != null ? days[hover] : null

  return (
    <section className="panel">
      <div className="chead">
        <h2>Protein</h2>
        <span className="readout">
          {active ? (
            <>
              {monthDay(active.date)} · {active.kcal
                ? <>{Math.round(active.proteinG)} / {goal} g<b className={active.proteinG >= goal ? 'ok' : 'far'}>
                    {' '}{active.proteinG >= goal ? 'hit' : `${Math.round(goal - active.proteinG)} short`}</b></>
                : 'nothing logged'}
            </>
          ) : (
            <>median {mid ? `${Math.round(mid)} g` : '—'} · goal {goal} g</>
          )}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="plot" preserveAspectRatio="none" role="img"
           aria-label="Daily protein against goal">
        {days.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={i * g.slot} y={0} width={g.slot} height={H} fill="transparent" />
            {d.kcal === 0 ? (
              <rect className="ghost" x={g.x(i)} y={y(goal)} width={g.bar} height={H - y(goal)} />
            ) : (
              <rect
                className={`mark ${d.proteinG >= goal ? 'ok' : 'far'} ${hover === i ? 'lit' : ''}`}
                x={g.x(i)} y={y(d.proteinG)} width={g.bar} height={Math.max(2, H - y(d.proteinG))}
                rx={Math.min(4, g.bar / 2)}
              />
            )}
          </g>
        ))}

        <line className="goal" x1={0} x2={W} y1={y(goal)} y2={y(goal)} />
        {segments(avg, (i) => g.x(i) + g.bar / 2, y).map((p, i) => (
          <polyline key={i} className="avg" points={p} />
        ))}
      </svg>

      <Axis days={days} />
      <p className="caption">
        <i className="sw ok" /> goal met
        <i className="sw far" /> short
        <i className="sw goalline" /> goal
        <i className="sw line" /> 7-day average
      </p>
    </section>
  )
}

/* -------------------------------------------------------------------- macros */

export function MacroChart({ days }: { days: TrendDay[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const g = geometry(days.length)

  const energy = (d: TrendDay) => ({
    protein: d.proteinG * 4,
    carbs: d.carbsG * 4,
    fat: d.fatG * 9,
  })
  const max = Math.max(1, ...days.map((d) => { const e = energy(d); return e.protein + e.carbs + e.fat }))
  const h = (v: number) => (v / max) * H

  const active = hover != null ? days[hover] : null
  const share = active && active.kcal > 0 ? energy(active) : null
  const total = share ? share.protein + share.carbs + share.fat : 0

  return (
    <section className="panel">
      <div className="chead">
        <h2>Macros</h2>
        <span className="readout">
          {share ? (
            <>
              {monthDay(active!.date)} ·{' '}
              {(['protein', 'carbs', 'fat'] as const).map((k) => (
                <span key={k}> {k} {Math.round((share[k] / total) * 100)}%</span>
              ))}
            </>
          ) : (
            <>stacked as kcal · 4 / 4 / 9</>
          )}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="plot" preserveAspectRatio="none" role="img"
           aria-label="Daily macros as energy">
        {days.map((d, i) => {
          const e = energy(d)
          const parts = [
            { k: 'fat' as const, v: e.fat },
            { k: 'carbs' as const, v: e.carbs },
            { k: 'protein' as const, v: e.protein },
          ]
          let cursor = H
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * g.slot} y={0} width={g.slot} height={H} fill="transparent" />
              {parts.map(({ k, v }) => {
                const height = h(v)
                if (height < 0.5) return null
                // 2 px of surface between segments, so the stack reads as parts.
                const drawn = Math.max(1.5, height - 2)
                const y = cursor - drawn
                cursor -= height
                return (
                  <rect key={k} x={g.x(i)} y={y} width={g.bar} height={drawn}
                        fill={MACRO[k]} opacity={hover == null || hover === i ? 1 : 0.45}
                        rx={Math.min(2, g.bar / 3)} />
                )
              })}
            </g>
          )
        })}
      </svg>

      <Axis days={days} />
      <p className="caption">
        <i className="sw" style={{ background: MACRO.protein }} /> protein
        <i className="sw" style={{ background: MACRO.carbs }} /> carbs
        <i className="sw" style={{ background: MACRO.fat }} /> fat
        <span className="faint"> — as kcal</span>
      </p>
    </section>
  )
}
