#!/usr/bin/env bash
# Install caltrack as a launchd user agent: starts at login, restarts on crash.
#   scripts/install-launchd.sh            install and start
#   scripts/install-launchd.sh uninstall  stop and remove
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.caltrack.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

# Stop anything already holding the port, or the agent crash-loops on EADDRINUSE.
bash "$ROOT/scripts/restart.sh" stop || true

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__ROOT__|$ROOT|g" "$ROOT/scripts/com.caltrack.plist" > "$PLIST"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

echo "installed $PLIST"
sleep 3
launchctl print "$DOMAIN/$LABEL" | grep -E '^\s+(state|pid) ' || true
