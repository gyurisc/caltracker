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

# When launchd owns the job, starting our own process creates an orphan it can
# never manage: the orphan holds the port, every launchd start dies on
# EADDRINUSE, and KeepAlive turns that into a permanent loop. One of those ran
# for a day and wrote 8,473 failures into this log. So if the job is installed,
# every verb goes through launchd.
LABEL="com.caltrack.server"
DOMAIN="gui/$(id -u)"
managed() { launchctl print "$DOMAIN/$LABEL" > /dev/null 2>&1; }
job_pid() { launchctl print "$DOMAIN/$LABEL" 2>/dev/null | awk '/^\tpid = /{print $3; exit}'; }

# launchd's pid is the `pnpm` wrapper; the listener is its grandchild through
# tsx, so comparing the two directly never matches. Walk up instead.
descends_from() {
  local pid="$1" ancestor="$2" i
  [ -n "$ancestor" ] || return 1
  for i in $(seq 1 10); do
    [ "$pid" = "$ancestor" ] && return 0
    [ "$pid" = "1" ] || [ -z "$pid" ] && return 1
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  done
  return 1
}

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
  # Append, never truncate: launchd writes here too, and `>` has already eaten
  # the only copy of a failure worth reading.
  nohup caffeinate -s pnpm start < /dev/null >> "$LOG" 2>&1 &
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

if managed; then
  case "${1:-restart}" in
    stop)
      echo "stopping $LABEL via launchd"
      launchctl kill SIGTERM "$DOMAIN/$LABEL" 2>/dev/null || true
      ;;
    status)
      launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E '^\s+(state|pid|last exit code) ' || true
      curl -fsS -m 1 "http://localhost:$PORT/health" 2>/dev/null && echo
      ;;
    restart)
      # Any listener launchd did not start would survive the kickstart and make
      # the new one die on EADDRINUSE, so it goes first.
      owner="$(job_pid)"
      for pid in $(pids); do
        if ! descends_from "$pid" "$owner"; then
          echo "killing unmanaged listener $pid on :$PORT"
          kill "$pid" 2>/dev/null; sleep 1
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
      echo "restarting $LABEL via launchd"
      launchctl kickstart -k "$DOMAIN/$LABEL"
      for _ in $(seq 1 40); do
        if curl -fsS -m 1 "http://localhost:$PORT/health" > /dev/null 2>&1; then
          echo "up on :$PORT"
          exit 0
        fi
        sleep 0.25
      done
      echo "did not come up in 10s — last lines of $LOG:" >&2
      tail -5 "$LOG" >&2
      exit 1
      ;;
    *) echo "usage: scripts/restart.sh [restart|stop|status]" >&2; exit 2 ;;
  esac
  exit 0
fi

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
