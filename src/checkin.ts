/**
 * The three scheduled coach messages, sent from inside the server.
 *
 * They used to be a launchd job running `claude -p`, which meant a second
 * process, a second model, and a Claude login that expired on its own: one
 * morning the check-in arrived as "Failed to authenticate: OAuth session
 * expired" under the coach heading. Here they go through `askCoach()` — the
 * same model, prompt and code path as `/coach` — and a failure says so.
 *
 *   npx tsx src/checkin.ts [morning|midday|evening]   print one, send nothing
 */
import { appendFileSync } from 'node:fs'
import { fromRoot, localDate, localHour, localTime } from './config.ts'
import { askCoach, COACH_MARK } from './coach.ts'
import { getFlag, setFlag } from './db.ts'

export type CheckIn = { slot: 'morning' | 'midday' | 'evening'; hour: number; title: string; next: string }

export const CHECK_INS: CheckIn[] = [
  { slot: 'morning', hour: 7, title: 'Reggeli coach', next: '11:00 today' },
  { slot: 'midday', hour: 11, title: 'Déli coach', next: '16:00 today' },
  { slot: 'evening', hour: 16, title: 'Esti coach', next: '07:00 tomorrow' },
]

/** A missed evening message is not worth sending at bedtime. */
export const LAST_HOUR = 22

const TICK_MS = 60_000
const LOG = fromRoot('data/coach.log')

/**
 * What to send now, given the last one sent (`YYYY-MM-DD slot`).
 *
 * Only the latest slot whose hour has passed is ever due. A process that was
 * down through 11:00 and comes back at 17:00 sends the evening message, not a
 * stale midday one followed by an evening one a minute later.
 */
export function dueCheckIn(date: string, hour: number, last: string | undefined): CheckIn | null {
  if (hour >= LAST_HOUR) return null
  const latest = CHECK_INS.filter((c) => hour >= c.hour).at(-1)
  if (!latest) return null
  return last === `${date} ${latest.slot}` ? null : latest
}

type Ask = typeof askCoach

/** One check-in, ready to send, or why there is nothing to send. */
export async function runCheckIn(
  c: CheckIn,
  ask: Ask = askCoach,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const res = await ask('', [], undefined, undefined, undefined, { checkIn: { slot: c.slot, next: c.next } })
  if (!res.ok) return res
  // Telegram caps a message at 4096 characters.
  return { ok: true, text: `${COACH_MARK} *${c.title}*\n\n${res.text}`.slice(0, 3900) }
}

const say = (line: string) => {
  try {
    appendFileSync(LOG, `${localDate()} ${localTime()} ${line}\n`)
  } catch {
    // The log is for reading later; it must never stop a message.
  }
}

/**
 * Check once a minute. `send` is the bot's, so this needs no token of its own.
 *
 * The slot is marked sent before the model is asked, not after: the call takes
 * several seconds, and the next tick must not start a second one meanwhile. A
 * failure is reported once and not retried every minute.
 */
export function startCheckIns(send: (text: string, markdown: boolean) => Promise<unknown>): NodeJS.Timeout {
  const tick = async () => {
    const date = localDate()
    const due = dueCheckIn(date, localHour(), getFlag('coach_last') as string | undefined)
    if (!due) return
    setFlag('coach_last', `${date} ${due.slot}`)

    const res = await runCheckIn(due)
    if (!res.ok) {
      say(`${due.slot} failed: ${res.error}`)
      await send(`A ${due.title.toLowerCase()} most nem készült el: ${res.error}`, false).catch(() => {})
      return
    }
    try {
      await send(res.text, true)
      say(`sent ${due.slot}, ${res.text.length} chars`)
    } catch (e) {
      say(`${due.slot} not delivered: ${(e as Error).message}`)
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), TICK_MS)
  timer.unref()
  return timer
}

// The dry run: see exactly what a check-in would say, without sending it.
if (process.argv[1]?.endsWith('checkin.ts')) {
  const name = process.argv[2] ?? 'morning'
  const c = CHECK_INS.find((x) => x.slot === name)
  if (!c) {
    console.error(`usage: npx tsx src/checkin.ts [${CHECK_INS.map((x) => x.slot).join('|')}]`)
    process.exit(2)
  }
  const res = await runCheckIn(c)
  console.log(res.ok ? res.text : `failed: ${res.error}`)
  process.exit(res.ok ? 0 : 1)
}
