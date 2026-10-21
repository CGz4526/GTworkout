export interface Exercise {
  id: string
  name: string
  bodyPart: string
  description?: string
  // 该动作的默认组间歇（秒）。不填则用 DEFAULT_REST_SECONDS。
  // 复合动作通常要 3 分钟，孤立动作 90 秒就够了，一个全局值照顾不到。
  restSeconds?: number
  createdAt?: number
}

export interface TemplateItem {
  exerciseId: string
  exerciseName: string
  defaultSets: number
  defaultReps: number
  // 可选热身组数，缺省1；显式0可关闭，defaultSets仍只表示工作组数。
  warmupSets?: number
  // 模板级覆盖，优先于动作库的 restSeconds。不填则回落到动作库值。
  restSeconds?: number
}

export interface WorkoutTemplate {
  id: string
  name: string
  items: TemplateItem[]
}

export interface SetRecord {
  id?: string // 账号训练的稳定组标识；旧本地记录仍可缺省
  weight?: number
  reps?: number
  completed: boolean
  // 主观用力程度，6–10（RPE 量表），0.5 步进，可空。
  // 同一重量在不同日期的 RPE 不同，反映的是当天状态——纯重量数字看不出来。
  rpe?: number
  // 热身组。不计入容量与「有效组数」统计，否则热身会把总量算得偏乐观。
  warmup?: boolean
}

// 每日体重。一天一条，key 是本地日期 'YYYY-MM-DD'（不是 UTC ISO）——
// 早起称体重时当天往往还没有任何训练记录，所以它不能挂在 session 上，
// 必须是独立的一天的属性。
export interface BodyWeight {
  date: string
  weight: number
  updatedAt: number
}

export interface ExerciseRecord {
  id?: string // 账号训练中的动作记录标识，与动作库 exerciseId 区分
  exerciseId: string
  exerciseName: string
  sets: SetRecord[]
  // 训练时实际生效的组间歇快照（模板 > 动作库 > 默认）。历史详情页要还原当时的配置，
  // 而模板之后可能被改掉、动作库也可能改默认——所以结束训练时存一份。
  restSeconds?: number
}

export interface WorkoutSession {
  id: string
  templateId?: string
  templateName?: string
  date: string
  duration: number
  exercises: ExerciseRecord[]
  finished?: boolean
  startTime?: number // timestamp when workout started (for continuous timer)
  restEndTime?: number // timestamp when rest ends (for background timer)
  photos?: string[] // base64 encoded images, max 3
  weight?: number // body weight in kg
  aerobic?: boolean // true for aerobic exercises (running, swimming)
  distance?: number // distance in km for aerobic exercises
  diet?: 'low' | 'mid' | 'high' | 'cheat' // carbon cycling diet
  // 训练备注。当天肩膀不舒服、换了器械、状态差——回看重量下滑时能对上原因。
  notes?: string
}

export const BODY_PARTS = ['肩', '胸', '背', '腿', '二头', '三头', '核心'] as const
export type BodyPart = (typeof BODY_PARTS)[number]

// 模板/训练里新增一个动作时的起始组次。
// 1 组是为了让模板尽量精简——真正练几组在 PreWorkout 页按当次状态调。
export const DEFAULT_SETS = 1
export const DEFAULT_REPS = 12

// 组间歇。默认两分半——这是大多数复合动作的合理下限。
// 用户可在动作库（该动作的默认）或模板（当次覆盖）里改，见 lib/rest.ts。
export const DEFAULT_REST_SECONDS = 150
export const MIN_REST_SECONDS = 30
export const MAX_REST_SECONDS = 600

// RPE（主观用力程度）量表。6 起是因为低于 6 基本等于没用力，记了也没信息量。
export const MIN_RPE = 6
export const MAX_RPE = 10
