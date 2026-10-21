import type { TemplateItem, WorkoutTemplate } from '../types'
import { clampRestSeconds } from './rest'

// 组数 / 次数的合法区间。

export const MIN_ITEM_COUNT = 1
export const MAX_SETS = 20
export const MAX_REPS = 100

export type CountField = 'defaultSets' | 'defaultReps'

const UPPER_BOUND: Record<CountField, number> = {
  defaultSets: MAX_SETS,
  defaultReps: MAX_REPS,
}

/**
 * 把组数 / 次数夹进合法区间。
 *
 * 上限不是洁癖。`ActiveWorkout` 会拿 `defaultSets` 去 `Array.from({ length })`
 * 铺出等量的组并全部渲染，而组数有两个不受源码控制的来源：
 *   1. `Settings.tsx` 的备份导入——`JSON.parse` 之后直接 `bulkAdd`，没有任何校验；
 *   2. `sessionStorage` 里的 preset JSON。
 * 只要其中一个带来 `defaultSets: 100000`，开始训练就会当场把页面卡死。
 * 所以在「写入」（步进器）和「消费」（ActiveWorkout）两侧都要夹。
 *
 * 非有限数（NaN / Infinity / undefined 转出来的）一律退回下限，不抛错——
 * 这里的目标是让 UI 活下来，不是报错。
 */
export function clampItemCount(field: CountField, value: number): number {
  if (!Number.isFinite(value)) return MIN_ITEM_COUNT
  return Math.min(UPPER_BOUND[field], Math.max(MIN_ITEM_COUNT, Math.round(value)))
}

/** 步进器：在 value 基础上加减 delta 后夹住。 */
export function stepItemCount(field: CountField, value: number, delta: number): number {
  return clampItemCount(field, value + delta)
}

/** 是不是一个「像条目」的对象。嵌套数组没有 keyPath 那层保护，什么都能塞进来。 */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 把整条动作的 sets / reps / 组间歇都夹一遍。用于消费外部来源的数据。 */
export function sanitizeItem(item: TemplateItem): TemplateItem {
  const sets = clampItemCount('defaultSets', item.defaultSets)
  const reps = clampItemCount('defaultReps', item.defaultReps)
  // 组间歇只在「填了」的时候夹。undefined 表示「回落到动作库的值」，
  // 不能在这里写成默认值——那会让用户永远看不到「跟随动作库」这个语义。
  const rest =
    item.restSeconds === undefined ? undefined : clampRestSeconds(item.restSeconds)
  // 没改动就返回原对象，让上层能靠引用判断「这条不需要重建」
  if (sets === item.defaultSets && reps === item.defaultReps && rest === item.restSeconds) return item
  return { ...item, defaultSets: sets, defaultReps: reps, restSeconds: rest }
}

/**
 * 把从库里读出来的模板补成「字段一定存在」的形状。
 *
 * 与 `normalizeSession` 同一个理由：备份导入零校验。缺 `items` 会让
 * `for (const item of t.items)`（`Templates.getDominantBodyPart`）抛
 * `TypeError: t.items is not iterable`；`items` 里混进 null 会让
 * `i.defaultSets` / `item.exerciseName` 抛 `Cannot read properties of null`。
 * 两种情况都会让 Home 与 Templates **整页白屏**。
 *
 * 顺手把组数/次数夹一遍，这样渲染层永远不会出现「undefined×undefined」。
 * 没改动时返回**原对象**。
 */
export function normalizeTemplate(t: WorkoutTemplate): WorkoutTemplate {
  const prev = Array.isArray(t.items) ? t.items : []
  const raw: unknown[] = prev
  const items = (raw.every(isRecord) ? raw : raw.filter(isRecord)) as unknown as TemplateItem[]
  const sanitized = items.map(sanitizeItem)
  const untouched =
    Array.isArray(t.items) &&
    sanitized.length === prev.length &&
    sanitized.every((it, i) => it === prev[i])
  return untouched ? t : { ...t, items: sanitized }
}
