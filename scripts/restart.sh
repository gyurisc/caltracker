#!/usr/bin/env bash
# Recycle the caltrack process: stop whatever holds PORT, start a fresh one.
#   scripts/restart.sh          restart
#   scripts/restart.sh stop     stop only
#   scripts/restart.sh status   report and exit
set -uo pipefail

# Resolve against the repo, never the caller's cwd — a process started elsewhere
# gets an empty DB and a disabled bot while still looking healthy.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r')"
PORT="${PORT:-3000}"
LOG="$ROOT/data/caltrack.log"

pids() { lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null; }

stop() {
  local found
  found="$(pids)"
  if [ -z "$found" ]; then
    echo "nothing listening on :$PORT"
    return 0
  fi
  # Kill the listener itself. Killing the pnpm/caffeinate wrapper only orphans it.
  echo "stopping $(echo "$found" | tr '\n' ' ')on :$PORT"
  kill $found 2>/dev/null
  for _ in $(seq 1 20); do
    [ -z "$(pids)" ] && return 0
    sleep 0.25
  done
  echo "still alive, sending SIGKILL"
  kill -9 $(pids) 2>/dev/null
  sleep 0.5
}

start() {
  if [ -n "$(pids)" ]; then
    echo "port :$PORT is still busy — refusing to start a second poller" >&2
    exit 1
  fi
  echo "starting…"
  # caffeinate -s keeps the Mac awake so polling survives; nohup outlives this shell.
  # </dev/null and disown detach it, or `pnpm restart` blocks until the server exits.
  nohup caffeinate -s pnpm start < /dev/null > "$LOG" 2>&1 &
  disown $! 2>/dev/null || true
  for _ in $(seq 1 40); do
    if curl -fsS -m 1 "http://localhost:$PORT/health" > /dev/null 2>&1; then
      echo "up on :$PORT"
      grep -E '^\[(api|bot)\]' "$LOG" | tail -2
      return 0
    fi
    sleep 0.25
  done
  echo "did not come up in 10s — last lines of $LOG:" >&2
  tail -5 "$LOG" >&2
  exit 1
}

case "${1:-restart}" in
  stop) stop ;;
  status)
    found="$(pids)"
    [ -n "$found" ] && echo "running: $found on :$PORT" || echo "not running (:$PORT free)"
    curl -fsS -m 1 "http://localhost:$PORT/health" 2>/dev/null && echo
    ;;
  restart) stop; start ;;
  *) echo "usage: scripts/restart.sh [restart|stop|status]" >&2; exit 2 ;;
esac
