import { toLocalDateKey } from './date'
import type { WorkoutSession } from '../types'

export type FrequencyWeek = {
  label: string; from: string; to: string; current: boolean
  strengthOnly: number; aerobicOnly: number; both: number; total: number
  strengthDays: number; aerobicDays: number
}

/** 六个自然周；按本地日去重。本周仅截至当前时刻，不将重复训练当成额外训练日。 */
export function trainingFrequency(sessions: WorkoutSession[], now: Date) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  const today = toLocalDateKey(now)
  const days = new Map<string, { strength: boolean; aerobic: boolean }>()
  for (const session of sessions) {
    const date = new Date(session.date)
    if (!session.finished || !Number.isFinite(date.getTime()) || date > now) continue
    const aerobic = session.aerobic === true
    const strength = !aerobic && (session.exercises.length > 0 || !!session.startTime)
    if (!strength && !aerobic) continue
    const key = toLocalDateKey(date)
    const day = days.get(key) ?? { strength: false, aerobic: false }
    day.strength ||= strength
    day.aerobic ||= aerobic
    days.set(key, day)
  }
  const weeks: FrequencyWeek[] = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(monday)
    start.setDate(start.getDate() - (5 - i) * 7)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const current = i === 5
    const from = toLocalDateKey(start)
    const to = current ? today : toLocalDateKey(end)
    let strengthOnly = 0, aerobicOnly = 0, both = 0
    for (const [key, day] of days) {
      if (key < from || key > to) continue
      if (day.strength && day.aerobic) both++
      else if (day.strength) strengthOnly++
      else aerobicOnly++
    }
    return { label: current ? '本周' : `${start.getMonth() + 1}/${start.getDate()}`, from, to, current,
      strengthOnly, aerobicOnly, both, total: strengthOnly + aerobicOnly + both,
      strengthDays: strengthOnly + both, aerobicDays: aerobicOnly + both }
  })
  const firstRecorded = [...days.keys()].sort()[0]
  const complete = firstRecorded ? weeks.slice(0, 5).filter(week => week.to >= firstRecorded) : []
  return { weeks, current: weeks[5], average: complete.length ? complete.reduce((n, week) => n + week.total, 0) / complete.length : null,
    completedWeeks: complete.length,
    elapsedDays: (now.getDay() + 6) % 7 + 1 }
}
