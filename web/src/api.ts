export type Activity = 'rest' | 'lifting' | 'cycling'

export type FoodRow = {
  id: string
  date: string
  time: string
  meal_tag: string | null
  name: string
  grams: number | null
  cooked: number | null
  protein_g: number
  kcal: number
  source: string
  provenance: 'measured' | 'reference'
}

export type WeekDay = {
  date: string
  activity: Activity
  maintenance: number
  targetKcal: number
  kcal: number
  proteinG: number
  items: number
}

export type TrendDay = {
  date: string
  activity: Activity
  weightKg: number | null
  steps: number | null
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  items: number
  maintenance: number
  targetKcal: number
}

export type State = {
  today: {
    date: string
    activity: Activity
    activityLabel: string
    weightKg: number | null
    maintenance: number
    targetKcal: number
  }
  settings: { proteinGoal: number; deficit: number; maintenance: Record<Activity, number> }
  totals: { kcal: number; proteinG: number; items: number }
  items: FoodRow[]
  week: WeekDay[]
  trend: TrendDay[]
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), body)
  return body as T
}

export const getState = () => send<State>('/state')
