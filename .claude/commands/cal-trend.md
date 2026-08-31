---
description: Measured burn rate from intake and the weight trend, versus the assumed targets
argument-hint: "[days]"
allowed-tools: Bash(npx tsx src/calibrate-cli.ts:*)
---

!`npx tsx src/calibrate-cli.ts $1`

The block above calibrates the calorie targets against what actually happened: average
intake over the window against the least-squares weight trend, which back-calculates a
measured burn rate. Read it back as-is. It refuses to estimate when there is too little
data or when the inputs contradict each other — report that plainly rather than guessing
a number. Do not query the database separately; this output is authoritative.
