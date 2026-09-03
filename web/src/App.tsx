import { useCallback, useEffect, useState } from 'react'
import { getState, type Activity, type State, type TrendDay } from './api.ts'
import { CalorieChart, MacroChart, ProteinChart } from './charts.tsx'

const n = (v: number) => Math.round(v).toLocaleString('en-US')
const dayName = (d: string) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][new Date(`${d}T12:00:00Z`).getUTCDay()]
const LABEL: Record<Activity, string> = { rest: 'Rest', lifting: 'Lift', cycling: 'Cycle' }

export default function App() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await getState())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  if (!state) {
    return <div className="wrap"><p className="dim">{error ?? 'loading…'}</p></div>
  }

  const { today, settings, totals } = state

  return (
    <div className="wrap">
      <header className="head">
        <h1>caltrack</h1>
        <span className="dim">
          goal {n(today.targetKcal)} kcal · {settings.proteinGoal} g protein
        </span>
      </header>

      <CalorieChart days={state.trend} />
      <ProteinChart days={state.trend} goal={settings.proteinGoal} />
      <MacroChart days={state.trend} />
      <Today state={state} />
      <WeightTrend trend={state.trend} goal={settings.proteinGoal} />
      <Targets state={state} />

      {error && <p className="err">{error}</p>}
      <p className="caption">
        eaten {n(totals.kcal)} · {totals.items} items · ~ never weighed · not medical advice
      </p>
    </div>
  )
}

function Today({ state }: { state: State }) {
  const { today, settings, totals, items } = state

  const over = totals.kcal > today.targetKcal
  const kcalPct = Math.min(100, (totals.kcal / today.targetKcal) * 100)
  const proteinPct = Math.min(100, (totals.proteinG / settings.proteinGoal) * 100)
  const hitProtein = totals.proteinG >= settings.proteinGoal

  return (
    <section className="panel">
      <div className="head" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Today · {today.date}</h2>
        <div className="row">
          <span className="chip on">{LABEL[today.activity]}</span>
          <span className="faint">
            {today.weightKg != null ? `${today.weightKg} kg` : 'no weigh-in'}
          </span>
        </div>
      </div>

      <div className="stat">
        <span className={over ? 'red' : 'dim'}>
          {n(totals.kcal)} / {n(today.targetKcal)} kcal
        </span>
        <span className="faint">
          {over ? `${n(totals.kcal - today.targetKcal)} over` : `${n(today.targetKcal - totals.kcal)} left`}
        </span>
      </div>
      <div className="bar">
        <span style={{ width: `${kcalPct}%`, background: totals.kcal === 0 ? '#1d2733' : over ? 'var(--red)' : 'var(--green)' }} />
      </div>

      <div className="stat">
        <span className={hitProtein ? 'green' : 'dim'}>
          {Math.round(totals.proteinG)} / {settings.proteinGoal} g protein
        </span>
      </div>
      <div className="bar">
        <span style={{ width: `${proteinPct}%`, background: hitProtein ? 'var(--green)' : 'var(--blue)' }} />
      </div>

      {items.length === 0 ? (
        <p className="dim" style={{ marginTop: 16 }}>Nothing logged yet. Log food in Telegram.</p>
      ) : (
        <table style={{ marginTop: 14 }}>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.meal_tag && <span className="tag">{i.meal_tag} </span>}
                  {i.name}
                  {i.grams != null && (
                    <span className="faint">
                      {' '}{i.grams} g{i.cooked == null ? '' : i.cooked ? ' cooked' : ' raw'}
                    </span>
                  )}
                </td>
                <td className="num faint">{i.time}</td>
                <td className="num">{Math.round(i.protein_g)} g</td>
                <td className="num">
                  {i.provenance !== 'measured' && <span className="faint" title="estimate, never weighed">~</span>}
                  {n(i.kcal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function WeightTrend({ trend, goal }: { trend: TrendDay[]; goal: number }) {
  const points = trend.filter((d) => d.weightKg != null) as (TrendDay & { weightKg: number })[]
  const logged = trend.filter((d) => d.kcal > 0)
  const deficitDays = logged.filter((d) => d.kcal <= d.targetKcal).length
  const proteinDays = trend.filter((d) => d.proteinG >= goal).length

  const latest = points.at(-1)
  const first = points[0]
  const delta = latest && first ? latest.weightKg - first.weightKg : null

  const w = 280
  const h = 44
  let path = ''
  if (points.length > 1) {
    const values = points.map((p) => p.weightKg)
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const span = hi - lo || 1
    path = points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * w
        const y = h - ((p.weightKg - lo) / span) * (h - 4) - 2
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  return (
    <section className="panel">
      <h2>Weight · 14 days</h2>
      <div className="head" style={{ marginBottom: 6 }}>
        <span>
          {latest ? `${latest.weightKg} kg` : <span className="dim">no weigh-ins yet</span>}
          {delta != null && (
            <span className={delta <= 0 ? 'green' : 'red'}> {delta > 0 ? '+' : ''}{delta.toFixed(1)}</span>
          )}
        </span>
        <span className="faint" style={{ fontSize: 11 }}>
          {deficitDays}/{logged.length} days in deficit · {proteinDays}/14 days at protein
        </span>
      </div>
      {path && (
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
          <path d={path} fill="none" stroke="var(--blue)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </section>
  )
}

function Targets({ state }: { state: State }) {
  const { settings } = state
  return (
    <section className="panel">
      <h2>Targets</h2>
      <div className="grid2">
        <div><label>protein goal</label>{settings.proteinGoal} g</div>
        <div><label>deficit</label>{n(settings.deficit)} kcal</div>
        <div><label>maintenance · rest</label>{n(settings.maintenance.rest)}</div>
        <div><label>maintenance · lift</label>{n(settings.maintenance.lifting)}</div>
        <div><label>maintenance · cycle</label>{n(settings.maintenance.cycling)}</div>
      </div>
    </section>
  )
}
