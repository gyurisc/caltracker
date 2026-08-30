import { useCallback, useEffect, useState } from 'react'
import {
  deleteFood, getState, postActivity, postLog, postSeed, postWeight,
  type Activity, type State, type TrendDay, type WeekDay,
} from './api.ts'

const n = (v: number) => Math.round(v).toLocaleString('en-US')
const dayName = (d: string) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][new Date(`${d}T12:00:00Z`).getUTCDay()]
const ACTIVITIES: Activity[] = ['rest', 'lifting', 'cycling']
const LABEL: Record<Activity, string> = { rest: 'Rest', lifting: 'Lift', cycling: 'Cycle' }
const QUICK = ['black coffee', 'banana', 'minced meat 170g cooked', '2 eggs', 'rice 200g']

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

      <Composer onLogged={refresh} />
      <WeekCalories week={state.week} />
      <WeekProtein week={state.week} goal={settings.proteinGoal} />
      <Today state={state} onChange={refresh} />
      <WeightTrend trend={state.trend} goal={settings.proteinGoal} />
      <Targets state={state} onSeed={async () => { await postSeed(); await refresh() }} />

      {error && <p className="err">{error}</p>}
      <p className="caption">
        eaten {n(totals.kcal)} · {totals.items} items · estimates, not medical advice
      </p>
    </div>
  )
}

function Composer({ onLogged }: { onLogged: () => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [miss, setMiss] = useState<string | null>(null)

  async function submit(value: string) {
    const body = value.trim()
    if (!body || busy) return
    setBusy(true)
    setMiss(null)
    try {
      await postLog(body)
      setText('')
      await onLogged()
    } catch (e) {
      const unmatched = (e as { unmatched?: string[] }).unmatched
      setMiss(unmatched?.length ? `not in the local table: ${unmatched.join(', ')}` : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2>Log</h2>
      <textarea
        value={text}
        placeholder="black coffee · minced meat 170g cooked · 2 eggs, rice 200g"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(text)
        }}
      />
      <div className="row" style={{ marginTop: 9 }}>
        <button onClick={() => void submit(text)} disabled={busy || !text.trim()}>
          {busy ? 'saving…' : 'Send'}
        </button>
        <span className="faint" style={{ fontSize: 11 }}>⌘↵</span>
      </div>
      <div className="chips">
        {QUICK.map((q) => (
          <button key={q} className="chip" onClick={() => void submit(q)} disabled={busy}>{q}</button>
        ))}
      </div>
      {miss && <p className="err">{miss}</p>}
    </section>
  )
}

/** Shared scale across all seven columns, so the bars are comparable to each other. */
function scaleOf(values: number[]): number {
  return Math.max(1, ...values)
}

function WeekCalories({ week }: { week: WeekDay[] }) {
  const max = scaleOf(week.flatMap((d) => [d.kcal, d.maintenance]))
  return (
    <section className="panel">
      <h2>Week · calories</h2>
      <div className="cols">
        {week.map((d) => {
          const over = d.kcal > d.targetKcal
          const tone = d.kcal === 0 ? 'empty' : over ? 'over' : 'ok'
          return (
            <div className="col" key={d.date}>
              <div className="track">
                <div className="shade" style={{ height: `${(d.maintenance / max) * 100}%` }} />
                <div className={`fill ${tone}`} style={{ height: `${(d.kcal / max) * 100}%` }} />
                <div className="mark" style={{ bottom: `${(d.targetKcal / max) * 100}%` }} />
              </div>
              <div className="colcap">
                <b>{dayName(d.date)}</b>
                {d.kcal ? n(d.kcal) : '·'}
              </div>
            </div>
          )
        })}
      </div>
      <p className="caption">bar is eaten · shaded is maintenance · line is target</p>
    </section>
  )
}

function WeekProtein({ week, goal }: { week: WeekDay[]; goal: number }) {
  const max = scaleOf([...week.map((d) => d.proteinG), goal * 1.15])
  return (
    <section className="panel">
      <h2>Week · protein</h2>
      <div className="cols">
        {week.map((d) => (
          <div className="col" key={d.date}>
            <div className="track">
              <div
                className={`fill protein ${d.proteinG >= goal ? 'hit' : ''}`}
                style={{ height: `${(d.proteinG / max) * 100}%` }}
              />
              <div className="mark" style={{ bottom: `${(goal / max) * 100}%` }} />
            </div>
            <div className="colcap">
              <b>{dayName(d.date)}</b>
              {d.proteinG ? `${Math.round(d.proteinG)}g` : '·'}
            </div>
          </div>
        ))}
      </div>
      <p className="caption">line is goal</p>
    </section>
  )
}

function Today({ state, onChange }: { state: State; onChange: () => Promise<void> }) {
  const { today, settings, totals, items } = state
  const [weight, setWeight] = useState('')

  useEffect(() => { setWeight(today.weightKg ? String(today.weightKg) : '') }, [today.weightKg])

  const over = totals.kcal > today.targetKcal
  const kcalPct = Math.min(100, (totals.kcal / today.targetKcal) * 100)
  const proteinPct = Math.min(100, (totals.proteinG / settings.proteinGoal) * 100)
  const hitProtein = totals.proteinG >= settings.proteinGoal

  return (
    <section className="panel">
      <div className="head" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Today · {today.date}</h2>
        <div className="row">
          {ACTIVITIES.map((a) => (
            <button
              key={a}
              className={`chip ${today.activity === a ? 'on' : ''}`}
              onClick={async () => { await postActivity(a); await onChange() }}
            >
              {LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          inputMode="decimal"
          placeholder="morning weight, kg"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          onBlur={async () => {
            const kg = Number(weight.replace(',', '.'))
            if (Number.isFinite(kg) && kg > 0 && kg !== today.weightKg) { await postWeight(kg); await onChange() }
          }}
        />
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
        <p className="dim" style={{ marginTop: 16 }}>Nothing logged yet. Type a meal or snap a plate.</p>
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
                <td className="num">{n(i.kcal)}</td>
                <td className="act">
                  <button
                    className="x"
                    title="delete"
                    onClick={async () => { await deleteFood(i.id); await onChange() }}
                  >
                    ×
                  </button>
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

function Targets({ state, onSeed }: { state: State; onSeed: () => Promise<void> }) {
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
      <div style={{ marginTop: 14 }}>
        <button className="chip" onClick={() => void onSeed()}>Reload sample week</button>
      </div>
    </section>
  )
}
