import { useCallback, useEffect, useState } from 'react'
import { getState, type Activity, type FoodRow, type State, type TrendDay } from './api.ts'
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
      <Week state={state} />
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
        <ItemList items={items} />
      )}
    </section>
  )
}

/**
 * One day's entries. Today and the week below it share this, so the two cannot
 * drift into rendering the same row two different ways.
 *
 * Photos are Today's alone: a week of thumbnails is a lot of fetching for rows
 * you are scanning rather than re-examining, and the day you want to look at
 * closely is the one already open above.
 */
function ItemList({ items, photos = true }: { items: FoodRow[]; photos?: boolean }) {
  return (
    <table style={{ marginTop: 14 }}>
      <tbody>
        {items.map((i) => (
          <tr key={i.id}>
            <td>
              {photos && i.photo_path && <Shot id={i.photo_path} alt={i.name} />}
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
  )
}

/**
 * The day's photos, under the rows they produced.
 *
 * The numbers above are mostly estimates; the pictures are what they were
 * estimated from. Gathered at the foot of the day they also read as the day
 * itself — six plates in a row says more at a glance than six rows of grams.
 * A day that was never photographed gets no strip rather than an empty shelf.
 */
function PhotoStrip({ items }: { items: FoodRow[] }) {
  const shots = items.filter((i) => i.photo_path)
  if (shots.length === 0) return null
  return (
    <div className="strip">
      {shots.map((i) => (
        <Shot key={i.id} id={i.photo_path!} alt={i.name} className="tile" />
      ))}
    </div>
  )
}

/**
 * The days before today, each with the entries that made up its total.
 *
 * Today keeps its own card above, with the bars and the weigh-in, so it is left
 * out here rather than drawn twice. A day with nothing logged still gets a
 * heading: an absent card reads as a bug, a quiet one reads as a quiet day.
 */
function Week({ state }: { state: State }) {
  // lastDays() hands back oldest first, which is right for a chart axis and
  // wrong for a log — most recent is what you came to read.
  const earlier = state.week.filter((d) => d.date !== state.today.date).slice().reverse()
  if (earlier.length === 0) return null

  return (
    <section className="panel">
      <h2>Last 7 days</h2>
      {earlier.map((d) => {
        const over = d.kcal > d.targetKcal
        return (
          <div className="day" key={d.date}>
            <div className="head" style={{ marginBottom: 2 }}>
              <h3 style={{ margin: 0 }}>{dayName(d.date)} · {d.date}</h3>
              <div className="row">
                <span className="chip">{LABEL[d.activity]}</span>
                <span className={over ? 'red' : 'dim'}>
                  {n(d.kcal)} / {n(d.targetKcal)} kcal
                </span>
                <span className="faint">{Math.round(d.proteinG)} g P</span>
              </div>
            </div>
            {d.rows.length === 0
              ? <p className="dim" style={{ margin: '8px 0 0' }}>Nothing logged.</p>
              : <><ItemList items={d.rows} photos={false} /><PhotoStrip items={d.rows} /></>}
          </div>
        )
      })}
    </section>
  )
}

/**
 * The photo a row was read from, beside the row it produced.
 *
 * Most numbers in this log are estimates, and an estimate you cannot re-examine
 * has to be taken on faith. Weeks later the picture is the only way to tell
 * whether "sauce 80 g" was a spoonful or a ladle, so it sits next to the line
 * rather than somewhere else. Small by default; the full frame opens on click.
 */
function Shot({ id, alt, className = 'shot' }: { id: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <img
        className={className}
        src={`/api/photo/${id}?size=thumb`}
        alt={alt}
        loading="lazy"
        onClick={() => setOpen(true)}
      />
      {open && (
        <div className="lightbox" onClick={() => setOpen(false)} role="presentation">
          <img src={`/api/photo/${id}`} alt={alt} />
        </div>
      )}
    </>
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

  // Waist is weekly, so it has far fewer points than the weight line and does
  // not get a line of its own — two or three dots would draw a shape that is
  // not there. The latest reading and its movement are the whole story.
  const waistPoints = trend.filter((d) => d.waistCm != null) as (TrendDay & { waistCm: number })[]
  const waist = waistPoints.at(-1)
  // WHOOP strain, averaged over the days that have it. Shown beside weight as
  // one more piece of context — it is not a target and does not move one.
  const strains = trend.filter((d) => d.strain != null).map((d) => d.strain!)
  const strainAvg = strains.length ? strains.reduce((a, b) => a + b, 0) / strains.length : null

  const waistDelta =
    waist && waistPoints[0] && waistPoints.length > 1 ? waist.waistCm - waistPoints[0].waistCm : null

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
          {strainAvg != null && <>strain {strainAvg.toFixed(1)} avg · </>}
          {waist && <><b className="waist">{waist.waistCm} cm waist</b>{waistDelta != null && (
            <span className={waistDelta <= 0 ? 'green' : 'red'}> {waistDelta > 0 ? '+' : ''}{waistDelta.toFixed(1)}</span>
          )} · </>}
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
