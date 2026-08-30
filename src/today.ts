/**
 * CLI mirror of the bot's /today. Reads only — no writes, no Telegram.
 *   npx tsx src/today.ts [YYYY-MM-DD]
 */
import { localDate } from './config.ts'
import { todayReport } from './report.ts'

const arg = process.argv[2]
if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
  console.error('usage: tsx src/today.ts [YYYY-MM-DD]')
  process.exit(1)
}

console.log(todayReport(arg || localDate()))
