import type Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import type { Exercise, WorkoutTemplate } from '../types'
import type { PlanDraft } from '../api/assistant'
import { normalizeTemplate } from './template'

type PlanDatabase = Dexie & { templates: EntityTable<WorkoutTemplate, 'id'>; exercises: EntityTable<Exercise, 'id'> }

export async function applyAgentPlan(database: PlanDatabase, draft: PlanDraft): Promise<number> {
  if (draft.status !== 'CONFIRMED' || draft.version !== 2 || draft.payload.schemaVersion !== 1
    || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(draft.id)
    || !Array.isArray(draft.payload.templates) || draft.payload.templates.length < 1 || draft.payload.templates.length > 7) {
    throw new Error('计划尚未确认或格式不正确')
  }
  const templates = draft.payload.templates.map((template, index): WorkoutTemplate => {
    if (template.id !== `ai-plan-${draft.id}-${index}` || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 40
      || !Array.isArray(template.items) || template.items.length < 1 || template.items.length > 8) throw new Error('计划模板格式不正确')
    const seen = new Set<string>()
    const items = template.items.map(item => {
      if (typeof item.exerciseId !== 'string' || !item.exerciseId || seen.has(item.exerciseId) || typeof item.exerciseName !== 'string'
        || !Number.isInteger(item.defaultSets) || item.defaultSets < 1 || item.defaultSets > 6
        || !Number.isInteger(item.defaultReps) || item.defaultReps < 1 || item.defaultReps > 30
        || !Number.isInteger(item.restSeconds) || item.restSeconds! < 30 || item.restSeconds! > 300) throw new Error('计划动作格式不正确')
      seen.add(item.exerciseId)
      return { exerciseId: item.exerciseId, exerciseName: item.exerciseName, defaultSets: item.defaultSets, defaultReps: item.defaultReps, restSeconds: item.restSeconds }
    })
    return normalizeTemplate({ id: template.id, name: template.name, items })
  })
  return database.transaction('rw', database.templates, database.exercises, async () => {
    const missing: WorkoutTemplate[] = []
    for (const template of templates) if (!await database.templates.get(template.id)) missing.push(template)
    for (const template of missing) for (const item of template.items) {
      if (!await database.exercises.get(item.exerciseId)) throw new Error('当前浏览器缺少计划中的动作，请在原备份所在浏览器应用；本次没有新增模板')
    }
    for (const template of missing) await database.templates.add(template)
    return missing.length
  })
}
