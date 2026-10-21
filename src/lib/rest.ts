// 组间歇的解析与夹取。
//
// 组间歇有三个来源，优先级从高到低：
//   1. 模板条目上的 restSeconds（当次覆盖——同一个动作在不同模板里可以歇不同久）
//   2. 动作库条目上的 restSeconds（该动作的默认）
//   3. DEFAULT_REST_SECONDS（两分半）
//
// 为什么必须在消费点夹：`restSeconds` 有两个不受源码控制的来源——备份导入
// （`JSON.parse` + `bulkAdd` 零校验）和手改过的模板。一个坏备份里出现
// `restSeconds: 99999` 会让休息倒计时永远不结束；`restSeconds: 0` 会让休息
// 一闪而过，等于没有休息。

import {
  DEFAULT_REST_SECONDS,
  MAX_REST_SECONDS,
  MIN_REST_SECONDS,
  type Exercise,
  type TemplateItem,
} from '../types'

export { DEFAULT_REST_SECONDS, MAX_REST_SECONDS, MIN_REST_SECONDS }

/**
 * 把组间歇夹进 [30, 600] 秒。
 *
 * 非有限数（NaN / Infinity / undefined 转出来的）一律退回默认值，不抛错——
 * 这里的目标是让训练页活下来，不是报错。
 */
export function clampRestSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_REST_SECONDS
  return Math.min(MAX_REST_SECONDS, Math.max(MIN_REST_SECONDS, Math.round(value)))
}

/** 秒 → 「2分30秒」这种人类可读形式，用于 UI 展示。undefined 显示成默认值。 */
export function formatRest(seconds: number | undefined | null): string {
  const s = clampRestSeconds(seconds)
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m === 0) return `${rest}秒`
  if (rest === 0) return `${m}分`
  return `${m}分${rest}秒`
}

/**
 * 解析某个动作在某次训练里的组间歇。
 *
 * 入参是**敌意数据**，不是内部结构：模板与动作库都可能来自备份导入。
 * 所以两处都过 clampRestSeconds，而不是只夹模板那一层。
 */
export function resolveRestSeconds(
  item?: TemplateItem | null,
  exercise?: Exercise | null,
): number {
  const fromItem = item?.restSeconds
  if (typeof fromItem === 'number' && Number.isFinite(fromItem)) {
    return clampRestSeconds(fromItem)
  }
  const fromExercise = exercise?.restSeconds
  if (typeof fromExercise === 'number' && Number.isFinite(fromExercise)) {
    return clampRestSeconds(fromExercise)
  }
  return DEFAULT_REST_SECONDS
}
