import { db } from '../db'
import type { WorkoutTemplate } from '../types'
import { normalizeTemplate } from './template'

export const WORKOUT_PRESETS = [
  { key: 'chest', name: '胸', parts: ['胸'], names: ['杠铃卧推', '上斜卧推', '哑铃飞鸟'] },
  { key: 'shoulders', name: '肩', parts: ['肩'], names: ['哑铃推举', '哑铃侧平举', '反向飞鸟'] },
  { key: 'back', name: '背', parts: ['背'], names: ['高位下拉', '坐姿划船', '哑铃单臂划船'] },
  { key: 'arms', name: '臂', parts: ['二头', '二头', '三头'], names: ['杠铃弯举', '锤式弯举', '绳索下压'] },
  { key: 'legs', name: '腿', parts: ['腿'], names: ['深蹲', '罗马尼亚硬拉', '腿弯举'] },
  { key: 'core', name: '核心', parts: ['核心'], names: ['卷腹', '仰卧举腿', '俄罗斯转体'] },
] as const

export const presetId = (key: string) => `quick-preset-${key}`

// 只在用户显式开始/编辑预设时调用；读取首页绝不写库。
export async function materializePreset(key: string): Promise<WorkoutTemplate> {
  const definition = WORKOUT_PRESETS.find(p => p.key === key)
  if (!definition) throw new Error('预设不存在')
  return db.transaction('rw', db.templates, db.exercises, async () => {
    const existing = await db.templates.get(presetId(key))
    if (existing) return normalizeTemplate(existing)
    const exercises = await db.exercises.toArray()
    const items = []
    for (const [index, name] of definition.names.entries()) {
      const bodyPart = definition.parts[index] ?? definition.parts[0]
      let exercise = exercises.find(e => e.name === name && e.bodyPart === bodyPart)
      if (!exercise) {
        exercise = { id: crypto.randomUUID(), name, bodyPart, createdAt: Date.now() }
        await db.exercises.add(exercise)
        exercises.push(exercise)
      }
      items.push({ exerciseId: exercise.id, exerciseName: exercise.name, defaultSets: 1, defaultReps: 10 })
    }
    const template = { id: presetId(key), name: `${definition.name}部训练`, items }
    await db.templates.add(template)
    return template
  })
}
