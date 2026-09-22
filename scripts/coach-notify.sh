#!/usr/bin/env bash
# Post the /cal-coach report to Telegram. launchd runs this at 07:00, 11:00
# and 16:00 — see scripts/com.caltrack.coach.plist.
#
#   scripts/coach-notify.sh            generate and send
#   scripts/coach-notify.sh --dry-run  generate and print, send nothing
set -uo pipefail

# Resolve against the repo, never the caller's cwd: launchd starts us wherever
# it likes, and SQLite answers a wrong path by creating an empty database
# instead of failing — which would coach a day that never happened.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY=false
[ "${1:-}" = "--dry-run" ] && DRY=true
LOG="$ROOT/data/coach.log"
say() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$LOG"; }

TODAY="$(npx tsx src/today.ts 2>&1)"
if [ $? -ne 0 ]; then say "today.ts failed: $TODAY"; exit 1; fi

# The prompt is the slash command itself: drop the YAML frontmatter and the `!`
# line that shells out (we ran that above), and blank the $ARGUMENTS placeholder.
# Editing .claude/commands/cal-coach.md therefore changes the scheduled report
# too — one coach, not two that drift apart.
BODY="$(awk '/^---$/{n++; next} n>=2' .claude/commands/cal-coach.md \
  | grep -v '^!`' | sed 's/\$ARGUMENTS//')"

# The command says to answer in the language the user wrote in, and a scheduled
# run has no user message — which came out English on the first test. Say it.
LANG_NOTE="Ez egy utemezett uzenet, nincs felhasznaloi kerdes. Valaszolj magyarul."

REPLY="$(printf '%s\n\n%s\n\n%s' "$TODAY" "$BODY" "$LANG_NOTE" | claude -p 2>&1)"
if [ -z "$REPLY" ]; then say "claude returned nothing"; exit 1; fi

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
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "https://api.telegram.org/bot$TOKEN/sendMessage" \
  --data-urlencode "chat_id=$CHAT" \
  --data-urlencode "text=$REPLY")"
say "sent, telegram $CODE, ${#REPLY} chars"
[ "$CODE" = "200" ]
