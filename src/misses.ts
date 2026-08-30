/**
 * What the parser refused, grouped and ranked — the vocabulary backlog.
 * Reads only.
 *   npx tsx src/misses.ts [days]
 */
import { missesReport } from './report.ts'

const arg = process.argv[2]
if (arg && !/^\d+$/.test(arg)) {
  console.error('usage: tsx src/misses.ts [days]')
  process.exit(1)
}

console.log(missesReport(arg ? Number(arg) : 30))
