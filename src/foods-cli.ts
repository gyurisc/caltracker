/**
 * Everything the parser knows, optionally filtered. Reads only.
 *   npx tsx src/foods-cli.ts [search]
 */
import { vocabReport } from './report.ts'

console.log(vocabReport(process.argv.slice(2).join(' ')))
