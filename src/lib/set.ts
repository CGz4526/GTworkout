// 组级别的判定与统计。
//
// 「有效组」的定义集中在这里，而不是散在各页面的 filter 里：Home 的最近训练、
// Stats 的训练容量、SessionDetail 的组数、ActiveWorkout 的上次成绩都要用同一套
// 口径。各写一份的话，改一处忘一处就会出现「首页显示 5 组、统计页算 6 组」。

import { MAX_RPE, MIN_RPE, type SetRecord } from '../types'

/**
 * 是不是「计入统计的组」。
 *
 * 热身组不算。不排除的话，每次训练开头的空杆热身会把容量和组数都算得偏乐观，
 * 而且热身组往往没有重量，还会把「自重动作不计入」的过滤逻辑绕过去。
 */
export const isCountedSet = (s: SetRecord): boolean => s.completed === true && s.warmup !== true

/** 单组容量。自重动作（没填重量）返回 0，避免把容量拉低成噪声。 */
export const setVolume = (s: SetRecord): number =>
  isCountedSet(s) ? (s.weight ?? 0) * (s.reps ?? 0) : 0

/** 一段训练的总容量 = Σ(重量 × 次数)，只算有效组。 */
export const sessionVolume = (exercises: { sets: SetRecord[] }[]): number =>
  exercises.reduce((sum, ex) => sum + ex.sets.reduce((v, s) => v + setVolume(s), 0), 0)

/** 一段训练的有效组数（排除热身）。 */
export const countedSets = (exercises: { sets: SetRecord[] }[]): number =>
  exercises.reduce((sum, ex) => sum + ex.sets.filter(isCountedSet).length, 0)

/**
 * 把 RPE 夹进 [6, 10]，0.5 步进。
 *
 * 空值 / 非有限数返回 undefined（「这组没记 RPE」是合法状态，不要拿 6 去填）。
 */
export function clampRpe(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  const stepped = Math.round(n * 2) / 2
  return Math.min(MAX_RPE, Math.max(MIN_RPE, stepped))
}
