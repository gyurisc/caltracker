#!/usr/bin/env bash
# Install the three-times-a-day coach report as a launchd user agent.
#   scripts/install-coach.sh            install
#   scripts/install-coach.sh uninstall  remove
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.caltrack.coach"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

# Resolve both binaries here, where the profile is loaded — launchd has none of
# our PATH, and a bare name fails with exit 127 and no useful message.
NPX="$(command -v npx || true)"
CLAUDE="$(command -v claude || true)"
[ -n "$NPX" ]    || { echo "npx not found on PATH — run this from a normal shell" >&2; exit 1; }
[ -n "$CLAUDE" ] || { echo "claude not found on PATH — run this from a normal shell" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s|__ROOT__|$ROOT|g" \
    -e "s|__NODEBIN__|$(dirname "$NPX")|g" \
    -e "s|__CLAUDEBIN__|$(dirname "$CLAUDE")|g" \
  "$ROOT/scripts/com.caltrack.coach.plist" > "$PLIST"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

echo "installed $PLIST — fires at 07:00, 11:00 and 16:00"
echo "test one now:  launchctl kickstart $DOMAIN/$LABEL"
