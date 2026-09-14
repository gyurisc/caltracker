import { describe, expect, it } from 'vitest'
import { askCoach, coachPrompt, forget, historyFor, remember } from './coach.ts'

describe('reading the shared prompt', () => {
  const prompt = coachPrompt()

  it('keeps the instructions', () => {
    expect(prompt).toContain('nutrition and macro coach')
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
