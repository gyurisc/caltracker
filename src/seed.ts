/** PRD §12. Deterministic sample week so the dashboard has something to draw. */
import { addDays, localDate, localTime, weekdayOf } from './config.ts'
import { db, ensureDay, addFoods, type NewFood } from './db.ts'
import { defaultActivityFor } from './nutrition.ts'
import { parseMessage } from './parse.ts'

const MENUS = [
  ['black coffee', '3 eggs', 'yogurt 200g', 'chicken 220g cooked', 'rice 250g', 'olive oil 14g', 'whey', 'banana', 'minced meat 150g cooked'],
  ['black coffee', 'yogurt 250g', 'banana', 'minced meat 220g cooked', 'rice 260g', 'olive oil 14g', 'dark chocolate 30g', 'milk 250g', 'whey'],
  ['black coffee', '2 eggs', 'whey', 'salmon 200g cooked', 'rice 240g', 'avocado 100g', 'lettuce 80g', 'dark chocolate 25g', 'minced meat 150g cooked', 'milk 250g'],
  ['black coffee', 'yogurt 200g', 'banana', 'steak 250g cooked', 'rice 220g', 'olive oil 14g', 'lettuce 100g', 'milk 250g', 'whey', '2 eggs'],
  ['black coffee', '4 eggs', 'yogurt 200g', 'chicken 250g cooked', 'rice 300g', 'olive oil 14g', 'banana', 'dark chocolate 40g', 'milk 300g'],
  ['black coffee', 'whey', 'banana', 'minced meat 180g cooked', 'rice 300g', 'lettuce 100g', 'avocado 80g', '3 eggs', 'yogurt 200g', 'olive oil 14g'],
  ['black coffee', '2 eggs', 'yogurt 150g', 'salmon 180g cooked', 'rice 200g', 'olive oil 14g', 'dark chocolate 20g', 'chicken 200g cooked', 'banana', 'whey'],
]

const TIMES = ['07:40', '08:05', '10:15', '12:50', '13:05', '13:20', '16:30', '18:30', '19:00', '19:20']

function minTime(a: string, b: string): string {
  return a <= b ? a : b
}

export function seedSampleData(days = 14, end: string = localDate()): number {
  return db.transaction(() => {
    let written = 0
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(end, -i)
      const isToday = date === end
      const dayIndex = days - 1 - i

      ensureDay(date)
      db.prepare('UPDATE days SET activity = ?, weight_kg = ? WHERE date = ?').run(
        defaultActivityFor(weekdayOf(date)),
        // ~76 kg drifting down, with a little day-to-day noise.
        Math.round((76 - dayIndex * 0.07 + ((dayIndex * 37) % 5) * 0.06) * 10) / 10,
        date,
      )

      db.prepare("DELETE FROM foods WHERE date = ? AND source = 'seed'").run(date)

      // Today gets coffee only, so the owner has something left to log.
      const menu = isToday ? ['black coffee'] : MENUS[dayIndex % MENUS.length]!
      const items: NewFood[] = []
      let seq = 0
      menu.forEach((text, n) => {
        const parsed = parseMessage(text)
        if (!parsed.ok) return
        for (const item of parsed.items) {
          items.push({
            id: `seed-${date}-${seq++}`,
            date,
            // Today's rows must never carry a future clock time, or `/undo`
            // would reach a seeded row instead of what was just logged.
            time: isToday ? minTime(TIMES[n % TIMES.length]!, localTime()) : TIMES[n % TIMES.length]!,
            mealTag: item.mealTag,
            name: item.name,
            grams: item.grams,
            cooked: item.cooked,
            proteinG: item.proteinG,
            carbsG: item.carbsG,
            fatG: item.fatG,
            kcal: item.kcal,
            source: 'seed',
          })
        }
      })
      addFoods(items)
      written += items.length
    }
    return written
  })()
}

export function wipeSeed(): number {
  return db.prepare("DELETE FROM foods WHERE source = 'seed'").run().changes
}

export function hasAnyFood(): boolean {
  return (db.prepare('SELECT COUNT(*) AS n FROM foods').get() as { n: number }).n > 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === '--wipe') {
    console.log(`wiped ${wipeSeed()} seed rows — real rows are untouched`)
  } else {
    console.log(`seeded ${seedSampleData()} rows`)
  }
}
