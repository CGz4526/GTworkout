import type { ExerciseRecord, SetRecord } from '../types'

export function keyboardWeightPreferred(name: string): boolean {
  if (/器械|史密斯|绳索|滑轮|龙门架|smith|machine|cable/i.test(name)) return false
  return /杠铃|哑铃|深蹲|硬拉|卧推|壶铃|自由重量|barbell|dumbbell|squat|deadlift|bench\s*press/i.test(name)
}

export function editSetWeight(exercise: ExerciseRecord, index: number, value: number | undefined): ExerciseRecord {
  if (!exercise.sets[index]) return exercise
  let previous = value
  return { ...exercise, sets: exercise.sets.map((set, i) => {
    if (i < index) return set
    if (i === index) return { ...set, weight: value }
    if (value === undefined) return set // 清空只影响当前组，不清空其他组。
    if (set.weight != null) { previous = set.weight; return set }
    return !set.completed && previous !== undefined ? { ...set, weight: previous } : set
  }) }
}

export function appendWorkoutSet(exercise: ExerciseRecord, warmup: boolean): ExerciseRecord {
  const warmups = exercise.sets.filter(set => set.warmup)
  const working = exercise.sets.filter(set => !set.warmup)
  const preceding = warmup ? warmups : [...warmups, ...working]
  const weight = preceding.slice().reverse().find(set => set.weight != null)?.weight
  const set: SetRecord = { weight, reps: preceding.at(-1)?.reps ?? 12, completed: false, ...(warmup ? { warmup: true } : {}) }
  return { ...exercise, sets: warmup ? [...warmups, set, ...working] : [...warmups, ...working, set] }
}

export function removeWorkoutSet(exercise: ExerciseRecord, index: number): ExerciseRecord {
  if (!exercise.sets[index]) return exercise
  return { ...exercise, sets: exercise.sets.filter((_, i) => i !== index) }
}
