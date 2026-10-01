/**
 * CLI mirror of the bot's /today. Reads only — no writes, no Telegram.
 *   npx tsx src/today.ts [YYYY-MM-DD | yesterday]
 */
import { addDays, localDate } from './config.ts'
import { todayReport } from './report.ts'

const arg = process.argv[2]

// `yesterday` resolves here rather than in the caller's shell: `date -v-1d` is
// macOS and `date -d yesterday` is GNU, and neither knows the configured TZ.
// addDays anchors at UTC noon, so a DST shift cannot land on the wrong day.
const date = arg === 'yesterday' ? addDays(localDate(), -1) : arg || localDate()

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('usage: tsx src/today.ts [YYYY-MM-DD | yesterday]')
  process.exit(1)
}

console.log(todayReport(date))
