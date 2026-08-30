# Caltracker — Product Requirements Document

**Version:** 1.2  
**Status:** Ready to build  
**Date:** 30 Aug 2026  
**Owner:** Personal, single-user  
**v1 host:** Mac Mini, localhost, Telegram polling  
**License:** Private repo, no license. MIT if the source is ever published.  
**Reference:** Pieter Levels’ Caltrack ([announcement](https://x.com/levelsio/status/2075642972243190039), Aug 3 follow-up)

This is a personal nutrition log, not a consumer app. One human. Fast logging. Honest numbers. A dashboard that looks like a log, not a wellness brand.

---

## 1. Problem

Food logging dies when it takes more than a few seconds. Macro apps make you search a database, pick a serving, and fight the keyboard at the table.

What actually works: send a text or a plate photo the way you already message people. Get calories and protein back. See the week in one glance. Stay in a 500 kcal deficit without thinking about it all day.

## 2. Product

A private calorie and protein tracker with two surfaces:

| Surface | Job |
|---|---|
| **Telegram bot** | How you log. Text, photo, undo, weight, activity. |
| **Web dashboard** | How you look. Week bars, today, weight trend, targets. |

Photos go through Grok vision. Everything else is deterministic math on SQLite.

Telegram never loads the dashboard. Both talk to the same SQLite file via one Node process.

**Name:** Caltracker  
**Tone:** dense, dark, tabular, no cheerleading, no emoji chrome.

## 3. Goals

1. Log a meal in under 10 seconds (text) or 20 seconds (photo + confirm).
2. Hit a daily calorie target (maintenance − 500) and a protein goal (~180 g).
3. See the last 7 days of calories and protein without opening a settings maze.
4. Keep all food, weight, and photos on one machine. No accounts. No cloud vendor lock-in for the log itself.

## 4. Non-goals (v1)

Do **not** build these. They are how this project dies.

- WHOOP, WIP.co, Airthings, Apple Health, Garmin
- Correlation matrix / recovery / HRV
- Multi-user, login, teams, sharing, leaderboards
- Public internet, webhook, Nginx, Docker, VPS
- Recipe social, barcode shopping, restaurant menus
- Coaching personality, streaks, badges, gamification
- Native iOS/Android apps
- Next.js, Vercel, Postgres, Prisma
- “AI agent lives in tmux” as a product feature — operator workflow, not v1

v2 is allowed only after 14 days of real food rows exist.

## 5. User and context

One adult in fat-loss mode.

- Logs from a phone, at the table or kitchen scale
- Checks the dashboard on the Mac Mini (or another device on the same LAN)
- Lifts ~2×/week (Mon, Thu), cycles ~1×/week (Fri), rest otherwise
- Speaks to the bot in short fragments: `black coffee`, `minced meat 170g cooked`, a photo of a plate on a scale

Timezone: **Europe/Amsterdam**. “Today” is the local date, never UTC date.

## 6. Core loop

eat → send text or photo to Telegram
→ parser / vision returns items
→ user confirms (or edits)
→ row written to SQLite
→ dashboard bars update
→ optional: /today or glance at the week

If confirmation is skipped for high-confidence local matches (`black coffee`), still show what was written so it can be undone.

## 7. Functional requirements

### 7.1 Logging — Telegram

The bot is the primary input. Dashboard composer is a fallback, same parser.

**Inbound**

| Input | Behavior |
|---|---|
| Free text | Parse into one or more food items. Confirm if confidence is not high. |
| Photo | Resize, send to Grok vision, return item list, confirm in-chat. Caption is extra context. |
| Photo + caption | Vision + caption together. Caption wins on name/weight if they conflict with a guess. |
| `black coffee` / known short names | Local table, no API call. |

**Commands**

| Command | Action |
|---|---|
| `/today` | Eaten kcal / target, protein / goal, item list, deficit |
| `/week` | 7-day calorie + protein summary |
| `/weight <kg>` | Morning weight for today |
| `/activity rest\|lift\|cycle` | Sets today’s activity → changes maintenance |
| `/undo` | Deletes the most recent food row, regardless of logical day |
| `/target` | Shows maintenance, deficit, calorie target, protein goal |
| `/help` | Short command list |

**Confirm card (photo or low-confidence text)**

For each item: name, grams, cooked/raw, meal tag, P/C/F, kcal.  
Buttons: **Add** / **Cancel**. Optional: tap an item to drop it before add.

**Pending store.** Telegram caps `callback_data` at 64 bytes, so the parsed items cannot ride in the button. Between the vision response and the tap they live in an in-process `Map<string, PendingCard>` keyed by the confirm message id; the button carries only that key plus an action (`add` / `cancel` / `drop:<index>`).

| Rule | Behavior |
|---|---|
| TTL | 15 min. A sweep on each new card evicts expired entries |
| Expired tap | Edit the card to `card expired — send the photo again`, remove the buttons, write nothing |
| Process restart | The Map is lost. Any surviving card is treated as expired, same reply |
| After `add` or `cancel` | Delete the key immediately, so a double-tap cannot write the meal twice |
| `drop:<index>` | Rewrites the entry in place and re-renders the card; does not touch SQLite |

Nothing reaches `foods` until **Add** is tapped. Deliberately in-memory, not a `pending` table — an unconfirmed guess is not a log, and losing it on restart is the correct outcome.

**Activity naming (one canonical set)**

Stored in `days.activity` as `rest` \| `lifting` \| `cycling`. Everything else is an alias normalized at the edge: the bot accepts `rest`/`lift`/`cycle` (and `lifting`/`cycling`), the dashboard labels them `Rest` / `Lift` / `Cycle`. One `normalizeActivity()` helper, used by both surfaces. Unknown input → reject, do not default to `rest`.

**Constraints**

- Only the owner’s Telegram user id may talk to the bot. Everyone else is ignored.
- Undo targets the most recent food row by `(date, time)`, **not** the last row of today — a 00:15 undo must still reach the 23:50 meal. Refuse if that row is older than 6 h (`nothing recent to undo`). Always echo what was deleted. Undo is last item, not a history browser.
- Undo of a photo row also deletes its `photo_path` file.
- No chatty bot. Replies are compact: `+ black coffee · 2 kcal · today 518 / 1800`.

### 7.2 Nutrition engine

Defaults (editable in settings, not in the bot):

| Knob | Default |
|---|---|
| Protein goal | 180 g |
| Deficit | 500 kcal |
| Maintenance, rest | 2100 |
| Maintenance, lifting | 2400 |
| Maintenance, cycling | 2300 |

```
target_kcal = maintenance(activity) − deficit
```

Floor target at 800 kcal so a mis-set maintenance cannot starve the log.

**Activity defaults by weekday** (overridable per day):

- Mon, Thu → lifting
- Fri → cycling
- else → rest

**Color rules (dashboard)**

- Calories: green if `0 < eaten ≤ target`, red if `eaten > target`, blue/neutral fill if today is still empty
- Protein: green only if `protein ≥ goal`; otherwise muted / protein-blue
- Week calorie column height = `max(eaten, maintenance)`
- Horizontal line on the calorie column = target
- Horizontal line on the protein column = goal

Macros: integers for kcal; one decimal allowed for grams of P/C/F.

**kcal is derived, never accepted.** Every path — local table, vision, composer — stores

```
kcal = round(4 × protein_g + 4 × carbs_g + 9 × fat_g)
```

A `kcal` supplied by Grok is a cross-check, not a value: if it deviates from the derived figure by more than 15%, keep the derived number and write an `error`-kind row to `events` with both. This is what makes §2’s “deterministic math” true — the same macros always produce the same calories, and a model that returns 250 kcal for 40 g of pure fat cannot corrupt the log. Alcohol is out of scope in v1; if it is ever added, the formula needs a 7 kcal/g term.

### 7.3 Vision (Grok)

- Model: current xAI chat model with vision (`grok-4.5` or successor)
- User-initiated only (a photo was sent). Never on page load, never in a loop
- `max_tokens` ≤ 700
- **The backend resizes. Always.** Neither the browser nor Telegram is trusted to hand over a sized image. Server downscales to max 1280 px, JPEG ~0.82, before the xAI call
- Inbound cap: reject uploads over 12 MB before decoding (a phone HEIC/JPEG fits well under this)
- Outbound cap: reject the post-resize payload if it still exceeds ~1.5 MB
- Requires an image library server-side — see §15 (`sharp`)

**System rules the model must follow**

- Return JSON only: `{ "items": [{ name, grams, cooked, mealTag, proteinG, carbsG, fatG, kcal }] }`
- Split mixed plates (meat, rice, oil, sauce as separate rows)
- If a kitchen scale is visible, use that weight
- Prefer cooked weight when food is plated
- Black coffee ~2 kcal; tea 0
- Slightly conservative (do not undercount oil)
- `mealTag` = breakfast \| lunch \| snack \| dinner \| null
- `kcal` is returned for cross-checking only. The server recomputes it from the macros — see §7.2

On API failure: fall back to local table if the caption matches; otherwise tell the user to retry or type the food.

### 7.4 Local parser

A small per-100g / per-each table for high-confidence strings. If every chunk of the message hits the table, skip Grok.

Must include at least: black coffee, tea, banana, minced meat / ground beef, steak, chicken, salmon, rice, lettuce, olive oil, yogurt / YoPro / skyr, dark chocolate, milk, whey, eggs, avocado.

Parse `170g`, `cooked` / `raw`, meal words, and simple quantities (`2 eggs`).

**Canonical minced meat entry.** `minced meat` / `ground beef` with no fat percentage means **85/15 beef mince**. Chosen because it is the default supermarket grind and §7.3 requires erring high, not low. Per 100 g:

| State | kcal | Protein | Carbs | Fat |
|---|---|---|---|---|
| raw | 215 | 18.6 g | 0 | 15.0 g |
| cooked (pan-browned) | 250 | 25.7 g | 0 | 16.0 g |

Cooking drives water off, so cooked weight is *denser* in both kcal and protein — the two rows are not convertible by a single factor. If the actual purchase is leaner (`mager rundergehakt`, 5–7%), fix the table row rather than the acceptance test; every downstream number is derived from it.

### 7.5 Dashboard

One page. Dark. Max content width ~720–800 px. Mobile-first (390 px) with 44 px tap targets.

**Blocks, top to bottom**

1. **Header** — `caltracker` + today’s calorie target and protein goal
2. **Composer** — textarea + photo + send (same pipeline as Telegram; the browser uploads the original file and the server resizes it). Quick chips: `black coffee`, `banana`, `minced meat 170g cooked`
3. **Week calories** — 7 columns. Caption: “bar is eaten · shaded is maintenance · line is target”
4. **Week protein** — 7 columns. Caption: “line is goal”
5. **Today** — date, activity chips (Rest / Lift / Cycle), weight field, eaten/target bar, protein bar, item list (meal tag, name, grams cooked/raw, time, protein, kcal). Delete per row
6. **Weight · 14 days** — sparkline + latest kg + delta. Deficit-day count and protein-day count
7. **Targets** — protein g, deficit, three maintenances. “Reload sample week” for demos only

Empty today: “Nothing logged yet. Type a meal or snap a plate.”

No onboarding carousel. No empty-state illustration.

### 7.6 Coach (optional, user-initiated)

A button **Ask** sends the last 7 days as a compact summary to Grok.

Output: four short bullets — week, protein, what to eat next, one risk. No medical disclaimer essay. No emoji. Cap `max_tokens` at ~420. Never auto-fire.

If this slips schedule, cut it. Logging + bars ship without it.

## 8. Data model

SQLite file at `./data/caltracker.db`. WAL mode. No hosted database in v1.

On open:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

One `Database()` connection for the whole process. Writes in a transaction **after** vision returns, never while waiting on Grok.

Files on disk: `caltracker.db`, `caltracker.db-wal`, `caltracker.db-shm`. Backup with `db.backup()`, not `cp` while running.

### `days`

| Column | Type | Notes |
|---|---|---|
| date | TEXT PK | `YYYY-MM-DD` local |
| activity | TEXT | `rest` \| `lifting` \| `cycling` |
| weight_kg | REAL NULL | morning weigh-in |
| workout_name | TEXT NULL | |
| workout_minutes | INTEGER NULL | |
| workout_kcal | INTEGER NULL | informational; does not auto-add calories eaten |

### `foods`

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | uuid |
| date | TEXT | logical FK to days.date |
| time | TEXT | `HH:mm` local |
| meal_tag | TEXT NULL | breakfast/lunch/snack/dinner |
| name | TEXT | |
| grams | REAL NULL | |
| cooked | INTEGER NULL | 0/1 |
| protein_g | REAL | |
| carbs_g | REAL | |
| fat_g | REAL | |
| kcal | INTEGER | |
| source | TEXT | `text` \| `photo` \| `seed` |
| photo_path | TEXT NULL | local file; not a public URL |

### `events` (thin)

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| ts | TEXT | ISO local |
| kind | TEXT | `log` \| `undo` \| `weight` \| `activity` \| `error` |
| payload | TEXT | JSON |

**Settings** live in a `settings` table or a JSON file: protein goal, deficit, three maintenances, owner Telegram user id, timezone.

Photos under `./data/photos/YYYY-MM-DD/`. Discard full-res after 7 days. Do not persist full-res in the browser.

## 9. Architecture

```
Phone Telegram ──► Telegram servers ──► grammY polling ──► parser / vision
│
Laptop browser ──► Hono :3000 ──► /api  ──────────────────────┤
│                                       ▼
└── GET /  (Vite dist or proxy)      SQLite WAL
```

- One Node process: Hono (HTTP) + grammY (polling)
- Dashboard never talks to SQLite; it `fetch`es `/api`
- Vision and coach are server-side only. API key never in the browser
- v1 uses **polling**. No public URL. Webhook is v2/infra.

**Dev**

- Vite on `:5173` (HMR), proxies `/api` → `:3000`
- `tsx src/index.ts` on `:3000` (API + bot)
- Open `http://localhost:5173`

**Prod-on-Mini**

- `vite build` → `dist/`
- Hono `serveStatic` from `dist/` (API routes registered first)
- Same process, still polling, `http://localhost:3000`

`serveStatic` import: `@hono/node-server/serve-static`. `root` is relative to `process.cwd()` unless pinned with `import.meta.url`. Register `/api` and `/telegram` before `app.use('*', serveStatic(...))`. SPA fallback: `serveStatic({ path: dist + '/index.html' })`.

## 10. Privacy and safety

- Single allowlisted Telegram user id
- No analytics SDK
- No accounts
- `.env` gitignored: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`, `XAI_API_KEY`, `TZ`, `PORT`
- `data/` gitignored
- Logs are health data. Do not put the SQLite file in a public folder
- Destructive bulk “delete all” is a CLI/settings action with a typed confirm, not a dashboard button
- Coach and vision are estimates, not medical advice — one line in `/help`
- Cap AI spend: user-initiated, small tokens, one retry max

## 11. UX quality bar

The dashboard must survive a **blind screenshot comparison** against Levelsio’s Caltrack shots:

- Dark near-black field, not purple, not glassmorphism
- Tabular numbers
- Week bars with target line and maintenance remainder
- Today card with meal tags in small caps (`LUNCH`) and `170 g cooked`
- Activity as a compact label, not a hero illustration
- Density over whitespace

Copy is short and literal: `goal 1,800 kcal · 180 g protein`. No “You’ve got this.”

## 12. Sample data

First run (or “Reload sample week”) seeds 14 days ending today:

- Today: black coffee only, so the user has something to log
- Past days: mixed rest/lift/cycle days with minced meat, rice, yogurt, banana, etc.
- Weight trend slowly down from ~76 kg
- Deterministic row ids for the seed (`seed-YYYY-MM-DD-n`)

Production owner can wipe seed and start clean.

## 13. Success criteria

v1 is done when **all** of these are true:

1. Text `black coffee` logs 2 kcal without calling an API
2. Text `minced meat 170g cooked` produces ~425 kcal and ~44 g protein (within 15%: 361–489 kcal, 37–50 g), derived from the §7.4 table row — not hardcoded
3. A real plate photo returns ≥1 item, user confirms, row appears in `/today` and on the dashboard
4. `/undo` removes that row
5. `/weight 74.2` and `/activity lift` change today and the calorie target
6. Week calorie bars match the math in §7.2 (line = target, fill = eaten, red if over)
7. Dashboard is usable at 390 px with no horizontal scroll
8. SQLite file survives process restart
9. A stranger’s Telegram account cannot write to the log
10. `.env` is not committed; keys never appear in client JS

Out of scope for “done”: coach quality, perfect USDA accuracy, visual clone pixel-perfect to his font.

## 14. Test plan (minimum)

- Unit: `target = maintenance − deficit` for all three activities; floor at 800
- Unit: local parser for coffee, 170 g minced meat, `2 eggs`
- Unit: meal tag from clock (optional) does not crash at midnight
- Unit: `kcal` derived from macros; a vision payload whose `kcal` is 40% off is overridden and logged
- Unit: expired pending card writes no `foods` row; double-tapping **Add** writes exactly one
- Manual: `/undo` at 00:15 removes the 23:50 meal, not nothing
- Manual: send photo of a scale with chicken; confirm grams ≈ scale
- Manual: overeat past target → bar turns red
- Manual: protein ≥ 180 → protein bar green
- Restart process → last log still there

## 15. Locked stack (v1, Mac Mini)

Do not change this.

| Layer | Use |
|---|---|
| Runtime | Node 22 + TypeScript + pnpm |
| HTTP | Hono + `@hono/node-server` |
| Bot | grammY, **polling** |
| DB | better-sqlite3, WAL, `./data/caltracker.db` |
| Dashboard | Vite + React, one route |
| Vision | `fetch` → `https://api.x.ai/v1/chat/completions` |
| Images | `sharp` — server-side resize for both the bot and composer paths (§7.3) |
| Config | `.env` + dotenv |
| Dev | `pnpm dev` = Vite `:5173` + `tsx` `:3000` |
| Prod-on-Mini | `vite build`, Hono `serveStatic` on `:3000`, still polling |

**Repo layout**

```
src/index.ts          # Hono + grammY in ONE process
src/db.ts
src/nutrition.ts
src/parse.ts          # local food table first
src/bot/
web/                  # Vite React
data/caltracker.db
```

**Not in v1:** Next.js, Express, Telegraf, Postgres, Prisma, Docker, systemd, webhook, Nginx, Python.

## 16. Build order

Do these in order. Do not start 7 before 3 works.

1. SQLite schema + nutrition math
2. Local parser + seed + dashboard today + week bars
3. Dashboard composer (text) writing real rows
4. Telegram bot, allowlist, `/today` `/undo` `/weight` `/activity`
5. Grok vision + confirm card
6. Weight sparkline + settings
7. Coach button (optional)
8. (Later, not v1) VPS + webhook + firewall + Tailscale

## 17. Open questions (owner, not the agent)

Answer these once. Do not block the build on research.

- Protein goal: 180 g or 2 g × bodyweight?
- Does cycling bump maintenance to 2300 or do you log ride kcal separately?
- Keep photos on disk or discard after vision?
- Timezone always Amsterdam, or follow the Mac Mini?

Defaults if unanswered: 180 g, maintenance-by-activity only (workout kcal is display-only), discard full-res after 7 days, timezone Amsterdam.

## 18. v2 backlog (after 14 days of logs)

- WHOOP recovery / RHR overlay
- Habit ticks (WIP-style)
- Food leaderboard (kcal and protein by item, all-time)
- Body-fat heuristic
- Persistent on-box agent that reads SQLite and answers “how am I doing” in Telegram
- Correlation table (sleep, air, strain vs next-day RHR)
- Telegram webhook + Tailscale dashboard