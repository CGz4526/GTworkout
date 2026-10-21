// 「某一天的体重」的唯一写入入口。
//
// 体重的真实存储是 weights 表（按本地日期一天一条），session.weight 只是在
// 训练详情页与旧数据之间保留的冗余字段。这里保证两边同步，读的那一侧
// （History / Stats / SessionDetail 回填）才不会有「两个页面两个数」的问题。
//
// 传 undefined = 清掉那天的体重记录（用户在详情页把体重输入框清空并保存时）。
import type { BodyWeight } from '../types'
import { db } from '../db'
import { localDateKeyOf } from './date'

export async function setDayWeight(dateIso: string, kg: number | undefined): Promise<void> {
  const key = localDateKeyOf(dateIso)
  if (!key) return
  if (kg === undefined) {
    await db.weights.delete(key)
    return
  }
  const row: BodyWeight = { date: key, weight: kg, updatedAt: Date.now() }
  await db.weights.put(row)
}

/** 读某一天的体重。没有记录返回 undefined。 */
export async function getDayWeight(dateIso: string): Promise<number | undefined> {
  const key = localDateKeyOf(dateIso)
  if (!key) return undefined
  const row = await db.weights.get(key)
  return row?.weight
}
