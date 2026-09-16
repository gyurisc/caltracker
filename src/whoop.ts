/**
 * WHOOP (PRD §18, v2 backlog — the 14-day gate is passed at 17 days).
 *
 * Everything here is context, never an input to the calorie target. §17 settles
 * it: workout kcal is display-only. The target stays on maintenance-by-activity,
 * and the measured burn stays what `/trend` derives from intake against the
 * weight trend.
 *
 * That is not caution, it is the difference between a measurement and a model.
 * `/trend` back-calculates burn from what actually happened to the body; WHOOP's
 * figure is a heart-rate estimate, the same class of thing as Mifflin-St Jeor.
 * Letting it drive the target would mean a high reading quietly eats the
 * deficit, with nothing to say so until the scale disagrees weeks later — the
 * silent failure this whole app is built to refuse.
 *
 * What it does earn: it knows whether a day held a workout, which is the one
 * thing the target does depend on and the one thing being typed by hand.
 */
import {
  WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT, localDate,
} from './config.ts'
import { getFlag, setFlag } from './db.ts'

const AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth'
const TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token'
/**
 * v2, not v1: `/activity/workout` is a 404 on v1 and works here, and knowing a
 * day held a workout is the one thing the calorie target actually depends on.
 * cycle and recovery are identical on both.
 */
const API = 'https://api.prod.whoop.com/developer/v2'

/**
 * `offline` is what buys a refresh token, and it is not offered as a checkbox on
 * the app registration — it has to be asked for here. Without it the grant dies
 * in an hour and the sync needs a browser every time.
 */
const SCOPES = [
  'offline',
  'read:cycles',
  'read:recovery',
  'read:sleep',
  'read:workout',
  'read:profile',
].join(' ')

/** Every outbound call gets a deadline: polling is sequential, and a hung fetch stops it. */
const TIMEOUT_MS = 20_000

export type Tokens = { access: string; refresh: string; expiresAt: number }

export function configured(): boolean {
  return Boolean(WHOOP_CLIENT_ID && WHOOP_CLIENT_SECRET)
}

export function storedTokens(): Tokens | null {
  const raw = getFlag('whoop_tokens') as Tokens | undefined
  return raw?.refresh ? raw : null
}

export function connected(): boolean {
  return storedTokens() !== null
}

/** Cleared on an explicit disconnect, and whenever WHOOP rejects the refresh. */
export function forgetTokens(): void {
  setFlag('whoop_tokens', null)
}

/**
 * The URL to open in a browser once. `state` is generated here and checked on
 * the way back, so a callback that did not originate from this process is
 * rejected rather than exchanged.
 */
export function authorizeUrl(): string {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
  setFlag('whoop_state', state)
  const q = new URLSearchParams({
    client_id: WHOOP_CLIENT_ID,
    redirect_uri: WHOOP_REDIRECT,
    response_type: 'code',
    scope: SCOPES,
    state,
  })
  return `${AUTH}?${q}`
}

async function postForm(body: URLSearchParams): Promise<Tokens> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`WHOOP token ${res.status}: ${text.slice(0, 200)}`)

  const json = JSON.parse(text) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) throw new Error('WHOOP returned no access token')
  if (!json.refresh_token) {
    // Without this the grant lasts an hour and the sync needs a browser every
    // time. Better to fail loudly here than to look connected and quietly stop.
    throw new Error('WHOOP returned no refresh token — the `offline` scope was not granted')
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    // A minute of slack, so a token is never used in the second it expires.
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  }
}

export async function exchangeCode(code: string, state: string): Promise<Tokens> {
  const expected = getFlag('whoop_state') as string | undefined
  if (!expected || state !== expected) throw new Error('that callback did not come from here')
  setFlag('whoop_state', null)

  const tokens = await postForm(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: WHOOP_CLIENT_ID,
    client_secret: WHOOP_CLIENT_SECRET,
    redirect_uri: WHOOP_REDIRECT,
  }))
  setFlag('whoop_tokens', tokens)
  return tokens
}

/**
 * A live access token, refreshing when it is due.
 *
 * WHOOP rotates the refresh token on every use, so the new pair must be stored
 * before it is used — dropping it would leave the grant unrecoverable without a
 * browser.
 */
export async function accessToken(): Promise<string> {
  const tokens = storedTokens()
  if (!tokens) throw new Error('WHOOP is not connected — /whoop connect')
  if (Date.now() < tokens.expiresAt) return tokens.access

  try {
    const next = await postForm(new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh,
      client_id: WHOOP_CLIENT_ID,
      client_secret: WHOOP_CLIENT_SECRET,
      scope: 'offline',
    }))
    setFlag('whoop_tokens', next)
    return next.access
  } catch (e) {
    // A refresh WHOOP refuses will refuse again. Clearing it means the next
    // command says "reconnect" instead of failing the same way forever.
    forgetTokens()
    throw new Error(`WHOOP refresh failed, reconnect with /whoop connect (${(e as Error).message})`)
  }
}

async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const token = await accessToken()
  const q = new URLSearchParams(params)
  const res = await fetch(`${API}${path}${q.size ? `?${q}` : ''}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`WHOOP ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/**
 * The local date a WHOOP record belongs to.
 *
 * A WHOOP cycle runs wake to wake, not midnight to midnight — the current one
 * started at 22:00Z and is still open. Asking "which cycles overlap this day"
 * therefore returns the same open cycle for every day it spans, and writing that
 * to each of them silently copies today's strain onto yesterday. A cycle belongs
 * to one day: the local date it started.
 *
 * `timezone_offset` is the member's offset at the time, which is what makes the
 * 22:00Z start land on the 15th rather than the 14th.
 */
function localDateOf(instant: string, offset: string | null): string {
  const ms = Date.parse(instant)
  if (Number.isNaN(ms)) return ''
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? '')
  const shift = m
    ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000
    : 0
  return new Date(ms + shift).toISOString().slice(0, 10)
}

/** WHOOP caps `limit` at 25 and rejects the whole request above it. */
const MAX_LIMIT = '25'

/** A window wide enough to hold the days being asked for, plus the open cycle. */
function lookback(days: number): { start: string; limit: string } {
  const from = new Date(Date.now() - (days + 2) * 86_400_000)
  return { start: from.toISOString(), limit: MAX_LIMIT }
}

export type WhoopRaw = {
  date: string
  sleepH: number | null
  recovery: number | null
  strain: number | null
  rhr: number | null
  hrv: number | null
  whoopKcal: number | null
  workouts: { sport: string | null; strain: number | null; kcal: number | null }[]
  /**
   * Whatever the four calls refused. A partial read is normal — a day in
   * progress has no recovery yet — but a *failed* read looks exactly the same
   * from the outside, and reporting it as "no data" would be a lie the caller
   * cannot detect. `limit=50` was rejected for two days behind a shrug.
   */
  errors: string[]
}

const KJ_PER_KCAL = 4.184
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * One local day, as WHOOP sees it. Each of the four calls is independent, so a
 * missing recovery does not cost the day its sleep — a partial answer is the
 * normal case while a day is still in progress.
 */
/**
 * One local day, as WHOOP sees it.
 *
 * Each call is independent, so a missing recovery does not cost the day its
 * sleep — a partial answer is the normal case while a day is still running, and
 * until the first night is recorded there is no sleep or recovery at all.
 */
export async function readDay(date = localDate()): Promise<WhoopRaw> {
  const window = lookback(3)
  const out: WhoopRaw = {
    date, sleepH: null, recovery: null, strain: null,
    rhr: null, hrv: null, whoopKcal: null, workouts: [], errors: [],
  }

  const settled = await Promise.allSettled([
    get('/cycle', window),
    get('/recovery', window),
    get('/activity/sleep', window),
    get('/activity/workout', window),
  ])
  const records = settled.map((r, i) => {
    if (r.status === 'fulfilled') {
      return (r.value as { records?: Record<string, unknown>[] }).records ?? []
    }
    out.errors.push(`${['cycle', 'recovery', 'sleep', 'workout'][i]}: ${r.reason?.message ?? r.reason}`)
    return []
  })
  const [cycles, recoveries, sleeps, workouts] = records as Record<string, unknown>[][]

  const on = (r: Record<string, unknown>, field = 'start') =>
    localDateOf(String(r[field] ?? ''), (r.timezone_offset as string) ?? null) === date

  const cycle = cycles?.find((c) => on(c))
  const cycleScore = cycle?.score as Record<string, unknown> | undefined
  if (cycleScore) {
    out.strain = num(cycleScore.strain)
    const kj = num(cycleScore.kilojoule)
    out.whoopKcal = kj == null ? null : Math.round(kj / KJ_PER_KCAL)
  }

  // Recovery hangs off a cycle, so it is matched by that cycle's id rather than
  // by its own timestamp — the score arrives hours after the night it describes.
  const rec = (cycle
    ? recoveries?.find((r) => String(r.cycle_id) === String(cycle.id))
    : undefined)?.score as Record<string, unknown> | undefined
  if (rec) {
    out.recovery = num(rec.recovery_score)
    out.rhr = num(rec.resting_heart_rate)
    out.hrv = num(rec.hrv_rmssd_milli)
  }

  // A night that starts before midnight belongs to the morning it ends on, and
  // naps are separate records that are not the night's sleep.
  const night = sleeps?.find((sl) => sl.nap !== true && on(sl, 'end'))
  const stage = (night?.score as Record<string, unknown> | undefined)
    ?.stage_summary as Record<string, unknown> | undefined
  if (stage) {
    const light = num(stage.total_light_sleep_time_milli) ?? 0
    const deep = num(stage.total_slow_wave_sleep_time_milli) ?? 0
    const rem = num(stage.total_rem_sleep_time_milli) ?? 0
    const asleep = light + deep + rem
    if (asleep > 0) out.sleepH = Math.round((asleep / 3.6e6) * 10) / 10
  }

  for (const w of workouts ?? []) {
    if (!on(w)) continue
    const score = w.score as Record<string, unknown> | undefined
    const kj = num(score?.kilojoule)
    out.workouts.push({
      sport: typeof w.sport_name === 'string' ? w.sport_name : null,
      strain: num(score?.strain),
      kcal: kj == null ? null : Math.round(kj / KJ_PER_KCAL),
    })
  }

  return out
}
