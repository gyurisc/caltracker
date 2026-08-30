---
description: Show today's log — items, kcal vs target, protein, remaining (same as the bot's /today)
argument-hint: "[YYYY-MM-DD]"
allowed-tools: Bash(npx tsx src/today.ts:*)
---

!`npx tsx src/today.ts $1`

The block above is today's log, rendered by the same `todayReport()` the Telegram bot's
`/today` uses. Read it back to the user as-is. Add a brief note only if something stands
out — a day far over or under target, protein well short of goal, or nothing logged yet.
Do not query the database separately; this output is authoritative.
