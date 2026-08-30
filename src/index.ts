import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { api } from './api.ts'
import { getFlag, setFlag } from './db.ts'
import { createBot } from './bot/index.ts'
import { DB_PATH, PORT, TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID, TZ, fromRoot, localDate } from './config.ts'
import { seedSampleData } from './seed.ts'

const app = new Hono()

// API first, so the SPA fallback below can never shadow it.
app.route('/api', api)
app.get('/health', (c) => c.json({ ok: true, date: localDate(), tz: TZ }))

// Prod-on-Mini: serve the built dashboard. In dev, Vite does this on :5173.
// Paths are pinned to the repo, not cwd, for the same reason DB_PATH is.
const DIST = fromRoot('dist')
if (existsSync(`${DIST}/index.html`)) {
  app.use('/assets/*', serveStatic({ root: DIST }))
  app.get('*', serveStatic({ path: `${DIST}/index.html` }))
}

// Gated on a flag, not a row count — otherwise wiping the log to start clean
// would silently repopulate 125 demo rows on the next restart.
if (!getFlag('seeded')) {
  console.log(`[seed] new database, seeding a sample fortnight (${seedSampleData()} rows)`)
  console.log('[seed] run `pnpm seed:wipe` before logging real food')
  setFlag('seeded', true)
}

// Unattended runs must survive a stray rejection rather than vanish mid-day.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  // A port clash must be fatal. The catch-all above otherwise keeps the process
  // alive with no HTTP server but a live bot, so a second instance quietly
  // double-polls Telegram and `ps` shows something that looks healthy.
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`[fatal] port ${PORT} is already in use — is caltrack already running? (pnpm serve:status)`)
    process.exit(1)
  }
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[api]  http://localhost:${info.port}  ·  db ${DB_PATH}  ·  tz ${TZ}`)
})

if (TELEGRAM_BOT_TOKEN && TELEGRAM_USER_ID) {
  const bot = createBot()
  bot.start({
    drop_pending_updates: true,
    onStart: (me) => console.log(`[bot]  @${me.username} polling · allowlisted user ${TELEGRAM_USER_ID}`),
  })
  const stop = () => { void bot.stop() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
} else {
  console.log('[bot]  disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID in .env')
}
