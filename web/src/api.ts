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

export type TrendDay = { date: string; weightKg: number | null; kcal: number; proteinG: number; targetKcal: number }

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
export const postLog = (text: string) => send<{ rows: FoodRow[] }>('/log', { method: 'POST', body: JSON.stringify({ text }) })
export const deleteFood = (id: string) => send(`/food/${id}`, { method: 'DELETE' })
export const postActivity = (activity: Activity) =>
  send('/day/activity', { method: 'POST', body: JSON.stringify({ activity }) })
export const postWeight = (kg: number) => send('/day/weight', { method: 'POST', body: JSON.stringify({ kg }) })
export const postSeed = () => send('/seed', { method: 'POST' })
