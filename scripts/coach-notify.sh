#!/usr/bin/env bash
# Post the /cal-coach report to Telegram. launchd runs this at 07:00, 11:00
# and 16:00 — see scripts/com.caltrack.coach.plist.
#
#   scripts/coach-notify.sh                          generate and send
#   scripts/coach-notify.sh --dry-run                generate and print, send nothing
#   scripts/coach-notify.sh --slot evening --dry-run pretend it is that check-in
set -uo pipefail

# Resolve against the repo, never the caller's cwd: launchd starts us wherever
# it likes, and SQLite answers a wrong path by creating an empty database
# instead of failing — which would coach a day that never happened.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY=false
SLOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=true ;;
    --slot) SLOT="${2:-}"; shift ;;
  esac
  shift
done
LOG="$ROOT/data/coach.log"
say() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$LOG"; }

# Which check-in this is comes from the hour, not from which launchd fire it
# was: a Mac asleep through 11:00 and 16:00 gets one catch-up run on waking,
# and at 17:00 that should be the evening message. The hour is read in the
# configured TZ, because a VPS clock is usually UTC.
if [ -z "$SLOT" ]; then
  HOUR="$(npx tsx --eval "import { localHour } from './src/config.ts'; console.log(localHour())" 2>&1)"
  if ! [[ "$HOUR" =~ ^[0-9]+$ ]]; then say "localHour failed: $HOUR"; exit 1; fi
  if [ "$HOUR" -lt 10 ]; then SLOT=morning
  elif [ "$HOUR" -lt 15 ]; then SLOT=midday
  else SLOT=evening; fi
fi
case "$SLOT" in
  morning) TITLE="Reggeli coach" ;;
  midday)  TITLE="Déli coach" ;;
  evening) TITLE="Esti coach" ;;
  *) say "unknown slot: $SLOT"; exit 1 ;;
esac

TODAY="$(npx tsx src/today.ts 2>&1)"
if [ $? -ne 0 ]; then say "today.ts failed: $TODAY"; exit 1; fi
YESTERDAY="$(npx tsx src/today.ts yesterday 2>&1)"
if [ $? -ne 0 ]; then say "today.ts yesterday failed: $YESTERDAY"; exit 1; fi

# The prompt is the slash command itself: drop the YAML frontmatter and the
# whole data preamble it builds with `!` lines, keeping everything from "Today's
# log is above" onwards. We assemble the same two logs ourselves, under the same
# labels. Anchoring on that sentence rather than on the `!` lines means adding
# another one to the command cannot leave a dangling label here.
# Editing .claude/commands/cal-coach.md still changes the scheduled report —
# one coach, not two that drift apart.
BODY="$(awk '/^---$/{n++; next} n>=2' .claude/commands/cal-coach.md \
  | sed -n '/^Today.s log is above/,$p' | sed 's/\$ARGUMENTS//')"

# The command says to answer in the language the user wrote in, and a scheduled
# run has no user message — which came out English on the first test. Say it.
LANG_NOTE="Ez egy utemezett uzenet, nincs felhasznaloi kerdes. Valaszolj magyarul."

REPLY="$(printf 'Check-in: %s\n\nYesterday:\n\n%s\n\nToday:\n\n%s\n\n%s\n\n%s' \
  "$SLOT" "$YESTERDAY" "$TODAY" "$BODY" "$LANG_NOTE" | claude -p 2>&1)"
if [ -z "$REPLY" ]; then say "claude returned nothing"; exit 1; fi

# The compass is COACH_MARK in src/coach.ts: a Telegram reply to a message that
# opens with it goes to the coach as a follow-up instead of being logged as food.
REPLY="🧭 *$TITLE*

$REPLY"

# Telegram caps a message at 4096 characters.
REPLY="${REPLY:0:3900}"

if $DRY; then
  printf '%s\n' "$REPLY"
  say "dry run, ${#REPLY} chars"
  exit 0
fi

TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2- | tr -d ' \r')"
CHAT="$(grep -E '^TELEGRAM_USER_ID=' .env | cut -d= -f2- | tr -d ' \r')"
if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then say "no bot token or user id in .env"; exit 1; fi

# Only the status code is logged — never the token, never the URL holding it.
send() {
  curl -s -o /dev/null -w '%{http_code}' -X POST \
    "https://api.telegram.org/bot$TOKEN/sendMessage" \
    --data-urlencode "chat_id=$CHAT" \
    --data-urlencode "text=$1" "${@:2}"
}
# Models write **bold**; Telegram's Markdown bolds with one star and prints the
# second pair (telegramMarkdown() in src/coach.ts). A stray `_` or `[` makes
# Telegram refuse the whole message with 400, so fall back to plain text.
CODE="$(send "${REPLY//\*\*/*}" --data-urlencode "parse_mode=Markdown")"
[ "$CODE" = "400" ] && CODE="$(send "$REPLY")"
say "sent $SLOT, telegram $CODE, ${#REPLY} chars"
[ "$CODE" = "200" ]
