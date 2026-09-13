/**
 * PRD §7.3. A photo goes to Grok; what comes back is a proposal, never a log.
 *
 * Two shapes come off a camera in practice: a nutrition label (printed numbers,
 * high confidence) and a plate (portions, a guess). The model says which, and
 * the two are handled differently — a label becomes a `/food` row, a plate
 * becomes log lines resolved against the vocabulary that already exists.
 *
 * kcal is never taken from the model. It is recomputed from the macros, and a
 * figure that disagrees is logged as an error rather than trusted (§7.2).
 */
import sharp from 'sharp'
import { XAI_API_KEY } from './config.ts'
import { deriveKcal, kcalDisagrees } from './nutrition.ts'

export const MODEL = 'grok-4.5'
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
export const MAX_PAYLOAD_BYTES = 1_500_000
export const MAX_EDGE_PX = 1280

export type VisionItem = {
  name: string
  grams: number | null
  cooked: boolean | null
  proteinG: number
  carbsG: number
  fatG: number
  /** Recomputed here; the model's own figure is only a cross-check. */
  kcal: number
  /** True when the model's kcal disagreed with 4/4/9 by more than the tolerance. */
  kcalDisputed: boolean
}

export type VisionLabel = {
  kind: 'label'
  name: string
  basis: 'per100g' | 'each'
  unitGrams: number | null
  proteinG: number
  carbsG: number
  fatG: number
  fibreG: number | null
  kcal: number
  kcalDisputed: boolean
}

export type VisionResult =
  | { ok: true; read: VisionLabel }
  | { ok: true; read: { kind: 'meal'; items: VisionItem[]; note: string | null } }
  | { ok: false; error: string }

const SYSTEM = `You read food photographs for a calorie log. Return JSON only, no prose.

Decide what the photo is:

A NUTRITION LABEL (a printed table of values):
{"kind":"label","name":"<short lowercase food name>","basis":"per100g"|"each",
 "unitGrams":<grams of one unit, or null>,"proteinG":<g>,"carbsG":<g>,"fatG":<g>,
 "fibreG":<g or null>,"kcal":<the printed energy>}
- Read the numbers exactly as printed, per 100 g unless the table is per unit.
- carbohydrate as printed. Report fibre separately when the label lists it.
- Never invent a value you cannot read; use null.

A PLATE OR FOOD ITEM:
{"kind":"meal","items":[{"name":"<short lowercase name>","grams":<g or null>,
 "cooked":true|false|null,"proteinG":<g>,"carbsG":<g>,"fatG":<g>,"kcal":<kcal>}],
 "note":"<one short sentence about the biggest uncertainty, or null>"}
- Macros are for the portion shown, not per 100 g.
- Split a mixed plate into separate rows: meat, starch, vegetables, sauce, oil.
- If a kitchen scale is visible, use the weight it shows.
- Prefer cooked weight for plated food.
- Black coffee is about 2 kcal, tea 0.
- Be slightly conservative: do not undercount oil or sauce.

If the photo is not food and not a label:
{"kind":"none"}`

/** Downscale and re-encode. Neither Telegram nor a browser is trusted to size an image. */
export async function prepareImage(input: Buffer): Promise<Buffer> {
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`image is ${Math.round(input.byteLength / 1e6)} MB, over the 12 MB cap`)
  }
  const out = await sharp(input)
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()

  if (out.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error('image is still too large after resizing')
  }
  return out
}

type ChatFn = (body: unknown) => Promise<unknown>

/** Injectable so the bot tests never touch the network. */
export const callXai: ChatFn = async (body) => {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const maybeNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Parse and re-derive. Everything the model says about energy is advisory. */
export function interpret(raw: unknown): VisionResult {
  const data = raw as Record<string, unknown>
  const kind = data?.kind

  if (kind === 'none') return { ok: false, error: 'that does not look like food or a label' }

  if (kind === 'label') {
    const proteinG = num(data.proteinG)
    const carbsG = num(data.carbsG)
    const fatG = num(data.fatG)
    const derived = deriveKcal(proteinG, carbsG, fatG)
    const printed = maybeNum(data.kcal)
    return {
      ok: true,
      read: {
        kind: 'label',
        name: String(data.name ?? '').trim().toLowerCase() || 'unnamed',
        basis: data.basis === 'each' ? 'each' : 'per100g',
        unitGrams: maybeNum(data.unitGrams),
        proteinG, carbsG, fatG,
        fibreG: maybeNum(data.fibreG),
        kcal: derived,
        kcalDisputed: printed != null && kcalDisagrees(derived, printed),
      },
    }
  }

  if (kind === 'meal' && Array.isArray(data.items)) {
    const items: VisionItem[] = data.items.map((r) => {
      const row = r as Record<string, unknown>
      const proteinG = num(row.proteinG)
      const carbsG = num(row.carbsG)
      const fatG = num(row.fatG)
      const derived = deriveKcal(proteinG, carbsG, fatG)
      const claimed = maybeNum(row.kcal)
      return {
        name: String(row.name ?? '').trim().toLowerCase() || 'unnamed',
        grams: maybeNum(row.grams),
        cooked: typeof row.cooked === 'boolean' ? row.cooked : null,
        proteinG, carbsG, fatG,
        kcal: derived,
        kcalDisputed: claimed != null && kcalDisagrees(derived, claimed),
      }
    }).filter((i) => i.name !== 'unnamed')

    if (items.length === 0) return { ok: false, error: 'nothing recognisable on the plate' }
    const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null
    return { ok: true, read: { kind: 'meal', items, note } }
  }

  return { ok: false, error: 'the model returned something unreadable' }
}

/** One photo, one call. User-initiated only — never on a schedule or in a loop. */
export async function readPhoto(
  image: Buffer,
  caption: string | null = null,
  chat: ChatFn = callXai,
): Promise<VisionResult> {
  if (!XAI_API_KEY) return { ok: false, error: 'no XAI_API_KEY set — photos need one' }

  let jpeg: Buffer
  try {
    jpeg = await prepareImage(image)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const content: unknown[] = [
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
  ]
  if (caption) content.push({ type: 'text', text: `The sender added: ${caption}` })

  try {
    const res = (await chat({
      model: MODEL,
      max_tokens: 700,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content },
      ],
    })) as { choices?: { message?: { content?: string } }[] }

    const text = res?.choices?.[0]?.message?.content
    if (!text) return { ok: false, error: 'the model returned nothing' }
    return interpret(JSON.parse(text))
  } catch (e) {
    return { ok: false, error: `vision failed: ${(e as Error).message}` }
  }
}
