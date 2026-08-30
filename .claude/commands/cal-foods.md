---
description: List every food the parser knows, with its rate per 100 g or per unit
allowed-tools: Bash(npx tsx src/foods-cli.ts:*)
---

!`npx tsx src/foods-cli.ts`

The block above is the live vocabulary from the `vocab` table. Read it back as-is.
`~` marks a row whose macros were never weighed. Anything absent is refused, not
guessed. Do not query the database separately; this output is authoritative.
