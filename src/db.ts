import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DB_PATH, lastDays, localDate, localStamp, weekdayOf } from './config.ts'
import { SEED_FOODS, type FoodEntry } from './foods.ts'
import {
  type Activity, type Settings, DEFAULT_SETTINGS, defaultActivityFor,
} from './nutrition.ts'

mkdirSync(dirname(DB_PATH), { recursive: true })

/** One connection for the whole process (PRD §8). */
export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS days (
    date            TEXT PRIMARY KEY,
    activity        TEXT NOT NULL CHECK (activity IN ('rest','lifting','cycling')),
    weight_kg       REAL,
    workout_name    TEXT,
    workout_minutes INTEGER,
    workout_kcal    INTEGER
  );

  CREATE TABLE IF NOT EXISTS foods (
    id         TEXT PRIMARY KEY,
    date       TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE,
    time       TEXT NOT NULL,
    meal_tag   TEXT CHECK (meal_tag IN ('breakfast','lunch','snack','dinner')),
    name       TEXT NOT NULL,
    grams      REAL,
    cooked     INTEGER CHECK (cooked IN (0,1)),
    protein_g  REAL NOT NULL DEFAULT 0,
    carbs_g    REAL NOT NULL DEFAULT 0,
    fat_g      REAL NOT NULL DEFAULT 0,
    kcal       INTEGER NOT NULL DEFAULT 0,
    source     TEXT NOT NULL CHECK (source IN ('text','photo','seed')),
    photo_path TEXT
  );

  CREATE INDEX IF NOT EXISTS foods_date_idx ON foods(date, time);

  CREATE TABLE IF NOT EXISTS events (
    id      TEXT PRIMARY KEY,
    ts      TEXT NOT NULL,
    kind    TEXT NOT NULL CHECK (kind IN ('log','undo','weight','activity','error')),
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vocab (
    key           TEXT PRIMARY KEY,
    aliases       TEXT NOT NULL,
    basis         TEXT NOT NULL CHECK (basis IN ('per100g','each')),
    unit_grams    REAL,
    unit_noun     TEXT,
    default_grams REAL,
    portions      TEXT,
    default_state TEXT NOT NULL CHECK (default_state IN ('raw','cooked')),
    provenance    TEXT NOT NULL DEFAULT 'reference'
                    CHECK (provenance IN ('measured','reference')),
    raw           TEXT,
    cooked        TEXT,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

/**
 * Additive migrations. `CREATE TABLE IF NOT EXISTS` leaves an existing table alone,
 * so a new column has to be added explicitly. Safe to run on every boot.
 */
const columns = (table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

if (!columns('foods').includes('provenance')) {
  db.exec("ALTER TABLE foods ADD COLUMN provenance TEXT NOT NULL DEFAULT 'reference'")
}

export type DayRow = {
  date: string
  activity: Activity
  weight_kg: number | null
  workout_name: string | null
  workout_minutes: number | null
  workout_kcal: number | null
}

export type FoodRow = {
  id: string
  date: string
  time: string
  meal_tag: string | null
  name: string
  grams: number | null
  cooked: number | null
  protein_g: number
  carbs_g: number
  fat_g: number
  kcal: number
  source: 'text' | 'photo' | 'seed'
  provenance: 'measured' | 'reference'
  photo_path: string | null
}

// ---------------------------------------------------------------- settings

export function getSettings(): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  return {
    proteinGoal: stored.proteinGoal ?? DEFAULT_SETTINGS.proteinGoal,
    deficit: stored.deficit ?? DEFAULT_SETTINGS.deficit,
    maintenance: { ...DEFAULT_SETTINGS.maintenance, ...(stored.maintenance ?? {}) },
  }
}

const putSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  db.transaction(() => {
    putSetting.run('proteinGoal', JSON.stringify(next.proteinGoal))
    putSetting.run('deficit', JSON.stringify(next.deficit))
    putSetting.run('maintenance', JSON.stringify(next.maintenance))
  })()
  return next
}

/** Small persistent flags (e.g. "this database has been seeded once"). */
export function getFlag(key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`flag:${key}`) as { value: string } | undefined
  return row ? JSON.parse(row.value) : undefined
}

export function setFlag(key: string, value: unknown): void {
  putSetting.run(`flag:${key}`, JSON.stringify(value))
}

// -------------------------------------------------------------------- days

/** Every food write goes through this first, so the FK on foods.date always holds. */
export function ensureDay(date: string): DayRow {
  const existing = db.prepare('SELECT * FROM days WHERE date = ?').get(date) as DayRow | undefined
  if (existing) return existing
  db.prepare('INSERT INTO days (date, activity) VALUES (?, ?)')
    .run(date, defaultActivityFor(weekdayOf(date)))
  return db.prepare('SELECT * FROM days WHERE date = ?').get(date) as DayRow
}

export function setActivity(date: string, activity: Activity): DayRow {
  ensureDay(date)
  db.prepare('UPDATE days SET activity = ? WHERE date = ?').run(activity, date)
  logEvent('activity', { date, activity })
  return db.prepare('SELECT * FROM days WHERE date = ?').get(date) as DayRow
}

export function setWeight(date: string, kg: number): DayRow {
  ensureDay(date)
  db.prepare('UPDATE days SET weight_kg = ? WHERE date = ?').run(kg, date)
  logEvent('weight', { date, kg })
  return db.prepare('SELECT * FROM days WHERE date = ?').get(date) as DayRow
}

export function getDay(date: string): DayRow {
  return ensureDay(date)
}

export function getWeights(dates: string[]): Record<string, number | null> {
  if (dates.length === 0) return {}
  const q = dates.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT date, weight_kg FROM days WHERE date IN (${q})`)
    .all(...dates) as { date: string; weight_kg: number | null }[]
  return Object.fromEntries(rows.map((r) => [r.date, r.weight_kg]))
}

// ------------------------------------------------------------------- foods

export type NewFood = {
  id?: string
  date?: string
  time?: string
  mealTag?: string | null
  name: string
  grams?: number | null
  cooked?: boolean | null
  proteinG: number
  carbsG: number
  fatG: number
  kcal: number
  source: 'text' | 'photo' | 'seed'
  provenance?: 'measured' | 'reference'
  photoPath?: string | null
}

const insertFood = db.prepare(`
  INSERT INTO foods (id, date, time, meal_tag, name, grams, cooked,
                     protein_g, carbs_g, fat_g, kcal, source, provenance, photo_path)
  VALUES (@id, @date, @time, @meal_tag, @name, @grams, @cooked,
          @protein_g, @carbs_g, @fat_g, @kcal, @source, @provenance, @photo_path)
`)

/** Writes all items in one transaction — never while waiting on an API (PRD §8). */
export const addFoods = db.transaction((items: NewFood[]): FoodRow[] => {
  const written: FoodRow[] = []
  for (const item of items) {
    const date = item.date ?? localDate()
    ensureDay(date)
    const id = item.id ?? crypto.randomUUID()
    insertFood.run({
      id,
      date,
      time: item.time ?? localStamp().slice(11),
      meal_tag: item.mealTag ?? null,
      name: item.name,
      grams: item.grams ?? null,
      cooked: item.cooked == null ? null : item.cooked ? 1 : 0,
      protein_g: item.proteinG,
      carbs_g: item.carbsG,
      fat_g: item.fatG,
      kcal: item.kcal,
      source: item.source,
      provenance: item.provenance ?? 'reference',
      photo_path: item.photoPath ?? null,
    })
    written.push(db.prepare('SELECT * FROM foods WHERE id = ?').get(id) as FoodRow)
  }
  return written
})

export function foodsOn(date: string): FoodRow[] {
  return db.prepare('SELECT * FROM foods WHERE date = ? ORDER BY time, rowid').all(date) as FoodRow[]
}

/** Most recent row overall, not "last row of today" — so a 00:15 undo reaches the 23:50 meal. */
export function mostRecentFood(): FoodRow | undefined {
  return db
    .prepare('SELECT * FROM foods ORDER BY date DESC, time DESC, rowid DESC LIMIT 1')
    .get() as FoodRow | undefined
}

export function deleteFood(id: string): FoodRow | undefined {
  const row = db.prepare('SELECT * FROM foods WHERE id = ?').get(id) as FoodRow | undefined
  if (!row) return undefined
  db.prepare('DELETE FROM foods WHERE id = ?').run(id)
  logEvent('undo', { id, name: row.name, kcal: row.kcal, date: row.date })
  return row
}

export type DayTotals = { kcal: number; proteinG: number; carbsG: number; fatG: number; items: number }

export function totalsFor(dates: string[]): Record<string, DayTotals> {
  const out: Record<string, DayTotals> = {}
  for (const d of dates) out[d] = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, items: 0 }
  if (dates.length === 0) return out
  const q = dates.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT date,
           COALESCE(SUM(kcal), 0)      AS kcal,
           COALESCE(SUM(protein_g), 0) AS protein_g,
           COALESCE(SUM(carbs_g), 0)   AS carbs_g,
           COALESCE(SUM(fat_g), 0)     AS fat_g,
           COUNT(*)                    AS items
    FROM foods WHERE date IN (${q}) GROUP BY date
  `).all(...dates) as { date: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; items: number }[]
  for (const r of rows) {
    out[r.date] = {
      kcal: Math.round(r.kcal),
      proteinG: Math.round(r.protein_g * 10) / 10,
      carbsG: Math.round(r.carbs_g * 10) / 10,
      fatG: Math.round(r.fat_g * 10) / 10,
      items: r.items,
    }
  }
  return out
}

// ------------------------------------------------------------------- vocab

type VocabRow = {
  key: string; aliases: string; basis: string; unit_grams: number | null
  unit_noun: string | null; default_grams: number | null; portions: string | null
  default_state: string; provenance: string; raw: string | null; cooked: string | null
}

const toEntry = (r: VocabRow): FoodEntry => ({
  key: r.key,
  aliases: JSON.parse(r.aliases) as string[],
  basis: r.basis as FoodEntry['basis'],
  ...(r.unit_grams == null ? {} : { unitGrams: r.unit_grams }),
  ...(r.unit_noun == null ? {} : { unitNoun: r.unit_noun }),
  ...(r.default_grams == null ? {} : { defaultGrams: r.default_grams }),
  ...(r.portions == null ? {} : { portions: JSON.parse(r.portions) as Record<string, number> }),
  defaultState: r.default_state as FoodEntry['defaultState'],
  provenance: r.provenance as FoodEntry['provenance'],
  ...(r.raw == null ? {} : { raw: JSON.parse(r.raw) as FoodEntry['raw'] }),
  ...(r.cooked == null ? {} : { cooked: JSON.parse(r.cooked) as FoodEntry['cooked'] }),
})

export function allVocab(): FoodEntry[] {
  return (db.prepare('SELECT * FROM vocab ORDER BY key').all() as VocabRow[]).map(toEntry)
}

const upsertVocabRow = db.prepare(`
  INSERT INTO vocab (key, aliases, basis, unit_grams, unit_noun, default_grams,
                     portions, default_state, provenance, raw, cooked, updated_at)
  VALUES (@key, @aliases, @basis, @unit_grams, @unit_noun, @default_grams,
          @portions, @default_state, @provenance, @raw, @cooked, @updated_at)
  ON CONFLICT(key) DO UPDATE SET
    aliases = excluded.aliases, basis = excluded.basis, unit_grams = excluded.unit_grams,
    unit_noun = excluded.unit_noun, default_grams = excluded.default_grams,
    portions = excluded.portions, default_state = excluded.default_state,
    provenance = excluded.provenance, raw = excluded.raw, cooked = excluded.cooked,
    updated_at = excluded.updated_at
`)

export function upsertVocab(entry: FoodEntry): void {
  upsertVocabRow.run({
    key: entry.key,
    aliases: JSON.stringify(entry.aliases),
    basis: entry.basis,
    unit_grams: entry.unitGrams ?? null,
    unit_noun: entry.unitNoun ?? null,
    default_grams: entry.defaultGrams ?? null,
    portions: entry.portions ? JSON.stringify(entry.portions) : null,
    default_state: entry.defaultState,
    provenance: entry.provenance ?? 'reference',
    raw: entry.raw ? JSON.stringify(entry.raw) : null,
    cooked: entry.cooked ? JSON.stringify(entry.cooked) : null,
    updated_at: localStamp(),
  })
}

/**
 * Flag-gated, exactly like the sample data: a row-count check would repopulate
 * the seed vocabulary after someone deliberately removed a row.
 */
export const seedVocab = db.transaction((): number => {
  if (getFlag('vocab_seeded') === true) return 0
  for (const entry of SEED_FOODS) upsertVocab(entry)
  setFlag('vocab_seeded', true)
  return SEED_FOODS.length
})

// ------------------------------------------------------------------ events

export type Miss = { phrase: string; count: number; lastSeen: string; lastText: string }

/**
 * Refused phrases from `parse_miss` events, most frequent first — the vocabulary
 * backlog. Grouped on the unmatched phrase, not the whole message, so
 * `2 eggs and pad thai` and `pad thai` count as the same missing food.
 */
export function recentMisses(days = 30): Miss[] {
  const since = lastDays(days)[0]!
  const rows = db
    .prepare("SELECT ts, payload FROM events WHERE kind = 'error' AND ts >= ? ORDER BY ts")
    .all(since) as { ts: string; payload: string }[]

  const byPhrase = new Map<string, Miss>()
  for (const row of rows) {
    const p = JSON.parse(row.payload) as { kind?: string; text?: string; unmatched?: string[] }
    if (p.kind !== 'parse_miss') continue
    for (const phrase of p.unmatched ?? []) {
      const hit = byPhrase.get(phrase)
      if (hit) {
        hit.count += 1
        hit.lastSeen = row.ts
        hit.lastText = p.text ?? phrase
      } else {
        byPhrase.set(phrase, { phrase, count: 1, lastSeen: row.ts, lastText: p.text ?? phrase })
      }
    }
  }
  return [...byPhrase.values()].sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
}

export function logEvent(kind: 'log' | 'undo' | 'weight' | 'activity' | 'error', payload: unknown): void {
  db.prepare('INSERT INTO events (id, ts, kind, payload) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), localStamp(), kind, JSON.stringify(payload))
}
