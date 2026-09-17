# Deploying caltrack to a VPS

Status: **planned, not done.** The app runs on a Mac mini under launchd today.
This is the design for moving it to a Hetzner box, and the security model it
has to satisfy.

The PRD anticipates this. §4 lists "Public internet, webhook, Nginx, Docker,
VPS" as a **v1 non-goal**, and §16 step 8 puts "VPS + webhook + firewall +
Tailscale" explicitly in later work. Moving is not a breach of the spec; doing
it while v1 was still being built would have been.

---

## 1. What the box has to run

One Node process. It serves HTTP and polls Telegram in the same process, by
design — see `src/index.ts`. There is no queue, no worker, no second service.

| | |
|---|---|
| Runtime | Node 22, pnpm |
| Port | `PORT` from `.env` (5082 today) |
| Database | one SQLite file, `data/caltrack.db`, WAL |
| Photos | `data/photos/YYYY/MM/*.jpg`, two sizes each |
| Process manager | launchd on the Mac; **systemd** on the VPS |

`data/` is ~8 MB today, 1.2 MB of it photographs. It grows by roughly 300 KB
per photo logged.

### Native modules

`better-sqlite3` and `esbuild` compile on install, and pnpm 11 blocks build
scripts unless they are listed in `allowBuilds` in `pnpm-workspace.yaml`. If
that is missed, the failure appears at runtime as a missing bindings file, not
as an install error. Build on the target architecture; do not copy
`node_modules` from the Mac.

---

## 2. The access model

Implemented in `src/access.ts`, enforced by a middleware in `src/index.ts` that
runs **before every route**. A route added later is private until somebody
publishes it deliberately — forgetting fails closed.

### Public

| Path | Why |
|---|---|
| `/stats` | the published page — see below |
| `/health` | liveness, carries no personal data |
| `/api/whoop/start`, `/api/whoop/callback` | the OAuth redirect lands in a browser that may be anywhere |

### Everything else

Answers only to **loopback and the RFC1918 private ranges**. One rule is correct
on both machines, which is why it is stated about addresses rather than about
environments:

- On the Mac, the phone on the same wifi is `192.168.x.x` — private, allowed.
- On a VPS, traffic off the internet arrives from public addresses — denied —
  while an **SSH tunnel emerges on loopback** and is allowed.

So on Hetzner the owner reaches the full dashboard with:

```
ssh -N -L 5082:localhost:5082 caltrack@<box>
# then http://localhost:5082 in a browser
```

Refusals answer **404, not 403**: a refusal that confirms the route exists is an
invitation.

### `x-forwarded-for`

Read only as a fallback when the peer address is absent, and it is **untrusted**
— a caller can put anything in it. If a reverse proxy is ever placed in front of
this, the proxy must be the one setting that header, and the app must not be
reachable except through it. Without that guarantee, a forged header hands out
the dashboard to whoever asks.

---

## 3. What `/stats` publishes, and what it does not

Server-rendered in `src/stats.ts`. Rendered rather than fetched on purpose:
there is no endpoint behind it to discover, no JSON to widen, and nothing to
query for a field the page chose not to show. **What is in the HTML is the whole
of what is published.**

| Published | Deliberately withheld |
|---|---|
| calories per day vs target | every meal, and the time of day it was eaten |
| protein per day vs goal | photographs of food and kitchen |
| a weight line | waist circumference |
| | sleep, recovery, resting heart rate, HRV |

The distinction is not squeamishness. `/api/state` — the dashboard's single call
— returns all of the right-hand column, which together is a health record and a
daily-movements record. Publishing numbers about the project was never the same
question as publishing that.

Before going live, re-read the rendered page and confirm nothing new has crept
in; `curl -s localhost:5082/stats | grep -iE 'waist|hrv|photo|recovery'` should
return nothing.

---

## 4. WHOOP on a public host

### The redirect URI must change

`WHOOP_REDIRECT` is built from `PORT` in `src/config.ts` and is currently
`http://localhost:5082/api/whoop/callback`. WHOOP matches it **character for
character** against the app registration.

On the VPS it becomes `https://<host>/api/whoop/callback`, which means:

1. Add the new URI to the WHOOP app at developer.whoop.com — it accepts several,
   so the Mac's can stay for local work.
2. Replace the derived constant with a `PUBLIC_URL` environment variable.
   **This must land before the move**, or the connect flow breaks on the new
   host with an error that only says "redirect_uri mismatch".

### The hole that is still open

`/api/whoop/start` and `/api/whoop/callback` are public, because the redirect
lands in a browser that may be anywhere. They cannot be address-gated.

The `state` parameter prevents CSRF; it does **not** stop someone deliberately
walking the flow themselves. They would call `/start`, have a state minted for
them, and finish normally — binding *their* WHOOP account to this instance. A
lesser nuisance: `whoop_state` is a single slot, so anyone hitting `/start`
overwrites the owner's pending connect.

Two guards, neither built yet:

**A one-time connect token.** The bot is already allowlisted to exactly one
Telegram user id. `/whoop connect` mints a single-use, short-lived token and
returns `…/api/whoop/start?t=<token>`; `/start` without a valid token returns
404. This closes the hole outright.

**Account pinning.** On callback, fetch `/user/profile/basic` and compare
`user_id` against the value recorded on first successful connect. A foreign
account is refused even if the token guard were bypassed, and it also catches
authorising the wrong WHOOP account by accident.

### Grant durability

The refresh token is the whole integration: losing it needs a browser pointed at
this host. `src/whoop.ts` therefore clears it **only** on a 400 or 401 — WHOOP
saying the grant itself is dead. Timeouts, dropped packets and 5xx keep the
token and retry on the next half-hourly sync. A lost grant announces itself in
Telegram **once**, with the notice stored in the database so a process restart
does not repeat it.

---

## 5. The mutating routes

Not reachable from the internet under the access rule above, but worth knowing
they exist:

```
POST   /api/log            POST   /api/day/activity
POST   /api/undo           POST   /api/day/weight
DELETE /api/food/:id       POST   /api/settings
```

Nothing in the dashboard calls any of them; every write goes through Telegram.
`POST /api/settings` is the only way to change calorie goals and is worth
keeping.

`POST /api/seed` used to be here and is **deleted**. It called
`seedSampleData()` with no flag check, so a single request put 112 demo rows
into a log that had been deliberately wiped — which is exactly what happened
while testing these rules. `pnpm seed:wipe` removes them; it only touches
`seed-` prefixed ids and leaves real rows alone.

---

## 6. Secrets

`.env` is gitignored and must be copied to the box out of band — never through
the repo, never through a chat window.

```
TELEGRAM_BOT_TOKEN      TZ
TELEGRAM_USER_ID        PORT
XAI_API_KEY             WHOOP_CLIENT_ID
                        WHOOP_CLIENT_SECRET
```

`dotenv` reads `.env` relative to the process working directory, and everything
path-shaped goes through `fromRoot()` in `src/config.ts` for the same reason: a
process started from the wrong directory gets an **empty database and a disabled
bot while still answering `/health`**. Pin `WorkingDirectory` in the unit file.

The WHOOP tokens live in the `settings` table, not in `.env`. They do not
survive a database restore from before the connection, so reconnect after any
restore.

---

## 7. Process supervision, and the mistake to avoid

The lesson from the Mac is worth carrying over. `scripts/restart.sh` used to
start a process that **launchd could not manage**. That orphan held the port, so
every launchd start died on `EADDRINUSE`, and `KeepAlive` turned it into a loop:
**8,473 failed starts and 8.5 MB of log in 24 hours**, while the orphan's own
output went to a terminal that no longer existed — which is why a WHOOP failure
during that window left no trace anywhere.

Two rules came out of it, and both apply to systemd:

1. **One supervisor owns the process.** Never start it by hand alongside the
   unit. `scripts/restart.sh` now delegates to `launchctl` when the job is
   installed; the systemd equivalent is `systemctl --user restart caltrack`.
2. **Never truncate the log.** The script had `> "$LOG"`, which ate the only
   copy of the failure worth reading. Under systemd, journald handles this;
   do not add a redirect that fights it.

A sketch of the unit:

```ini
[Unit]
Description=caltrack
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/caltrack/caltracker
ExecStart=/usr/bin/env pnpm start
Restart=always
RestartSec=10
# Without this, a crash loop is indistinguishable from a running service.
StartLimitIntervalSec=300
StartLimitBurst=5

[Install]
WantedBy=default.target
```

`StartLimitBurst` is the piece the Mac was missing: a loop should stop and stay
stopped, loudly, rather than retry forever into a log nobody reads.

---

## 8. Firewall

Only two ports need to be open to the internet:

- **22** — SSH, key-only, password auth disabled. This is the owner's route to
  the full dashboard, through a tunnel.
- **443** — for `/stats` and the WHOOP callback, behind a TLS terminator.

The app's port itself must **not** be open. If TLS is terminated by something in
front, read the `x-forwarded-for` warning in §2 again before trusting it.

Tailscale remains the stronger option and the one the PRD names. It would let
§2's private-range rule cover the dashboard without any tunnel, and would mean
the box needs no open port at all beyond what `/stats` requires.

---

## 9. Backups

One file and one directory:

```
data/caltrack.db      the whole log, settings, vocabulary and WHOOP tokens
data/photos/          the pictures the log rows point at
```

Back up the database with `sqlite3 data/caltrack.db ".backup ..."` rather than
copying the file — WAL mode means a plain `cp` can catch a torn write.

Nineteen days of real logging live in there and exist nowhere else. There is no
export, and the PRD does not call for one; a backup is the whole of the safety
net.

---

## 10. Order of work

1. Add `PUBLIC_URL` and derive `WHOOP_REDIRECT` from it. **Before anything
   else** — the connect flow breaks without it.
2. Build the one-time WHOOP connect token and the account pin (§4).
3. Provision the box, non-root user, SSH keys, firewall.
4. Install Node 22 and pnpm; `pnpm install` on the box so native modules build
   there.
5. Copy `.env` out of band; copy `data/` with a proper SQLite backup.
6. Install the systemd unit; confirm `systemctl --user status`.
7. Add the new redirect URI to the WHOOP app, then reconnect.
8. Verify: `/stats` from the internet, everything else 404 from the internet and
   200 through a tunnel.
9. Point DNS and TLS at it last, so nothing is briefly exposed unfinished.
