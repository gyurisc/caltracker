import { serve } from '@hono/node-server'
import { startSync as startWhoopSync } from './whoop.ts'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { api } from './api.ts'
import { getFlag, setFlag } from './db.ts'
import { createBot } from './bot/index.ts'
import { DB_PATH, PORT, TELEGRAM_BOT_TOKEN, TELEGRAM_USER_ID, TZ, fromRoot, localDate } from './config.ts'
import { seedSampleData } from './seed.ts'
import { mayReach } from './access.ts'
import { statsPage } from './stats.ts'

const app = new Hono()

/**
 * The public surface is one server-rendered page and the WHOOP round trip.
 * Everything else — the dashboard, `/api/state`, every mutating route — answers
 * only to the local network or an SSH tunnel. See src/access.ts for why one
 * address rule is right on both the Mac and a VPS.
 *
 * This runs before any route so nothing added later is exposed by forgetting.
 */
app.use('*', async (c, next) => {
  // @hono/node-server hangs the raw request off c.env. `x-forwarded-for` is
  // read only as a fallback, and is itself untrusted — a reverse proxy in front
  // of this must be the one setting it, never the caller.
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  const remote = env?.incoming?.socket?.remoteAddress
    ?? c.req.header('x-forwarded-for')?.split(',')[0]

  if (mayReach(new URL(c.req.url).pathname, remote)) return next()

  // 404 rather than 403: a refusal that admits the route exists is an invitation.
  return c.text('not found', 404)
})

// The public page. Rendered here, so there is no endpoint behind it to find.
app.get('/stats', (c) => c.html(statsPage()))

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

  // Context, on its own schedule. It touches no target — see src/whoop.ts.
  // It gets a way to speak because a grant that silently stopped working is
  // only discovered days later, by wondering where the numbers went.
  startWhoopSync((text) => {
    void bot.api.sendMessage(TELEGRAM_USER_ID, text).catch(() => {})
  })
} else {
  console.log('[bot]  disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID in .env')
  startWhoopSync()
}
