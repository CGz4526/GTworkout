// 训练记录的写入门槛。

import type { ExerciseRecord, SetRecord, WorkoutSession } from '../types'
import { clampRpe } from './set'

// 少于 1 分钟的训练视为误触或试手，不写入记录。
export const MIN_SESSION_SECONDS = 60

/**
 * 是否短到不该留记录。
 *
 * duration 为 0 表示「时长未知」——手动补录时用户可能根本不记得练了多久，
 * 这种记录是合法的，不能拿 0 去和门槛比。
 * 只有「明确记录了时长、但不足 1 分钟」才拦。
 *
 * `opts.aerobic` 为 true 时豁免：有氧练几十秒是正常的（爬几趟楼梯就下楼了），
 * 而且用户常常先建一条短记录、之后再回详情页把时长改成实际值——被门槛拦掉就
 * 永远建不出来。有氧的误触成本也低，它不参与容量统计。
 */
export const isTooShortToRecord = (seconds: number, opts?: { aerobic?: boolean }) =>
  !opts?.aerobic && Number.isFinite(seconds) && seconds > 0 && seconds < MIN_SESSION_SECONDS

/**
 * 是不是一个「像记录」的对象。
 *
 * 三个表都是 `keyPath: 'id'`，所以 null / 数字 / 字符串这类元素连 put 都过不了
 * （`DataError: key path did not yield a value`），导入走 bulkAdd 同理会让整个
 * 事务回滚。但**嵌套数组**没有这层保护：`{ id, exercises: [null] }` 是存得进去的。
 */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 把从库里读出来的记录补成「字段一定存在」的形状。
 *
 * `Settings` 的备份导入是 `JSON.parse` + `bulkAdd`，对内容零校验，所以库里
 * 完全可能出现缺字段、甚至嵌套数组里混着 null 的记录（手改过的备份、别的版本
 * 导出的文件）。而 `s.exercises.reduce(...)` / `for (const ex of s.exercises)` /
 * `ex.sets.filter(...)` 散落在 Home、History、Stats、SessionDetail、ActiveWorkout
 * 五处——任意一处读到 undefined / null 都会抛 TypeError，React 整棵树挂掉，
 * 页面直接空白。
 *
 * 所以兜底放在**读取边界**上，而不是逐个消费点写 `?? []`：新增读取字段时不会再漏。
 * 只夹写入侧是不够的——库里已有的坏数据照样能炸。
 *
 * 处理四件事：缺 `exercises` → `[]`；`exercises` 里的非对象元素丢掉；
 * `sets` 缺 → `[]`、里面的非对象元素丢掉；`rpe` / `warmup` 越界值夹回来。
 * 没有实际改动时返回**原对象**，避免下游 useMemo / useLiveQuery 白重渲染。
 */
export function normalizeSession(s: WorkoutSession): WorkoutSession {
  const rawEx: unknown[] = Array.isArray(s.exercises) ? s.exercises : []
  // every() 为真时直接复用原数组，保持引用不变
  const exercises = (rawEx.every(isRecord) ? rawEx : rawEx.filter(isRecord)) as unknown as ExerciseRecord[]
  let changed = exercises !== s.exercises

  const fixed = exercises.map((ex) => {
    const rawSets: unknown[] = Array.isArray(ex.sets) ? ex.sets : []
    const sets = (rawSets.every(isRecord) ? rawSets : rawSets.filter(isRecord)) as unknown as SetRecord[]

    // rpe / warmup 是新增字段：旧记录和手改过的备份里可能是任意值。
    // 只在真的越界时才换对象——绝大多数记录走的是下面这个 untouched 分支，
    // 保持引用不变，下游的 useMemo 缓存才不会失效。
    let setsChanged = sets !== ex.sets
    const cleanedSets = sets.map((st) => {
      const fixedRpe = clampRpe(st.rpe)
      if (fixedRpe === st.rpe && (st.warmup === undefined || typeof st.warmup === 'boolean')) return st
      setsChanged = true
      return { ...st, rpe: fixedRpe }
    })
    if (!setsChanged) return ex
    changed = true
    return { ...ex, sets: cleanedSets }
  })

  return changed ? { ...s, exercises: fixed } : s
}

