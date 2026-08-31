/**
 * What the scale says about your targets. Reads only.
 *   npx tsx src/calibrate-cli.ts [days]
 */
import { calibrationReport } from './report.ts'

const arg = process.argv[2]
if (arg && !/^\d+$/.test(arg)) {
  console.error('usage: tsx src/calibrate-cli.ts [days]')
  process.exit(1)
}

console.log(calibrationReport(arg ? Number(arg) : 28))
