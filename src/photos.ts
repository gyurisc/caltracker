/**
 * Keeping the photo that produced a log line.
 *
 * The numbers in this app are mostly estimates, and an estimate you cannot
 * re-examine is a number you have to take on faith. The photo is the evidence:
 * six weeks later it is the only way to tell whether "sauce 80 g" was a spoonful
 * or a ladle. So a photo that produces rows is kept, and the rows point at it.
 *
 * Two sizes are written. The dashboard lists many days at once and wants
 * something small; looking closely at one meal wants the full frame. Storing
 * both costs little and means the list never pulls a megabyte per row.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { fromRoot } from './config.ts'

/** Small enough that a month of meals is a few megabytes. */
export const THUMB_EDGE_PX = 320

export const PHOTO_ROOT = fromRoot('data/photos')

/** `2026/09/ab12….jpg` — dated folders so a year's photos stay browsable by hand. */
function pathFor(id: string, size: 'full' | 'thumb'): string {
  const [year, month] = [id.slice(0, 4), id.slice(5, 7)]
  return join(PHOTO_ROOT, year, month, `${id}${size === 'thumb' ? '.thumb' : ''}.jpg`)
}

/**
 * The id carries its own date, so a row's photo can be located from the id
 * alone — no lookup table, and no orphan hunt if the database is rebuilt.
 */
export function photoId(date: string, bytes: Buffer): string {
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  return `${date}-${digest}`
}

/** Writes both sizes and returns the id. Idempotent: the same image reuses it. */
export async function savePhoto(date: string, jpeg: Buffer): Promise<string> {
  const id = photoId(date, jpeg)
  const full = pathFor(id, 'full')
  if (existsSync(full)) return id

  mkdirSync(dirname(full), { recursive: true })
  const thumb = await sharp(jpeg)
    .resize({ width: THUMB_EDGE_PX, height: THUMB_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer()

  await Promise.all([writeFile(full, jpeg), writeFile(pathFor(id, 'thumb'), thumb)])
  return id
}

/**
 * An id comes off a URL, so it is untrusted. Only the exact shape written above
 * is accepted — no separators, no dots, nothing that could climb out of the
 * photo directory.
 */
const ID_SHAPE = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{16}$/

export function readPhoto(id: string, size: 'full' | 'thumb' = 'full'): Buffer | null {
  if (!ID_SHAPE.test(id)) return null
  const path = pathFor(id, size)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function photoExists(id: string): boolean {
  return ID_SHAPE.test(id) && existsSync(pathFor(id, 'full'))
}

/** Deleting a log row should not leave its photo behind. */
export function deletePhoto(id: string): void {
  if (!ID_SHAPE.test(id)) return
  for (const size of ['full', 'thumb'] as const) {
    const path = pathFor(id, size)
    if (existsSync(path)) unlinkSync(path)
  }
}

export function photoBytes(id: string): number {
  if (!ID_SHAPE.test(id)) return 0
  const path = pathFor(id, 'full')
  return existsSync(path) ? statSync(path).size : 0
}
