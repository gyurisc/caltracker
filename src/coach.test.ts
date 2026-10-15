import { describe, expect, it } from 'vitest'
import {
  askCoach, COACH_MARK, coachPrompt, forget, historyFor, isCoachMessage, remember, telegramMarkdown,
  withQuoted,
} from './coach.ts'

describe('reading the shared prompt', () => {
  const prompt = coachPrompt()

  it('keeps the instructions', () => {
    expect(prompt).toContain('nutrition and macro coach')
    expect(prompt).toContain('## Follow-ups')
    expect(prompt).toContain('Next check-in:')
    expect(prompt).toContain('Calories are a constraint')
  })

  it('drops the slash-command scaffolding', () => {
    // Frontmatter, the shell line that renders the log, and the `$1` splice are
    // how Claude Code delivers what this surface delivers directly.
    expect(prompt).not.toContain('allowed-tools')
    expect(prompt).not.toContain('npx tsx src/today.ts')
    expect(prompt).not.toContain('$1')
  })
})

describe('asking the coach', () => {
  const reply = (text: string) => async () => ({ choices: [{ message: { content: text } }] })

  it('hands over the real log rather than letting the model guess', async () => {
    let sent: any
    const spy = async (body: unknown) => { sent = body; return { choices: [{ message: { content: 'ok' } }] } }
    await askCoach('what now?', [], spy as never, '1,200 / 1,600 kcal · 90 g P')

    const messages = sent.messages
    expect(messages[0].role).toBe('system')
    expect(messages.at(-1).content).toContain('1,200 / 1,600 kcal')
    expect(messages.at(-1).content).toContain('what now?')
  })

  it('hands over yesterday too, so an evening comparison has something to compare', async () => {
    let sent: any
    const spy = async (body: unknown) => { sent = body; return { choices: [{ message: { content: 'ok' } }] } }
    await askCoach('what now?', [], spy as never, 'TODAY-LOG', 'YESTERDAY-LOG')

    const last: string = sent.messages.at(-1).content
    expect(last).toContain('YESTERDAY-LOG')
    expect(last.indexOf('YESTERDAY-LOG')).toBeLessThan(last.indexOf('TODAY-LOG'))
  })

  it('marks a follow-up, so the coach answers it instead of starting the day over', async () => {
    let sent: any
    const spy = async (body: unknown) => { sent = body; return { choices: [{ message: { content: 'ok' } }] } }
    await askCoach('I screwed up yesterday', [], spy as never, 'log', 'log', { followUp: true })
    expect(sent.messages.at(-1).content).toContain('Follow-up: I screwed up yesterday')
  })

  it('opens a scheduled check-in with the lines the prompt keys on, in Hungarian', async () => {
    let sent: any
    const spy = async (body: unknown) => { sent = body; return { choices: [{ message: { content: 'ok' } }] } }
    await askCoach('', [], spy as never, 'log', 'log', { checkIn: { slot: 'evening', next: '07:00 tomorrow' } })

    const last: string = sent.messages.at(-1).content
    expect(last.startsWith('Check-in: evening\nNext check-in: 07:00 tomorrow\n\nYesterday:')).toBe(true)
    // A scheduled run has no user message to take the language from.
    expect(last).toContain('Válaszolj magyarul')
    expect(last).not.toContain('How should I carry on eating today?')
  })

  it('leaves a fresh question unmarked', async () => {
    let sent: any
    const spy = async (body: unknown) => { sent = body; return { choices: [{ message: { content: 'ok' } }] } }
    await askCoach('what now?', [], spy as never, 'log', 'log')
    expect(sent.messages.at(-1).content).not.toContain('Follow-up:')
  })

  it('carries the recent exchange so a follow-up lands', async () => {
    let sent: any
    const spy = async (body: unknown) => { sent = body; return { choices: [{ message: { content: 'ok' } }] } }
    const history = [
      { role: 'user' as const, content: 'there is no skyr' },
      { role: 'assistant' as const, content: 'then cottage cheese' },
    ]
    await askCoach('and now?', history, spy as never, 'log')
    expect(sent.messages.map((m: any) => m.content)).toContain('there is no skyr')
  })

  it('reports a failure instead of inventing advice', async () => {
    const boom = async () => { throw new Error('502') }
    const r = await askCoach('x', [], boom as never, 'log')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('502')
  })

  it('says so when the model returns nothing', async () => {
    const r = await askCoach('x', [], reply('') as never, 'log')
    expect(r.ok).toBe(false)
  })
})

describe('the coach thread', () => {
  it('keeps only the recent turns', () => {
    forget(1)
    for (let i = 0; i < 10; i++) remember(1, [{ role: 'user', content: `m${i}` }])
    expect(historyFor(1).length).toBeLessThanOrEqual(6)
    expect(historyFor(1).at(-1)?.content).toBe('m9')
  })

  it('forgets a stale thread — advice on yesterday is worse than none', () => {
    forget(2)
    const now = Date.now()
    remember(2, [{ role: 'user', content: 'old' }], now)
    expect(historyFor(2, now + 4 * 60 * 60 * 1000)).toEqual([])
  })

  it('keeps chats apart', () => {
    forget(3); forget(4)
    remember(3, [{ role: 'user', content: 'mine' }])
    expect(historyFor(4)).toEqual([])
  })
})

describe('continuing from a coach message', () => {
  it('knows a coach message by its mark', () => {
    expect(isCoachMessage(`${COACH_MARK} Reggeli coach\n\n0 / 1600 kcal`)).toBe(true)
    expect(isCoachMessage('+ black coffee · 2 kcal')).toBe(false)
  })

  it('puts the quoted message into the thread as the coach\'s own words', () => {
    // A scheduled message is sent by another process, so the bot never
    // remembered it. The quote is the only record of what was advised.
    const h = withQuoted([], `${COACH_MARK} eat 250 g skyr`)
    expect(h).toEqual([{ role: 'assistant', content: `${COACH_MARK} eat 250 g skyr` }])
  })

  it('does not repeat a quote that is already the last thing said', () => {
    const turns = [
      { role: 'user' as const, content: 'what now?' },
      { role: 'assistant' as const, content: 'eat skyr' },
    ]
    expect(withQuoted(turns, 'eat skyr')).toEqual(turns)
  })
})

describe('formatting for Telegram', () => {
  it('turns **bold** into the single-star bold Telegram reads', () => {
    // Legacy Markdown has no `**`; sent as-is, the stars show up in the chat.
    expect(telegramMarkdown('**0 / 1600 kcal**, 0 g P')).toBe('*0 / 1600 kcal*, 0 g P')
  })
})
