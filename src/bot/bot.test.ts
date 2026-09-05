import { existsSync, rmSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Drives the real bot handler with synthetic updates — no network, no Telegram.
 * Proves the stop condition: `black coffee` from the owner writes 2 kcal to SQLite.
 */
const TEST_DB = './data/test-bot.db'
const OWNER = 5_000_001
const STRANGER = 9_999_999

let bot: Awaited<ReturnType<typeof boot>>['bot']
let db: Awaited<ReturnType<typeof boot>>['db']
let sent: string[]

async function boot() {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (existsSync(f)) rmSync(f)
  process.env.DB_PATH = TEST_DB
  process.env.TELEGRAM_BOT_TOKEN = '1:TEST'
  process.env.TELEGRAM_USER_ID = String(OWNER)

  const { createBot } = await import('./index.ts')
  const { db } = await import('../db.ts')
  const bot = createBot()

  // Skip getMe(), and swallow every outbound API call.
  // Shape is grammY's UserFromGetMe; only the identity fields matter here.
  bot.botInfo = {
    id: 1, is_bot: true, first_name: 'caltrack', username: 'caltrackbot',
  } as typeof bot.botInfo
  sent = []
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') sent.push(String((payload as { text: string }).text))
    return { ok: true, result: {} } as never
  })
  return { bot, db }
}

function update(fromId: number, text: string, id = Math.floor(Math.random() * 1e6)) {
  // grammY only routes a command when Telegram marks it with a bot_command entity.
  const entities = text.startsWith('/')
    ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }]
    : undefined
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: 'private' as const },
      from: { id: fromId, is_bot: false, first_name: 'k' },
      text,
      ...(entities ? { entities } : {}),
    },
  }
}

beforeAll(async () => {
  const booted = await boot()
  bot = booted.bot
  db = booted.db
})

const foods = () =>
  db.prepare('SELECT * FROM foods ORDER BY rowid').all() as
    { id: string; name: string; kcal: number; time: string }[]

describe('telegram logging', () => {
  it('writes 2 kcal to SQLite for "black coffee"', async () => {
    await bot.handleUpdate(update(OWNER, 'black coffee') as never)

    const rows = foods()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('black coffee')
    expect(rows[0]!.kcal).toBe(2)
    expect(sent.at(-1)).toContain('+ black coffee · 2 kcal')
  })

  it('ignores a stranger entirely — no row, no reply', async () => {
    const before = foods().length
    const replies = sent.length
    await bot.handleUpdate(update(STRANGER, 'black coffee') as never)
    expect(foods()).toHaveLength(before)
    expect(sent).toHaveLength(replies)
  })

  it('/undo removes the row it just wrote', async () => {
    await bot.handleUpdate(update(OWNER, '/undo') as never)
    expect(foods()).toHaveLength(0)
    expect(sent.at(-1)).toContain('− black coffee')
  })

  it('/activity lift changes the target, /activity swim does not', async () => {
    await bot.handleUpdate(update(OWNER, '/activity lift') as never)
    expect(sent.at(-1)).toContain('Lift')
    expect(sent.at(-1)).toContain('1,900')

    await bot.handleUpdate(update(OWNER, '/activity swim') as never)
    expect(sent.at(-1)).toContain('usage:')
  })

  it('/steps records yesterday by default', async () => {
    await bot.handleUpdate(update(OWNER, '/steps 12,450') as never)
    expect(sent.at(-1)).toContain('12,450 steps')
    expect(sent.at(-1)).toContain('(yesterday)')

    const row = db.prepare('SELECT date, steps FROM days WHERE steps IS NOT NULL').get() as
      { date: string; steps: number }
    expect(row.steps).toBe(12_450)
  })

  it('/steps takes today when asked, and refuses nonsense', async () => {
    await bot.handleUpdate(update(OWNER, '/steps 8k today') as never)
    expect(sent.at(-1)).toContain('8,000 steps')
    expect(sent.at(-1)).not.toContain('yesterday')

    await bot.handleUpdate(update(OWNER, '/steps lots') as never)
    expect(sent.at(-1)).toContain('usage:')
  })

  it('/weight 74.2 stores the weigh-in', async () => {
    await bot.handleUpdate(update(OWNER, '/weight 74.2') as never)
    const day = db.prepare('SELECT weight_kg FROM days ORDER BY date DESC LIMIT 1').get() as { weight_kg: number }
    expect(day.weight_kg).toBe(74.2)
  })

  it('refuses food that is not in the local table', async () => {
    await bot.handleUpdate(update(OWNER, 'pad thai') as never)
    expect(sent.at(-1)).toContain('not in the local table')
    expect(foods()).toHaveLength(0)
  })

  it('asks for dry or cooked instead of guessing at rice', async () => {
    await bot.handleUpdate(update(OWNER, 'rice 200g') as never)
    expect(sent.at(-1)).toContain('say dry or cooked')
    expect(sent.at(-1)).not.toContain('not in the local table')
    expect(foods().some((f) => f.name === 'rice')).toBe(false)

    await bot.handleUpdate(update(OWNER, 'rice 200g cooked') as never)
    expect(sent.at(-1)).toContain('+ rice')
    expect(foods().at(-1)!.kcal).toBe(251)
  })


  it('suggests the real food behind a typo instead of a template', async () => {
    await bot.handleUpdate(update(OWNER, '/food pepsi zero sugar per100 p0 c0 f0') as never)
    await bot.handleUpdate(update(OWNER, 'Pespi Zero Sugar 250ml') as never)

    expect(sent.at(-1)).toContain('did you mean: pepsi zero sugar?')
    expect(sent.at(-1)).not.toContain('/food pespi')
    expect(foods().some((f) => f.name.includes('pespi'))).toBe(false)
  })

  it('warns when /food adds something one edit from an existing food', async () => {
    await bot.handleUpdate(update(OWNER, '/food ricce per100 p2.7 c28 f0.3') as never)
    expect(sent.at(-1)).toContain('very close to "rice"')
  })

  it('hands back a /food template with the quantity stripped', async () => {
    await bot.handleUpdate(update(OWNER, '1 palacsinta') as never)
    expect(sent.at(-1)).toContain('/food palacsinta per100 p? c? f?')
    expect(sent.at(-1)).not.toContain('src/parse.ts')
  })

  it('/food teaches a new food that logs on the next message', async () => {
    await bot.handleUpdate(update(OWNER, 'kefir 200g') as never)
    expect(sent.at(-1)).toContain('not in the local table')

    await bot.handleUpdate(update(OWNER, '/food kefir per100 p3.3 c4 f1') as never)
    expect(sent.at(-1)).toContain('added kefir')

    // No restart, no reload: the very next message parses it.
    await bot.handleUpdate(update(OWNER, 'kefir 200g') as never)
    expect(sent.at(-1)).toContain('+ kefir')
    expect(foods().at(-1)!.name).toBe('kefir')
    expect(foods().at(-1)!.kcal).toBe(76)
  })

  it('/food echoes the serving and aliases it stored', async () => {
    await bot.handleUpdate(
      update(OWNER, '/food zabtej per100g p0.8 c5.6 f1.8 g250 +oat milk, oatmilk') as never,
    )
    const reply = sent.at(-1)!
    expect(reply).toContain('added zabtej')
    expect(reply).toContain('serving 250 g')
    expect(reply).toContain('also: oat milk, oatmilk')
    // The old reply said "try: zabtej 100g" after setting a 250 g serving.
    expect(reply).not.toContain('100g')

    await bot.handleUpdate(update(OWNER, 'oat milk 200ml') as never)
    expect(sent.at(-1)).toContain('+ zabtej')
  })

  it('/food refuses an alias that belongs to another food', async () => {
    await bot.handleUpdate(update(OWNER, '/food fake per100 p1 c1 f1 +rice') as never)
    expect(sent.at(-1)).toContain('already belongs to rice')
  })

  it('/food with no arguments explains itself', async () => {
    await bot.handleUpdate(update(OWNER, '/food') as never)
    expect(sent.at(-1)).toContain('usage:')
  })

  it('/trend says what it still needs before it can estimate', async () => {
    await bot.handleUpdate(update(OWNER, '/trend') as never)
    expect(sent.at(-1)).toContain('weigh-ins')
  })

  it('/unfood removes a food and hands back the line to restore it', async () => {
    await bot.handleUpdate(update(OWNER, '/food ayran per100 p1.7 c2.9 f1.5 g250 +airan') as never)
    await bot.handleUpdate(update(OWNER, 'ayran 200g') as never)
    expect(sent.at(-1)).toContain('+ ayran')

    await bot.handleUpdate(update(OWNER, '/unfood ayran') as never)
    expect(sent.at(-1)).toContain('removed ayran')
    expect(sent.at(-1)).toContain('1 logged entry keeps its numbers')
    expect(sent.at(-1)).toContain('/food ayran per100 p1.7 c2.9 f1.5 g250 +airan')

    // Gone from the table, but the entry already written is untouched.
    await bot.handleUpdate(update(OWNER, 'ayran 200g') as never)
    expect(sent.at(-1)).toContain('not in the local table')
    expect(foods().filter((f) => f.name === 'ayran')).toHaveLength(1)
  })

  it('/unfood finds a food by an alias, and suggests on a typo', async () => {
    await bot.handleUpdate(update(OWNER, '/food ayran per100 p1.7 c2.9 f1.5 +airan') as never)
    await bot.handleUpdate(update(OWNER, '/unfood airan') as never)
    expect(sent.at(-1)).toContain('removed ayran')

    await bot.handleUpdate(update(OWNER, '/unfood ricee') as never)
    // Nearest first; an earlier test also left a `ricce` row in the table.
    expect(sent.at(-1)).toContain('did you mean: rice')

    await bot.handleUpdate(update(OWNER, '/unfood') as never)
    expect(sent.at(-1)).toContain('usage:')
  })

  it('/foods lists the vocabulary', async () => {
    await bot.handleUpdate(update(OWNER, '/foods') as never)
    expect(sent.at(-1)).toContain('never weighed')
    expect(sent.join('\n')).toContain('black coffee')
    expect(sent.join('\n')).toContain('skyr')
  })

  it('/foods <search> filters, and suggests when nothing matches', async () => {
    await bot.handleUpdate(update(OWNER, '/foods rice') as never)
    expect(sent.at(-1)).toContain('rice')
    expect(sent.at(-1)).toContain('matching "rice"')
    expect(sent.at(-1)).not.toContain('black coffee')

    await bot.handleUpdate(update(OWNER, '/foods riice') as never)
    expect(sent.at(-1)).toContain('nothing matching')
    expect(sent.at(-1)).toContain('did you mean')

    await bot.handleUpdate(update(OWNER, '/foods qqzz') as never)
    expect(sent.at(-1)).toContain('nothing matching')
    expect(sent.at(-1)).not.toContain('did you mean')
  })

  it('splits a reply Telegram would reject as too long', async () => {
    // The real failure: 35 foods with aliases came to 4,174 characters and
    // Telegram answered 400 "message is too long", so /foods silently did
    // nothing. Every part must fit under the 4,096 limit.
    for (let i = 0; i < 60; i++) {
      await bot.handleUpdate(
        update(OWNER, `/food filler${i} per100 p1 c1 f1 +filler${i} alpha, filler${i} beta`) as never,
      )
    }
    const before = sent.length
    await bot.handleUpdate(update(OWNER, '/foods') as never)

    const parts = sent.slice(before)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThan(4096)
    expect(parts.join('\n')).toContain('filler59')
  })

  // /today and `tsx src/today.ts` must stay one renderer, or the CLI drifts from the bot.
  it('/today replies with exactly todayReport()', async () => {
    await bot.handleUpdate(update(OWNER, '2 eggs') as never)
    await bot.handleUpdate(update(OWNER, '/today') as never)

    const { todayReport } = await import('../report.ts')
    expect(sent.at(-1)).toBe(todayReport())
    expect(sent.at(-1)).toContain('eggs')
    expect(sent.at(-1)).toContain('kcal left')
  })

  it('/undo takes a name or a time, and reaches past the 6 h window', async () => {
    await bot.handleUpdate(update(OWNER, 'black coffee') as never)
    await bot.handleUpdate(update(OWNER, '2 eggs') as never)
    await bot.handleUpdate(update(OWNER, 'banana') as never)
    const before = foods().length

    // By name, and NOT the most recent row — banana was logged after the eggs.
    const eggsBefore = foods().filter((f) => f.name === 'eggs').length
    await bot.handleUpdate(update(OWNER, '/undo eggs') as never)
    expect(sent.at(-1)).toContain('− eggs')
    expect(foods()).toHaveLength(before - 1)
    expect(foods().filter((f) => f.name === 'eggs')).toHaveLength(eggsBefore - 1)
    expect(foods().some((f) => f.name === 'banana')).toBe(true)

    // By the time shown in /today.
    const stamp = foods().at(-1)!.time
    const count = foods().length
    await bot.handleUpdate(update(OWNER, `/undo ${stamp}`) as never)
    expect(sent.at(-1)).toContain(stamp)
    expect(foods()).toHaveLength(count - 1)
  })

  it('/undo names the day back when it cannot find the food', async () => {
    await bot.handleUpdate(update(OWNER, 'banana') as never)
    await bot.handleUpdate(update(OWNER, '/undo bananna') as never)
    expect(sent.at(-1)).toContain('no "bananna" in today\'s log')
    expect(sent.at(-1)).toContain('did you mean: banana?')
  })

  it('/undo removes the later of two matching entries', async () => {
    await bot.handleUpdate(update(OWNER, 'black coffee') as never)
    await bot.handleUpdate(update(OWNER, 'black coffee') as never)
    const ids = foods().filter((f) => f.name === 'black coffee').map((f) => f.id)

    await bot.handleUpdate(update(OWNER, '/undo coffee') as never)
    const left = foods().filter((f) => f.name === 'black coffee').map((f) => f.id)
    expect(left).toContain(ids[0])
    expect(left).not.toContain(ids.at(-1))
  })
})
