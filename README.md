# caltrack

Personal calorie and protein log. One Node process serves the dashboard API and
polls Telegram; both write the same SQLite file. Local only — no accounts, no
public URL, no webhook.

See [docs/PRD.md](docs/PRD.md) for the spec.

## Setup

```bash
pnpm install          # approves the better-sqlite3 native build via pnpm-workspace.yaml
cp .env.example .env  # then fill in the two Telegram values
```

`.env`:

| Key | Needed for |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the bot (from @BotFather) |
| `TELEGRAM_USER_ID` | the allowlist — only this id may write |
| `XAI_API_KEY` | vision, not wired yet |
| `TZ` | `Europe/Amsterdam`; "today" is always the local date |
| `PORT` | defaults to 3000 |
| `DB_PATH` | defaults to `./data/caltrack.db` |

Without the two Telegram values the API still runs; the bot logs
`[bot] disabled` and stays off.

## Run

```bash
pnpm dev     # Vite :5173 (proxies /api) + tsx :3000 (API + bot)
```

Open http://localhost:5173.

```bash
pnpm build && pnpm start   # single process on :3000, serves dist/ and still polls
```

A new database seeds a sample fortnight once, tracked by a flag rather than a
row count — so wiping the log to start clean does not repopulate demo rows on
the next restart. `pnpm seed` reseeds; `pnpm seed:wipe` removes seed rows and
leaves real ones alone.

## Deploy on your machine

```bash
git pull
pnpm install                 # pnpm-workspace.yaml approves the native build
pnpm build
pnpm seed:wipe               # before logging real food
nohup caffeinate -s pnpm start > caltrack.log 2>&1 &
```

Set an **absolute** `DB_PATH` in `.env`. It defaults to `./data/caltrack.db`,
relative to the working directory, so launching from anywhere else silently
creates an empty database:

```
DB_PATH=/Users/you/caltracker/data/caltrack.db
```

`caffeinate -s` holds sleep off only while the process runs; also set
System Settings → Energy → prevent sleeping when the display is off.
`unhandledRejection` and `uncaughtException` are logged rather than fatal, so a
stray error does not end the day silently — check `caltrack.log` for them.

## Test

```bash
pnpm test        # 22 tests: nutrition math, parser, and the Telegram handler
pnpm typecheck
```

`src/bot/bot.test.ts` drives the real bot with synthetic updates — no network —
and asserts that `black coffee` from the owner writes 2 kcal, and that a
stranger's identical message writes nothing.

## Bot

Text: `black coffee` · `minced meat 170g cooked` · `2 eggs, rice 200g`

`/today` `/week` `/target` `/weight 74.2` `/activity rest|lift|cycle` `/undo` `/help`

Anything outside the local food table in `src/parse.ts` is refused rather than
guessed. Photos are refused too until vision is wired.

## Layout

```
src/index.ts     Hono + grammY in one process
src/config.ts    env, and every local-date/time helper
src/db.ts        schema, pragmas, queries
src/nutrition.ts targets, activity normalization, kcal derivation
src/parse.ts     local food table + text parser
src/service.ts   the one logging pipeline both surfaces call
src/seed.ts      sample fortnight
src/api.ts       /api routes
src/bot/         Telegram handlers
web/             Vite + React dashboard, one route
data/            SQLite (gitignored)
```
