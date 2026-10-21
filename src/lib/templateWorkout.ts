import { db } from '../db'
import type { Exercise, ExerciseRecord, TemplateItem } from '../types'
import { normalizeTemplate, sanitizeItem } from './template'
import { resolveRestSeconds } from './rest'

export function warmupCount(value: unknown): number {
  if (value === undefined) return 1
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(10, Math.round(value))) : 0
}

export async function ensureTemplateExercise(name: string, bodyPart: string): Promise<string> {
  return db.transaction('rw', db.exercises, async () => {
    const existing = await db.exercises.filter(e => e.name === name && e.bodyPart === bodyPart).first()
    if (existing) return existing.id
    const id = crypto.randomUUID()
    await db.exercises.add({ id, name, bodyPart, createdAt: Date.now() })
    return id
  })
}

export function recordsFromTemplate(items: unknown, definitions?: Exercise[]): ExerciseRecord[] {
  if (!Array.isArray(items)) return []
  return items.filter((i): i is TemplateItem => !!i && typeof i === 'object' && !Array.isArray(i)).map(raw => {
    const item = sanitizeItem(raw)
    const warmups = warmupCount(item.warmupSets)
    return {
      exerciseId: item.exerciseId, exerciseName: item.exerciseName,
      // 自由训练初始化时动作库可能尚未返回，不把临时缺省值固化为休息快照。
      ...(definitions !== undefined || item.restSeconds !== undefined
        ? { restSeconds: resolveRestSeconds(item, definitions?.find(e => e.id === item.exerciseId)) } : {}),
      sets: Array.from({ length: warmups + item.defaultSets }, (_, index) => ({
        weight: undefined, reps: item.defaultReps, completed: false, ...(index < warmups ? { warmup: true } : {}),
      })),
    }
  })
}

// 显式配置编辑，不自动迁移；不访问sessions，保留模板及动作的其他字段。
export async function resetTemplateSetCounts(): Promise<number> {
  return db.transaction('rw', db.templates, async () => {
    return db.templates.toCollection().modify(template => {
      template.items = normalizeTemplate(template).items.map(item => ({ ...item, defaultSets: 1 }))
    })
  })
}

export async function startTemplateSession(templateId: string, items: TemplateItem[]): Promise<string> {
  return db.transaction('rw', db.templates, db.sessions, db.exercises, async () => {
    const existing = await db.sessions.filter(s => !s.finished).first()
    if (existing) return existing.id
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板已不存在，请返回重新选择。')
    if (!items.length) throw new Error('请先添加至少一个动作。')
    const normalized = normalizeTemplate({ ...template, items })
    const definitions = await db.exercises.toArray()
    const id = crypto.randomUUID()
    await db.templates.update(templateId, { items: normalized.items })
    await db.sessions.add({ id, templateId, templateName: template.name, date: new Date().toISOString(),
      duration: 0, exercises: recordsFromTemplate(normalized.items, definitions), finished: false, startTime: Date.now() })
    return id
  })
}
