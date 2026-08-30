# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Vite :5173 (proxies /api) + tsx :3000 (API + bot), concurrently
pnpm build        # vite build → dist/
pnpm start        # single process on :3000, serves dist/ and polls Telegram
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit
pnpm seed         # reseed the sample fortnight
pnpm seed:wipe    # delete seed rows, leave real ones
```

Run one test file or one case:

```bash
npx vitest run src/parse.test.ts
npx vitest run -t "logs both foods when a chunk has no punctuation"
```

`pnpm test` does **not** typecheck. Run `pnpm typecheck` separately — `src/bot/bot.test.ts`
once carried a stale grammY field that vitest happily ignored.

Native modules (`better-sqlite3`, `esbuild`) build via `allowBuilds` in
`pnpm-workspace.yaml`. pnpm 11 blocks build scripts without it, and the failure looks
like a missing bindings file at runtime, not an install error.

## What this is

A single-user calorie log. `docs/PRD.md` is the spec and is authoritative — §4 lists
non-goals that should not be built, and §15 locks the stack (no Next.js, Postgres,
Docker, webhooks, Nginx, or auth).

## Architecture

**One Node process, two surfaces.** `src/index.ts` starts Hono and grammY polling
together. The dashboard never touches SQLite; it `fetch`es `/api`. Both surfaces write
through the same code path, so changes to logging belong in one place.

**`src/service.ts` is that one place.** `logText()` runs parse → write → event, and both
`src/api.ts` (`POST /api/log`) and `src/bot/index.ts` (`message:text`) call it. Do not
add a second logging path.

**Route order matters** in `src/index.ts`: `/api` and `/health` are registered before the
SPA fallback (`serveStatic` on `*`), or the fallback shadows the API.

### Invariants that are easy to break

**kcal is derived, never accepted.** `deriveKcal()` applies 4/4/9 to the macros; nothing
supplied by a model or a user is stored as calories. The single exception is a
`FOOD_TABLE` entry carrying an explicit `kcal` for trace calories that no macro accounts
for (brewed coffee is 2 kcal; 4/4/9 on its macros gives 1). Vision, when built, must use
`kcalDisagrees()` to log an `error` event rather than trust the returned figure.

**The parser refuses whole messages.** If any word in a chunk is unrecognized, nothing
from that chunk is logged. Logging the understood part and dropping the rest is the worst
failure this app has — it produces a silent undercount that looks like success. Two real
bugs came from violating this: `2 eggs rice 200g` logged only rice, and
`chicken quinoa 100g` logged chicken while stealing the quinoa's weight.

`src/parse.ts` enforces it with three pieces that must stay in sync:
- `findMatches()` — every non-overlapping alias in a chunk, longest first
- `residual()` — what the matches and their modifiers did not consume; anything with
  letters left refuses the chunk
- `segmentStart()` — a leading quantity phrase belongs to the food that *follows* it, so
  `rice 200g half an avocado` splits correctly

Adding vocabulary means updating both the reader **and** `residual()`'s strip list, or the
new words become leftovers and refuse valid messages.

**Noise words vs macro-changing adjectives.** `NOISE_WORDS` (large, scrambled, free range)
are dropped because they do not change any row's macros. `fat free`, `skimmed`, `low fat`
are deliberately absent so they refuse instead of logging against the wrong row. Do not
"fix" those refusals by adding them to the noise list — add a table row.

**Local dates, never UTC.** Every date and time goes through `src/config.ts`
(`localDate`, `localTime`, `localHour`, `addDays`, `weekdayOf`, `lastDays`), which use
`Intl` with the configured `TZ`. `addDays` anchors at UTC noon so a DST shift cannot land
on the wrong day. Never call `new Date().toISOString().slice(0,10)`.

**Activity has one canonical set.** `days.activity` stores `rest|lifting|cycling`. The bot
accepts `lift`/`cycle`, the dashboard shows `Lift`/`Cycle`, and `normalizeActivity()`
maps everything at the edge. It returns `null` for unknown input rather than defaulting to
`rest`, because a silent default changes the calorie target.

**Undo is the most recent row overall**, not the last row of today, so a 00:15 undo reaches
the 23:50 meal. It refuses past `UNDO_WINDOW_HOURS` (6). Both surfaces use
`isWithinUndoWindow()`.

**Seeding is flag-gated, not row-count-gated.** `getFlag('seeded')` in `src/db.ts` guards
it. A row-count check repopulates 125 demo rows after someone wipes the log to start clean.
Seeding is idempotent — deterministic `seed-YYYY-MM-DD-n` ids and a per-day delete.

**The Telegram allowlist is a single user id.** Non-owners get no reply at all, not a
rejection message.

## Testing the bot

`src/bot/bot.test.ts` drives the real grammY handler with synthetic updates — no network.
Two things it needs: `bot.botInfo` set manually (skips `getMe`), and a `bot_command`
entity on any `/command` text, or grammY routes it to the text handler instead.

## Gotchas

- Anything path-shaped must go through `fromRoot()` in `src/config.ts`, which resolves
  against the repo rather than `process.cwd()`. This is not cosmetic: SQLite creates a
  missing database instead of failing, and dotenv reads `.env` from cwd, so a process
  started from the wrong directory silently gets an empty log **and** a disabled bot while
  appearing healthy. `DB_PATH`, `.env`, and `dist/` are all pinned this way.
- The PRD says `caltracker.db`; the code and README use `caltrack.db`. The code is correct.
- Vision (PRD §7.3) is **not built**. Photos are refused. When adding it, the confirm card
  needs a pending store: Telegram caps `callback_data` at 64 bytes, so parsed items cannot
  ride in the button. PRD §7.1 specifies an in-process `Map` with a TTL.
- `POST /api/settings` is the only way to change goals; the dashboard Targets block is
  read-only.
