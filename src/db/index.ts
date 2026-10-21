import Dexie, { type EntityTable } from 'dexie'
import {
  DEFAULT_SETS,
  type BodyWeight,
  type Exercise,
  type WorkoutTemplate,
  type WorkoutSession,
} from '../types'
import { localDateKeyOf } from '../lib/date'

const db = new Dexie('WorkoutDB') as Dexie & {
  exercises: EntityTable<Exercise, 'id'>
  templates: EntityTable<WorkoutTemplate, 'id'>
  sessions: EntityTable<WorkoutSession, 'id'>
  weights: EntityTable<BodyWeight, 'date'>
}

const DEFAULT_EXERCISES: Exercise[] = [
  // 肩
  { id: 'ex-1', name: '绳索面拉', bodyPart: '肩', createdAt: 1 },
  { id: 'ex-2', name: '哑铃推举', bodyPart: '肩', createdAt: 2 },
  { id: 'ex-3', name: '哑铃侧平举', bodyPart: '肩', createdAt: 3 },
  { id: 'ex-4', name: '反向飞鸟', bodyPart: '肩', createdAt: 4 },
  { id: 'ex-5', name: '绳索Y举', bodyPart: '肩', createdAt: 5 },
  { id: 'ex-32', name: '杠铃推举', bodyPart: '肩', createdAt: 32 },
  { id: 'ex-33', name: '前平举', bodyPart: '肩', createdAt: 33 },
  { id: 'ex-34', name: '直立划船', bodyPart: '肩', createdAt: 34 },
  // 胸
  { id: 'ex-6', name: '杠铃卧推', bodyPart: '胸', createdAt: 6 },
  { id: 'ex-7', name: '上斜卧推', bodyPart: '胸', createdAt: 7 },
  { id: 'ex-8', name: '杠铃夹胸', bodyPart: '胸', createdAt: 8 },
  { id: 'ex-9', name: '绳索夹胸', bodyPart: '胸', createdAt: 9 },
  { id: 'ex-10', name: '双杠臂屈伸', bodyPart: '胸', createdAt: 10 },
  { id: 'ex-11', name: '哑铃飞鸟', bodyPart: '胸', createdAt: 11 },
  { id: 'ex-35', name: '下斜卧推', bodyPart: '胸', createdAt: 35 },
  { id: 'ex-36', name: '俯卧撑', bodyPart: '胸', createdAt: 36 },
  // 背
  { id: 'ex-12', name: '引体向上', bodyPart: '背', createdAt: 12 },
  { id: 'ex-13', name: '大剪刀下拉', bodyPart: '背', createdAt: 13 },
  { id: 'ex-14', name: '坐姿划船', bodyPart: '背', createdAt: 14 },
  { id: 'ex-15', name: '高位下拉', bodyPart: '背', createdAt: 15 },
  { id: 'ex-16', name: '绳索单臂下拉', bodyPart: '背', createdAt: 16 },
  { id: 'ex-37', name: '杠铃划船', bodyPart: '背', createdAt: 37 },
  { id: 'ex-38', name: '哑铃单臂划船', bodyPart: '背', createdAt: 38 },
  { id: 'ex-39', name: '硬拉架划船', bodyPart: '背', createdAt: 39 },
  // 腿
  { id: 'ex-17', name: '深蹲', bodyPart: '腿', createdAt: 17 },
  { id: 'ex-18', name: '硬拉', bodyPart: '腿', createdAt: 18 },
  { id: 'ex-19', name: '保加利亚深蹲', bodyPart: '腿', createdAt: 19 },
  { id: 'ex-20', name: '倒蹬', bodyPart: '腿', createdAt: 20 },
  { id: 'ex-21', name: '腿弯举', bodyPart: '腿', createdAt: 21 },
  { id: 'ex-22', name: '内收肌', bodyPart: '腿', createdAt: 22 },
  { id: 'ex-40', name: '腿伸展', bodyPart: '腿', createdAt: 40 },
  { id: 'ex-41', name: '罗马尼亚硬拉', bodyPart: '腿', createdAt: 41 },
  { id: 'ex-42', name: '负重箭步蹲', bodyPart: '腿', createdAt: 42 },
  // 二头
  { id: 'ex-23', name: '杠铃弯举', bodyPart: '二头', createdAt: 23 },
  { id: 'ex-24', name: '锤式弯举', bodyPart: '二头', createdAt: 24 },
  { id: 'ex-25', name: '三面弯举', bodyPart: '二头', createdAt: 25 },
  { id: 'ex-43', name: '集中弯举', bodyPart: '二头', createdAt: 43 },
  { id: 'ex-44', name: '托臂弯举', bodyPart: '二头', createdAt: 44 },
  // 三头
  { id: 'ex-26', name: '绳索下压', bodyPart: '三头', createdAt: 26 },
  { id: 'ex-27', name: '窄推', bodyPart: '三头', createdAt: 27 },
  { id: 'ex-45', name: '哑铃臂屈伸', bodyPart: '三头', createdAt: 45 },
  { id: 'ex-46', name: '杠铃臂屈伸', bodyPart: '三头', createdAt: 46 },
  // 核心
  { id: 'ex-28', name: '悬垂举腿', bodyPart: '核心', createdAt: 28 },
  { id: 'ex-29', name: '跪拜龙门架', bodyPart: '核心', createdAt: 29 },
  { id: 'ex-30', name: '卷腹', bodyPart: '核心', createdAt: 30 },
  { id: 'ex-31', name: '俄罗斯转体', bodyPart: '核心', createdAt: 31 },
  { id: 'ex-47', name: '平板支撑', bodyPart: '核心', createdAt: 47 },
  { id: 'ex-48', name: '仰卧举腿', bodyPart: '核心', createdAt: 48 },
]

const DEFAULT_TEMPLATES: WorkoutTemplate[] = [
  {
    id: 'tpl-shoulder',
    name: '肩训日',
    items: [
      { exerciseId: 'ex-1', exerciseName: '绳索面拉', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-2', exerciseName: '哑铃推举', defaultSets: DEFAULT_SETS, defaultReps: 10 },
      { exerciseId: 'ex-3', exerciseName: '哑铃侧平举', defaultSets: DEFAULT_SETS, defaultReps: 15 },
      { exerciseId: 'ex-4', exerciseName: '反向飞鸟', defaultSets: DEFAULT_SETS, defaultReps: 15 },
      { exerciseId: 'ex-5', exerciseName: '绳索Y举', defaultSets: DEFAULT_SETS, defaultReps: 12 },
    ],
  },
  {
    id: 'tpl-chest',
    name: '胸训日',
    items: [
      { exerciseId: 'ex-6', exerciseName: '杠铃卧推', defaultSets: DEFAULT_SETS, defaultReps: 10 },
      { exerciseId: 'ex-7', exerciseName: '上斜卧推', defaultSets: DEFAULT_SETS, defaultReps: 10 },
      { exerciseId: 'ex-8', exerciseName: '杠铃夹胸', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-9', exerciseName: '绳索夹胸', defaultSets: DEFAULT_SETS, defaultReps: 15 },
      { exerciseId: 'ex-10', exerciseName: '双杠臂屈伸', defaultSets: DEFAULT_SETS, defaultReps: 10 },
      { exerciseId: 'ex-11', exerciseName: '哑铃飞鸟', defaultSets: DEFAULT_SETS, defaultReps: 12 },
    ],
  },
  {
    id: 'tpl-back',
    name: '背训日',
    items: [
      { exerciseId: 'ex-12', exerciseName: '引体向上', defaultSets: DEFAULT_SETS, defaultReps: 8 },
      { exerciseId: 'ex-13', exerciseName: '大剪刀下拉', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-14', exerciseName: '坐姿划船', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-15', exerciseName: '高位下拉', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-16', exerciseName: '绳索单臂下拉', defaultSets: DEFAULT_SETS, defaultReps: 12 },
    ],
  },
  {
    id: 'tpl-leg',
    name: '腿训日',
    items: [
      { exerciseId: 'ex-17', exerciseName: '深蹲', defaultSets: DEFAULT_SETS, defaultReps: 10 },
      { exerciseId: 'ex-18', exerciseName: '硬拉', defaultSets: DEFAULT_SETS, defaultReps: 8 },
      { exerciseId: 'ex-19', exerciseName: '保加利亚深蹲', defaultSets: DEFAULT_SETS, defaultReps: 10 },
      { exerciseId: 'ex-20', exerciseName: '倒蹬', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-21', exerciseName: '腿弯举', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-22', exerciseName: '内收肌', defaultSets: DEFAULT_SETS, defaultReps: 15 },
    ],
  },
  {
    id: 'tpl-biceps',
    name: '二头训练',
    items: [
      { exerciseId: 'ex-23', exerciseName: '杠铃弯举', defaultSets: DEFAULT_SETS, defaultReps: 10 },
      { exerciseId: 'ex-24', exerciseName: '锤式弯举', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-25', exerciseName: '三面弯举', defaultSets: DEFAULT_SETS, defaultReps: 10 },
    ],
  },
  {
    id: 'tpl-triceps',
    name: '三头训练',
    items: [
      { exerciseId: 'ex-26', exerciseName: '绳索下压', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-27', exerciseName: '窄推', defaultSets: DEFAULT_SETS, defaultReps: 10 },
    ],
  },
  {
    id: 'tpl-core',
    name: '核心训练',
    items: [
      { exerciseId: 'ex-28', exerciseName: '悬垂举腿', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-29', exerciseName: '跪拜龙门架', defaultSets: DEFAULT_SETS, defaultReps: 12 },
      { exerciseId: 'ex-30', exerciseName: '卷腹', defaultSets: DEFAULT_SETS, defaultReps: 20 },
      { exerciseId: 'ex-31', exerciseName: '俄罗斯转体', defaultSets: DEFAULT_SETS, defaultReps: 15 },
    ],
  },
]

// 预设模板就是被播种的那几个；迁移只碰它们，用户自建的模板不动。
const PRESET_TEMPLATE_IDS = DEFAULT_TEMPLATES.map((t) => t.id)

db.version(1).stores({
  exercises: 'id, bodyPart',
  templates: 'id',
  sessions: 'id, date',
})

// v2：预设模板的动作组数从 4 组改成 1 组（2026-10）。
// 走 Dexie 的 upgrade 而不是在 initDB 里判断，是为了保证「只执行一次」——
// 用户之后在 Templates 页把某个预设改回 4 组，不应该在下次启动时被重新覆盖。
// 只改 templates 表，不碰 sessions（历史记录自带组数快照，与模板无关）。
db.version(2)
  .stores({
    exercises: 'id, bodyPart',
    templates: 'id',
    sessions: 'id, date',
  })
  .upgrade(async (tx) => {
    const table = tx.table('templates')
    const all = (await table.toArray()) as WorkoutTemplate[]
    const changed = all
      .filter((t) => PRESET_TEMPLATE_IDS.includes(t.id))
      .map((t) => ({
        ...t,
        items: t.items.map((item) => ({ ...item, defaultSets: DEFAULT_SETS })),
      }))
    if (changed.length > 0) await table.bulkPut(changed)
  })

// v3：新增 weights 表（按本地日期一天一条的每日体重）。
// 之前体重只能挂在某条训练记录上，等于「没训练就记不了体重」。
// 这里把历史 sessions 里的 weight 迁进 weights，统计页的体重趋势不会断。
// 同一天多条记录都填了体重时，日期靠后的那条覆盖前面的（取最近一次称重）。
db.version(3)
  .stores({
    exercises: 'id, bodyPart',
    templates: 'id',
    sessions: 'id, date',
    weights: 'date',
  })
  .upgrade(async (tx) => {
    const sessions = (await tx.table('sessions').toArray()) as WorkoutSession[]
    const withWeight = sessions
      .filter((s) => typeof s.weight === 'number' && Number.isFinite(s.weight) && localDateKeyOf(s.date))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const rows = new Map<string, BodyWeight>()
    for (const s of withWeight) {
      rows.set(localDateKeyOf(s.date), {
        date: localDateKeyOf(s.date),
        weight: s.weight as number,
        updatedAt: 0,
      })
    }
    if (rows.size > 0) await tx.table('weights').bulkPut([...rows.values()])
  })

export async function initDB() {
  // Seed default exercises only on first run — never re-add ones the user deleted
  const existing = await db.exercises.toArray()
  if (existing.length === 0) {
    await db.exercises.bulkAdd(DEFAULT_EXERCISES)
  }

  // Seed default templates only when there are none
  const existingTemplates = await db.templates.toArray()
  if (existingTemplates.length === 0) {
    await db.templates.bulkAdd(DEFAULT_TEMPLATES)
    return
  }

  // Migrate legacy templates that are missing exerciseName, without wiping user data
  const exerciseNames = new Map(
    (await db.exercises.toArray()).map((e) => [e.id, e.name])
  )
  const repaired = existingTemplates.map((t) => ({
    ...t,
    items: t.items.map((item) => ({
      ...item,
      exerciseName:
        item.exerciseName || exerciseNames.get(item.exerciseId) || '未知动作',
    })),
  }))
  const changed = repaired.filter((t, i) =>
    t.items.some(
      (item, j) => item.exerciseName !== existingTemplates[i].items[j]?.exerciseName
    )
  )
  if (changed.length > 0) {
    await db.templates.bulkPut(changed)
  }
}

export { db }
