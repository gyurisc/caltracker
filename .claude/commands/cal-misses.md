---
description: Show food phrases the parser refused, ranked — the FOOD_TABLE backlog
argument-hint: "[days]"
allowed-tools: Bash(npx tsx src/misses.ts:*)
---

!`npx tsx src/misses.ts $1`

The block above lists phrases the parser refused, most frequent first. Each one is a
missing `FOOD_TABLE` row in `src/parse.ts`. Read it back to the user, then offer to add
the most frequent entries. Do not query the database separately; this output is
authoritative. If the list is empty, say so in one line.
