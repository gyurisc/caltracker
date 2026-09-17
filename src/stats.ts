/**
 * The public page.
 *
 * Server-rendered on purpose: there is no endpoint behind it to discover, no
 * JSON to widen, and nothing a reader can query for a field the page chose not
 * to show. What is in the HTML is the whole of what is published.
 *
 * What it deliberately leaves out is the point of it existing separately from
 * the dashboard: no meals, no times of day, no photographs, no waist, no
 * resting heart rate or HRV, no sleep. Those say where someone lives their day;
 * calories against a target and a weight line say how the project is going.
 */
import { lastDays, localDate, TZ } from './config.ts'
import { getDay, getSettings, getWeights, totalsFor } from './db.ts'
import { targetKcal } from './nutrition.ts'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const n = (v: number) => Math.round(v).toLocaleString('en-US')

type Point = { date: string; kcal: number; target: number; proteinG: number; weight: number | null }

function collect(days: number): Point[] {
  const dates = lastDays(days)
  const totals = totalsFor(dates)
  const weights = getWeights(dates)
  const settings = getSettings()
  return dates.map((d) => {
    const day = getDay(d)
    const t = totals[d]!
    return {
      date: d,
      kcal: t.kcal,
      target: targetKcal(day.activity, settings),
      proteinG: t.proteinG,
      weight: weights[d] ?? null,
    }
  })
}

/** A polyline through the defined points only, so a gap in weigh-ins breaks the line. */
function weightPath(points: Point[], w: number, h: number): string {
  const seen = points.map((p, i) => ({ i, kg: p.weight })).filter((p) => p.kg != null)
  if (seen.length < 2) return ''
  const values = seen.map((p) => p.kg!)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  return seen
    .map((p, k) => {
      const x = (p.i / Math.max(points.length - 1, 1)) * w
      const y = h - ((p.kg! - lo) / span) * (h - 8) - 4
      return `${k === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function bars(points: Point[], w: number, h: number, value: (p: Point) => number, max: number): string {
  const slot = w / Math.max(points.length, 1)
  const bar = Math.max(2, Math.min(12, slot - 2))
  return points
    .map((p, i) => {
      const v = value(p)
      if (v <= 0) return ''
      const height = Math.max(1.5, (v / max) * h)
      const x = i * slot + (slot - bar) / 2
      return `<rect x="${x.toFixed(1)}" y="${(h - height).toFixed(1)}" width="${bar.toFixed(1)}" height="${height.toFixed(1)}" rx="2"/>`
    })
    .join('')
}

export function statsPage(days = 60): string {
  const points = collect(days)
  const logged = points.filter((p) => p.kcal > 0)
  const settings = getSettings()

  const avgKcal = logged.length ? logged.reduce((s, p) => s + p.kcal, 0) / logged.length : 0
  const avgProtein = logged.length ? logged.reduce((s, p) => s + p.proteinG, 0) / logged.length : 0
  const weighed = points.filter((p) => p.weight != null)
  const first = weighed[0]?.weight ?? null
  const latest = weighed.at(-1)?.weight ?? null
  const delta = first != null && latest != null ? latest - first : null

  const W = 720
  const H = 90
  const maxKcal = Math.max(1, ...points.map((p) => Math.max(p.kcal, p.target)))
  const maxProtein = Math.max(settings.proteinGoal, ...points.map((p) => p.proteinG))

  const targetLine = points.length
    ? `<line x1="0" x2="${W}" y1="${(H - (points[0]!.target / maxKcal) * H).toFixed(1)}" y2="${(H - (points.at(-1)!.target / maxKcal) * H).toFixed(1)}" class="goal"/>`
    : ''

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>caltrack — ${days} days</title>
<style>
  :root { color-scheme: dark; --bg:#0a0b0d; --panel:#111316; --line:#1e2227;
          --ink:#e6e8ea; --dim:#8b939c; --faint:#575f68; --accent:#4a8cf7; --green:#35c46b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;
         padding:28px 20px 56px; }
  main { max-width:760px; margin:0 auto; }
  h1 { font-size:19px; margin:0 0 2px; letter-spacing:-0.01em; }
  .sub { color:var(--dim); font-size:12px; margin:0 0 26px; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:8px;
            padding:16px 18px 12px; margin-bottom:14px; }
  h2 { font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
       color:var(--dim); margin:0 0 10px; }
  .row { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:10px; }
  .big { font-size:24px; font-variant-numeric:tabular-nums; letter-spacing:-0.02em; }
  .unit { color:var(--faint); font-size:12px; }
  svg { display:block; width:100%; height:90px; }
  rect { fill:var(--accent); }
  .protein rect { fill:var(--green); }
  .goal { stroke:var(--faint); stroke-width:1; stroke-dasharray:3 3; }
  path { fill:none; stroke:var(--ink); stroke-width:1.75; stroke-linejoin:round; }
  footer { color:var(--faint); font-size:11px; text-align:center; margin-top:22px; }
  .green { color:var(--green); }
</style>
</head><body><main>

<h1>caltrack</h1>
<p class="sub">a personal calorie log · last ${days} days · ${logged.length} logged · ${esc(TZ)}</p>

<section>
  <h2>Calories</h2>
  <div class="row">
    <span class="big">${n(avgKcal)}<span class="unit"> kcal/day average</span></span>
  </div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily calories">
    ${bars(points, W, H, (p) => p.kcal, maxKcal)}${targetLine}
  </svg>
</section>

<section class="protein">
  <h2>Protein</h2>
  <div class="row">
    <span class="big">${n(avgProtein)}<span class="unit"> g/day average · goal ${settings.proteinGoal} g</span></span>
  </div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily protein">
    ${bars(points, W, H, (p) => p.proteinG, maxProtein)}
  </svg>
</section>

<section>
  <h2>Weight</h2>
  <div class="row">
    <span class="big">${latest == null ? '—' : latest.toFixed(1)}<span class="unit"> kg</span></span>
    ${delta == null ? '' : `<span class="${delta <= 0 ? 'green' : ''}">${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg over ${weighed.length} weigh-ins</span>`}
  </div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Weight trend">
    <path d="${weightPath(points, W, H)}"/>
  </svg>
</section>

<footer>${esc(localDate())} · logged by hand, mostly from a phone</footer>
</main></body></html>`
}
