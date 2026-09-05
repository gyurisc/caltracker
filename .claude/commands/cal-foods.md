---
description: List or search the foods the parser knows, with each one's rate
argument-hint: "[search]"
allowed-tools: Bash(npx tsx src/foods-cli.ts:*)
---

!`npx tsx src/foods-cli.ts $1`

The block above is the live vocabulary from the `vocab` table. Read it back as-is.
`~` marks a row whose macros were never weighed. Anything absent is refused, not
guessed. Do not query the database separately; this output is authoritative.
