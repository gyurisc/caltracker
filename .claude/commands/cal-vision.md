---
description: How well the photo reader is doing, and what it got wrong
allowed-tools: Bash(npx tsx -e *)
---

!`npx tsx -e "import { visionReport } from './src/report.ts'; console.log(visionReport())"`

The block above summarises the photo-reading feature: how many cards were proposed,
logged and dropped, and every portion the user corrected — the guessed weight beside the
weighed one. Read it back as-is. Do not query the database separately; this output is
authoritative.

The corrections are the useful part. If there are enough of them and they lean
consistently one way, say so plainly — but do not propose a calibration factor off a
handful of points, and never treat a corrected weight as anything but the user's own
measurement.
