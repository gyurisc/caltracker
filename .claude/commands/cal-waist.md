---
description: Waist circumference over time
allowed-tools: Bash(npx tsx -e *)
---

!`npx tsx -e "import { waistReport } from './src/report.ts'; console.log(waistReport())"`

The block above is the waist series. Read it back as-is. Do not query the database
separately; this output is authoritative.

Waist is measured weekly and moves slowly. Do not read a single centimetre as a change —
a tape read to the nearest cm, at a slightly different height or on a different breath,
moves more than a week of real progress does. Comment on direction only when several
measurements point the same way.

It is deliberately not an input to the calorie calibration. A waist that falls while the
scale holds steady is the outcome the training is for, not a contradiction to explain
away.
