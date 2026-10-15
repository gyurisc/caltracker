/**
 * The daily coach, on whichever surface asked for it.
 *
 * The prompt lives in exactly one file — `.claude/commands/cal-coach.md` — and
 * both the slash command and the bot read it from there. A second copy inside
 * the bot would drift within weeks, and there would be no way to tell which one
 * was actually answering. Same reason `todayReport()` is shared rather than
 * written twice.
 *
 * The day's log is never asked for from the model. It is rendered here, by the
 * same code `/today` uses, and handed over as fact. A coach that has to guess
 * what was eaten is a coach making up the numbers it then advises on.
 */
import { readFileSync } from 'node:fs'
import { addDays, fromRoot, localDate } from './config.ts'
import { todayReport } from './report.ts'
import { callXai } from './vision.ts'

export const COACH_MODEL = 'grok-4.5'
export const PROMPT_FILE = fromRoot('.claude/commands/cal-coach.md')

/** How much of the conversation to carry. Enough for a follow-up, not a diary. */
export const HISTORY_TURNS = 6
export const HISTORY_TTL_MS = 3 * 60 * 60 * 1000

export type Turn = { role: 'user' | 'assistant'; content: string }

/**
 * Opens every coach message, scheduled or asked for. A Telegram reply to a
 * message carrying it is a follow-up, not food. The scheduled check-ins
 * (src/checkin.ts) carry it too, and a reply to one is the usual way in.
 */
export const COACH_MARK = '🧭'

export const isCoachMessage = (text: string): boolean => text.trimStart().startsWith(COACH_MARK)

/**
 * The thread, with the message being replied to as the coach's last word.
 *
 * A scheduled message never passed through this process, so the quote is the
 * only record of what was advised. A `/coach` answer already is the last turn,
 * and repeating it would spend the history on a duplicate.
 */
/**
 * Models write `**bold**`; Telegram's Markdown mode bolds with one star and
 * prints the second pair literally.
 */
export const telegramMarkdown = (text: string): string => text.replace(/\*\*/g, '*')

export function withQuoted(history: Turn[], quoted: string): Turn[] {
  const last = history.at(-1)
  if (last?.role === 'assistant' && last.content === quoted) return history
  return [...history, { role: 'assistant', content: quoted }]
}

/**
 * The instructions, minus the slash-command scaffolding.
 *
 * The file is written for Claude Code, so it opens with frontmatter, a `!`
 * shell line that renders the log, and a line splicing in the argument. All
 * three are how that surface delivers the same two things this one delivers
 * directly, so they are stripped rather than duplicated.
 */
export function coachPrompt(file = PROMPT_FILE): string {
  const raw = readFileSync(file, 'utf8')
  const body = raw.startsWith('---') ? raw.slice(raw.indexOf('\n---', 3) + 4) : raw
  return body
    .split('\n')
    .filter((line) => !line.startsWith('!`') && !line.includes('Today\'s log is above.'))
    .join('\n')
    .trim()
}

type ChatFn = typeof callXai

/**
 * One question, answered against today's real log.
 *
 * `history` is the recent exchange so a follow-up lands — "there is no skyr,
 * only cottage cheese" has to change the next answer, and without it every
 * reply starts the day over.
 */
export async function askCoach(
  question: string,
  history: Turn[] = [],
  chat: ChatFn = callXai,
  report = todayReport(),
  yesterday = todayReport(addDays(localDate(), -1)),
  opts: { followUp?: boolean; checkIn?: { slot: string; next: string } } = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  // The prompt changes shape on these two opening lines. A scheduled run has no
  // user message to take the language from — the first test came out English.
  const opening = opts.checkIn
    ? `Check-in: ${opts.checkIn.slot}\nNext check-in: ${opts.checkIn.next}\n\n`
    : ''
  const ask = opts.checkIn
    ? 'Ez egy ütemezett üzenet, nincs felhasználói kérdés. Válaszolj magyarul.'
    : opts.followUp ? `Follow-up: ${question}` : question || 'How should I carry on eating today?'
  try {
    const res = (await chat({
      model: COACH_MODEL,
      max_tokens: 900,
      temperature: 0.3,
      messages: [
        { role: 'system', content: coachPrompt() },
        ...history.slice(-HISTORY_TURNS),
        {
          role: 'user',
          // Same labels, same order as the slash command. `Follow-up:` is what
          // the prompt keys on to answer the message rather than rerun the
          // whole report on top of it.
          content: `${opening}Yesterday:\n\n${yesterday}\n\nToday:\n\n${report}\n\n${ask}`,
        },
      ],
    })) as { choices?: { message?: { content?: string } }[] }

    const text = res?.choices?.[0]?.message?.content?.trim()
    if (!text) return { ok: false, error: 'the coach returned nothing' }
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: `coach failed: ${(e as Error).message}` }
  }
}

/**
 * Per-chat history, in process and short-lived. Not persisted: advice about
 * what to eat next is worthless tomorrow, and a coach quoting a conversation
 * from last week would be worse than one starting fresh.
 */
const threads = new Map<number, { turns: Turn[]; at: number }>()

export function historyFor(chatId: number, now = Date.now()): Turn[] {
  const found = threads.get(chatId)
  if (!found || now - found.at > HISTORY_TTL_MS) {
    threads.delete(chatId)
    return []
  }
  return found.turns
}

export function remember(chatId: number, turns: Turn[], now = Date.now()): void {
  const existing = historyFor(chatId, now)
  threads.set(chatId, { turns: [...existing, ...turns].slice(-HISTORY_TURNS), at: now })
}

export function forget(chatId: number): void {
  threads.delete(chatId)
}
