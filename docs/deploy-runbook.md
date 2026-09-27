# Deploying caltrack to Hetzner

The procedure. `deploy.md` beside this is the design and the security model, and
is the one to read when you are deciding *whether* something is safe; this one
is for the evening you actually do it.

caltrack moves to the box as **one systemd service**: it serves the dashboard
and polls Telegram in the same Node process. HTTP is read-only and public at the
hostname, Telegram is the only way to write anything, and you administer the box
over Tailscale. Nothing stays on the Mac.

```
   anyone on           ┌─ Hetzner CX22 ──────────────────────────┐
   the internet ──────▶│  Caddy, TLS on :443                     │
                       │      │                                  │
                       │      ▼                                  │
     Telegram ◀────────│  caltrack — one Node process,           │
        (polls out)    │  listening on 127.0.0.1:5082 only       │
                       │      │                                  │
   you, over           │      ▼                                  │
   Tailscale ─────────▶│  tmux, claude    data/ caltrack.db      │
        (SSH :22)      └─────────────────────────────────────────┘
```

Telegram is not like the other two doors: the process dials **out** to it, so
Telegram never connects inward and needs no open port.

## Before you start

**You need** the box with SSH key access, a Cloudflare account holding the
domain, and the WHOOP developer console open in a tab.

**Never run both copies at once.** Two processes cannot poll the same Telegram
bot token. If the box starts while the Mac is still running, Telegram answers
one of them with `409 Conflict` and your messages land in whichever won the race
— possibly the database you are about to abandon. Stage 3 is built so you can
install everything first without the two ever overlapping.

## 1. Lock the box down

```bash
# as root, first login
adduser <you> && usermod -aG sudo <you>
rsync --archive --chown=<you>:<you> ~/.ssh /home/<you>
```

`/etc/ssh/sshd_config.d/99-hardening.conf`, then `systemctl restart ssh`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

```bash
apt update && apt install -y fail2ban unattended-upgrades tmux mosh sqlite3
dpkg-reconfigure --priority=low unattended-upgrades
```

Set `Unattended-Upgrade::Automatic-Reboot "true";` with a 4 a.m. window in
`/etc/apt/apt.conf.d/50unattended-upgrades`. A kernel patch that needs a reboot
and never gets one is the same as no patch, and everything here comes back up
unattended.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh
```

**Then turn off key expiry for this machine in the Tailscale console**, or in
180 days it locks you out of your own admin door.

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow in on tailscale0 to any port 22 proto tcp
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do ufw allow from $ip to any port 443; done
ufw enable
```

Mirror the rules in the Hetzner Cloud Firewall too. It runs outside the VM, so
it holds even if `ufw` is wrong or the box is already compromised.

**Check:** SSH in over Tailscale from a second terminal *while the first is
still connected*.

## 2. Node and pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt install -y nodejs
sudo corepack enable && sudo corepack prepare pnpm@latest --activate
```

**Check:** `node -v` says v22, and `command -v pnpm` prints a path — write it
down, the systemd unit needs it in full. systemd does not load your shell
profile, and a bare `pnpm` there fails with exit 127.

`pnpm-workspace.yaml` already lists `better-sqlite3`, `esbuild` and `sharp`
under `allowBuilds`. Without that, pnpm 11 skips their build scripts and the
failure appears much later as a missing bindings file at runtime.

## 3. Install the app, Telegram still off

**Leave the Telegram keys out of the env file.** Without them the app skips the
bot *and* the WHOOP sync, so the box runs alongside the Mac with nothing
fighting over the bot token.

```bash
sudo adduser --system --group --home /srv/http/caltrack --shell /bin/bash caltrack
sudo -u caltrack git clone https://github.com/gyurisc/caltracker /tmp/caltrack
sudo -u caltrack sh -c 'cp -a /tmp/caltrack/. /srv/http/caltrack/ && rm -rf /tmp/caltrack'
```

Clone to `/tmp` and copy: `adduser` already created that home directory with
skel files in it, and `git clone` refuses a destination that is not empty. Give
the user a real shell, not `nologin`, or stage 9 cannot open a session as them.

```bash
cd /srv/http/caltrack
sudo -u caltrack pnpm install     # better-sqlite3 and sharp compile here
sudo -u caltrack pnpm build       # dist/ is gitignored, so build it on the box
```

```bash
sudo install -d -m 750 -o caltrack -g caltrack /etc/caltrack
sudo install -m 600 -o caltrack -g caltrack /dev/null /etc/caltrack/env
```

```ini
# /etc/caltrack/env — no TELEGRAM_* yet, on purpose
TZ=Europe/Amsterdam
PORT=5082
PUBLIC_URL=https://caltrack.example.com
DB_PATH=/srv/http/caltrack/data/caltrack.db
XAI_API_KEY=…
WHOOP_CLIENT_ID=…
WHOOP_CLIENT_SECRET=…
```

Keep the `TZ` the database was written against. Changing the zone moves where
one day ends and the next begins, for every row already logged.

**Do not copy the Mac's `.env` to the box.** systemd's `EnvironmentFile` wins
over a `.env` in the repo, but anything systemd does not set falls through to it.

The unit goes at `/etc/systemd/system/caltrack.service`. Two lines matter more
than the rest: `ReadWritePaths=/srv/http/caltrack/data`, without which
`ProtectSystem=strict` makes the SQLite file read-only; and leaving
`MemoryDenyWriteExecute` unset, because V8 writes executable memory and Node
will not start with it on.

```bash
sudo systemctl enable --now caltrack
systemd-analyze security caltrack
```

**Check:** `curl localhost:5082/health` returns `{"ok":true,…}` and
`journalctl -u caltrack -f` shows `[bot] disabled`. Both are right at this stage.

## 4. Caddy and DNS

```caddyfile
# /etc/caddy/Caddyfile
caltrack.example.com {
    reverse_proxy 127.0.0.1:5082
}
```

No auth block: the page is public by decision, and the app has no write routes
left to find (`deploy.md` §5).

Add the `A` record in Cloudflare, **proxied** — the orange cloud. Grey would
expose the box's real address, and the `ufw` rules only admit Cloudflare.

**Check:** the hostname loads the dashboard with an empty log. Empty is correct;
the box has no data yet.

## 5. The cutover

Order matters here more than anywhere else.

```bash
# 1. ON THE MAC, FIRST
pnpm serve:stop

# 2. copy the database properly — never cp a live SQLite file, WAL tears it
sqlite3 data/caltrack.db ".backup '/tmp/caltrack.db'"
scp /tmp/caltrack.db caltrack@<box>:/srv/http/caltrack/data/caltrack.db
rsync -av data/photos/ caltrack@<box>:/srv/http/caltrack/data/photos/
```

Those two only — `data/test-*.db` are test fixtures.

```bash
# 3. on the box: add TELEGRAM_BOT_TOKEN and TELEGRAM_USER_ID to /etc/caltrack/env
sudo chown caltrack:caltrack /srv/http/caltrack/data/caltrack.db
sudo systemctl restart caltrack
```

**Check:** the log shows `polling`, the dashboard has your data, and a Telegram
message lands.

**4. Then delete `data/caltrack.db` on the Mac.** The `/cal-*` commands read
whatever database sits next to the checkout they run in. Left in place, they
keep coaching you on a log that stopped updating — confidently, with no error.

## 6. Reconnect WHOOP

WHOOP matches the redirect URI **character for character**, which is why
`PUBLIC_URL` exists.

1. At developer.whoop.com, **add** `https://<host>/api/whoop/callback` as a
   second redirect URI. Keep the localhost one for development; WHOOP accepts
   several.
2. In Telegram, `/whoop connect`. The reply carries a **single-use ticket good
   for ten minutes** — `/api/whoop/start` is 404 without one (`deploy.md` §4).
3. Open it, approve, land on "WHOOP connected".

The first successful connect records the WHOOP account id; a different account
is refused from then on.

**If the login returns `400 — Request Header Or Cookie Too Large`**, that is
cookies piled up on the whoop.com domain, not your box. Clear them or use a
private window, then start again from `/whoop connect`; the old link is spent.

**Check:** the log shows `[whoop] grant:` with `scope=offline …`. The `offline`
part buys the refresh token; without it the grant dies in an hour.

## 7. The coach reports

The 07:00 / 11:00 / 16:00 messages run under launchd on the Mac. They do not
come with you, and they fail by simply never arriving.
`scripts/coach-notify.sh` shells out to `claude`, so it must be installed and
logged in **as the `caltrack` user**.

```ini
# /etc/systemd/system/caltrack-coach.service
[Service]
Type=oneshot
User=caltrack
WorkingDirectory=/srv/http/caltrack
ExecStart=/srv/http/caltrack/scripts/coach-notify.sh
```

```ini
# /etc/systemd/system/caltrack-coach.timer
[Timer]
OnCalendar=*-*-* 07,11,16:00
Persistent=true

[Install]
WantedBy=timers.target
```

`Persistent=true` is launchd's catch-up behaviour: a fire missed while the box
was down runs once after it returns instead of being skipped.

**Check:** `scripts/coach-notify.sh --dry-run` prints a report and sends
nothing; `systemctl start caltrack-coach` sends a real one.

## 8. Backups

The log is the whole point, and the one thing that cannot be rebuilt from the
repo. Two rules, both SQLite-specific: **never `cp` a live database**, and
**test a restore**.

```bash
# /etc/cron.daily/caltrack-backup
sqlite3 /srv/http/caltrack/data/caltrack.db ".backup '/var/backups/caltrack.db'"
restic -r sftp:<user>@<user>.your-storagebox.de:/backups backup /var/backups/caltrack.db
restic forget --keep-daily 14 --keep-weekly 8 --prune
```

A restic repo is encrypted at rest, so the Storage Box never holds readable
health data. **Keep the repo password somewhere that is not the server** — a
backup you cannot decrypt is not a backup.

**Check:** restore yesterday's snapshot to `/tmp` and open it before trusting
any of this.

## 9. Claude on the box

The session runs on the server inside a tmux session named after the project, so
closing the laptop does not stop it.

```bash
# in /srv/http/caltrack/.bashrc
tm() {
    local name="${1:-$(basename "$PWD")}"
    name="${name//./-}"; name="${name//:/-}"
    if [ -n "$TMUX" ]; then
        tmux has-session -t "$name" 2>/dev/null || tmux new-session -d -s "$name" -c "$PWD"
        tmux switch-client -t "$name"
    else
        tmux attach -t "$name" 2>/dev/null || tmux new -s "$name" -c "$PWD"
    fi
}
```

One Termius host per project: `cd /srv/http/caltrack && tm`.

**Run it as `caltrack`, not as you and not as root.** That is what makes a
generous approval mode survivable: the session can edit that one repo and
nothing else. The worst case is one folder, restored from git and last night's
backup. To let it deploy, grant exactly one thing rather than general
privileges:

```
caltrack ALL=(root) NOPASSWD: /usr/bin/systemctl restart caltrack
```

This is also where the `/cal-*` commands have to run from now on: they open the
database next to their checkout, and after the move that file only exists here.

```bash
# /etc/cron.weekly/claude-transcripts — transcripts are not durable, the repo is
find /srv/http/*/.claude/projects -name '*.jsonl' -mtime +7 -delete
```

## Day to day

| Want | Command |
| --- | --- |
| Is it up? | `systemctl status caltrack` |
| Logs, live | `journalctl -u caltrack -f` |
| Back into the project | `cd /srv/http/caltrack && tm` |
| What sessions exist | `tmux ls` |
| Deploy | `./deploy.sh` |
| Roll back | `git checkout <sha> && pnpm build && sudo systemctl restart caltrack` |
| Reload the proxy | `caddy reload -c /etc/caddy/Caddyfile` |
| Check the sandbox | `systemd-analyze security caltrack` |

```bash
# /srv/http/caltrack/deploy.sh
set -euo pipefail
cd /srv/http/caltrack
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm test && pnpm typecheck
sudo systemctl restart caltrack
```

`pnpm test` against the live directory is safe, but only because of a guard
added on purpose: `src/db.ts` refuses to open `caltrack.db` when `VITEST` is
set. Before it, the suite wrote fixture WHOOP tokens over the live grant on
every run and the integration died an hour later. That line is load-bearing
here in a way it never was on the Mac.

**First week, in order:** SSH only over Tailscale; the hostname answering only
through Cloudflare; `tm` reattaching from your phone; a full reboot bringing the
site, the bot and the proxy back with no hands; and one restored backup you
actually opened.
