import 'dotenv/config'

export const TZ = process.env.TZ || 'Europe/Amsterdam'
export const PORT = Number(process.env.PORT || 3000)
export const DB_PATH = process.env.DB_PATH || './data/caltrack.db'
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim() || ''
export const TELEGRAM_USER_ID = Number(process.env.TELEGRAM_USER_ID || 0)
export const XAI_API_KEY = process.env.XAI_API_KEY?.trim() || ''

// All "today" logic goes through here. A local date string, never a UTC date.
const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
})
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })

/** YYYY-MM-DD in the configured zone. */
export function localDate(d: Date = new Date()): string {
  return dateFmt.format(d)
}

/** HH:mm in the configured zone. */
export function localTime(d: Date = new Date()): string {
  return timeFmt.format(d)
}

/** 0-23 in the configured zone. */
export function localHour(d: Date = new Date()): number {
  return Number(hourFmt.format(d))
}

/** Sortable local timestamp for the events log. */
export function localStamp(d: Date = new Date()): string {
  return `${localDate(d)}T${localTime(d)}`
}

/**
 * Date-string arithmetic anchored at UTC noon, so a DST shift in
 * Europe/Amsterdam can never move the result onto the wrong day.
 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d!, 12) + n * 86_400_000)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`
}

/** 0 = Sunday .. 6 = Saturday, for a YYYY-MM-DD string. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay()
}

/** The last `n` dates ending at `end`, oldest first. */
export function lastDays(n: number, end: string = localDate()): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)))
}
