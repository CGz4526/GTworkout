import Dexie, { type EntityTable } from 'dexie'
import type { Exercise, ExerciseRecord, WorkoutSession, WorkoutTemplate } from '../types'
import type { LiveSession, LiveView } from '../api/workouts'
import { localDateKeyOf } from '../lib/date'
import { clampRestSeconds } from '../lib/rest'

export type SyncState = 'PENDING' | 'SYNCING' | 'SYNCED' | 'AUTH_REQUIRED' | 'CONFLICT' | 'FAILED'
export interface AccountSession {
  id: string; session: WorkoutSession; version: number; revision: number; state: SyncState
  cancelled?: boolean; editorDeviceId: string; localDate: string; offset: number; error?: string; updatedAt?: string
}
export interface Intent { id: string; resourceId: string; kind: 'SESSION' | 'EXERCISE'; body: string; revision: number; attempts: number; nextAttemptAt: number; leaseUntil: number }
export interface AccountExercise extends Exercise { synced: boolean; intent: string }
interface Meta { key: string; value: string }
export type AccountDatabase = Dexie & {
  sessions: EntityTable<AccountSession, 'id'>; exercises: EntityTable<AccountExercise, 'id'>
  outbox: EntityTable<Intent, 'id'>; meta: EntityTable<Meta, 'key'>
}
const databases = new Map<string, AccountDatabase>()
const editorTab = crypto.randomUUID()
interface EditorLease { owner: string; until: number }
function leaseValue(value: string | undefined): EditorLease | undefined {
  if (!value) return undefined
  try { return JSON.parse(value) as EditorLease } catch { throw new Error('本机编辑锁异常，请保留草稿并重新进入训练') }
}
export async function claimLocalEditor(account: string, id: string): Promise<boolean> {
  const database = accountDatabase(account)
  return database.transaction('rw', database.meta, async () => {
    const key = `editor:${id}`, lease = leaseValue((await database.meta.get(key))?.value), now = Date.now()
    if (lease && lease.owner !== editorTab && lease.until > now && lease.until < now + 60000) return false
    await database.meta.put({ key, value: JSON.stringify({ owner: editorTab, until: now + 20000 }) }); return true
  })
}
export async function renewLocalEditor(account: string, id: string): Promise<boolean> {
  const database = accountDatabase(account)
  return database.transaction('rw', database.meta, async () => {
    const key = `editor:${id}`, lease = leaseValue((await database.meta.get(key))?.value)
    if (lease?.owner !== editorTab) return false
    await database.meta.put({ key, value: JSON.stringify({ owner: editorTab, until: Date.now() + 20000 }) }); return true
  })
}
export async function releaseLocalEditor(account: string, id: string): Promise<void> {
  const database = accountDatabase(account)
  await database.transaction('rw', database.meta, async () => {
    const key = `editor:${id}`, lease = leaseValue((await database.meta.get(key))?.value)
    // Keep the last owner as a fencing marker. A suspended stale tab must not auto-reclaim writes.
    if (lease?.owner === editorTab) await database.meta.put({ key, value: JSON.stringify({ owner: editorTab, until: 0 }) })
  })
}
export function accountDatabase(account: string): AccountDatabase {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account)) throw new Error('账号标识无效')
  let database = databases.get(account)
  if (!database) {
    database = new Dexie(`WorkoutAccount-${account}`) as AccountDatabase
    database.version(1).stores({ sessions: 'id,localDate,state', exercises: 'id', outbox: 'id,resourceId,nextAttemptAt', meta: 'key' })
    databases.set(account, database)
  }
  return database
}
export async function deviceId(database: AccountDatabase): Promise<string> {
  return database.transaction('rw', database.meta, async () => {
    const old = await database.meta.get('deviceId')
    if (old) return old.value
    const value = crypto.randomUUID(); await database.meta.add({ key: 'deviceId', value }); return value
  })
}
export function ensureRecordIds(exercises: ExerciseRecord[]): ExerciseRecord[] {
  return exercises.map(ex => ({ ...ex, id: ex.id ?? crypto.randomUUID(), sets: ex.sets.map(set => ({ ...set, id: set.id ?? crypto.randomUUID() })) }))
}
export function toLive(row: AccountSession): LiveSession {
  const s = row.session
  return {
    id: s.id, type: s.aerobic ? 'AEROBIC' : s.templateName === '休息日' && !s.exercises.length ? 'REST' : 'STRENGTH',
    status: row.cancelled ? 'CANCELLED' : s.finished ? 'COMPLETED' : 'ACTIVE',
    occurredAt: s.date, localDate: row.localDate, utcOffsetMinutes: row.offset, durationSeconds: Math.max(0, Math.round(s.duration)),
    startedAt: s.startTime ? new Date(s.startTime).toISOString() : undefined, templateName: s.templateName?.trim() || undefined,
    notes: s.notes?.trim() || undefined, diet: s.diet, distanceKm: s.aerobic ? s.distance : undefined,
    exercises: s.exercises.map(ex => ({ id: ex.id!, exerciseId: ex.exerciseId, exerciseName: ex.exerciseName.trim(),
      restSeconds: clampRestSeconds(ex.restSeconds), sets: ex.sets.map(set => ({ id: set.id!, weightKg: set.weight, reps: set.reps,
        completed: set.completed, warmup: set.warmup === true, rpe: set.rpe })) })),
  }
}
export function validateLive(session: LiveSession): void {
  const text = (value: string | undefined, max: number) => value === undefined || (value.trim().length > 0 && [...value].length <= max)
  const decimal = (value: number | undefined, max: number) => value === undefined || (Number.isFinite(value) && value >= 0 && value <= max && Math.round(value * 1000) / 1000 === value)
  if (!text(session.templateName, 100) || !text(session.notes, 2000)) throw new Error('训练名称最多100字，备注最多2000字')
  if (!Number.isInteger(session.durationSeconds) || session.durationSeconds < 0 || session.durationSeconds > 604800 || !decimal(session.distanceKm, 10000)) throw new Error('请检查训练时长与距离')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.localDate) || !Number.isFinite(Date.parse(session.occurredAt))) throw new Error('训练日期无效')
  if (session.exercises.length > 100 || session.exercises.reduce((count, ex) => count + ex.sets.length, 0) > 2000) throw new Error('训练动作或组数超过单次限制')
  for (const ex of session.exercises) {
    if (!text(ex.exerciseName, 100) || ex.sets.length > 100) throw new Error('动作名称或组数超过限制')
    for (const set of ex.sets) {
      if (!decimal(set.weightKg, 1000) || (set.reps !== undefined && (!Number.isInteger(set.reps) || set.reps < 0 || set.reps > 10000))) throw new Error('重量需为0–1000且最多3位小数，次数需为0–10000的整数')
      if (set.rpe !== undefined && (!Number.isFinite(set.rpe) || set.rpe < 6 || set.rpe > 10 || !Number.isInteger(set.rpe * 2))) throw new Error('RPE需为6–10，步长0.5')
    }
  }
}
export function fromLive(view: LiveView): WorkoutSession {
  const s = view.session
  return { id: s.id, date: s.occurredAt, templateName: s.templateName ?? (s.type === 'REST' ? '休息日' : undefined),
    duration: s.durationSeconds, finished: s.status !== 'ACTIVE', startTime: s.startedAt ? Date.parse(s.startedAt) : undefined,
    aerobic: s.type === 'AEROBIC', distance: s.distanceKm, notes: s.notes, diet: s.diet,
    exercises: s.exercises.map(ex => ({ id: ex.id, exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, restSeconds: ex.restSeconds,
      sets: ex.sets.map(set => ({ id: set.id, weight: set.weightKg, reps: set.reps, completed: set.completed, warmup: set.warmup, rpe: set.rpe })) })) }
}
export async function createAccountSession(account: string, session: WorkoutSession): Promise<void> {
  const database = accountDatabase(account), device = await deviceId(database)
  session = { ...session, exercises: ensureRecordIds(session.exercises) }
  await database.transaction('rw', database.sessions, database.outbox, database.meta, async () => {
    if (await database.sessions.count() >= 10000 || await database.outbox.count() >= 1000) throw new Error('本机账号缓存已满，请先同步并导出')
    const active = await database.sessions.filter(row => !row.cancelled && !row.session.finished).first()
    if (!session.finished && active) throw new Error('请先完成已有账号训练')
    const row: AccountSession = { id: session.id, session, version: 0, revision: 1, state: 'PENDING', editorDeviceId: device,
      localDate: localDateKeyOf(session.date), offset: -new Date(session.date).getTimezoneOffset() }
    await database.sessions.add(row); await queue(database, row)
  })
}
export async function addAccountExercise(account: string, exercise: Exercise): Promise<void> {
  if (!exercise.name.trim() || [...exercise.name.trim()].length > 100 || !exercise.bodyPart.trim() || [...exercise.bodyPart].length > 32) throw new Error('动作名称需为1–100字，部位需为1–32字')
  const database = accountDatabase(account)
  const body = JSON.stringify({ mutationId: crypto.randomUUID(), id: exercise.id, name: exercise.name.trim(), bodyPart: exercise.bodyPart, restSeconds: clampRestSeconds(exercise.restSeconds) })
  await database.transaction('rw', database.exercises, database.outbox, async () => {
    if (await database.outbox.count() >= 1000) throw new Error('待同步队列已满')
    await database.exercises.add({ ...exercise, synced: false, intent: body })
    await database.outbox.add({ id: JSON.parse(body).mutationId, resourceId: exercise.id, kind: 'EXERCISE', body, revision: 0, attempts: 0, nextAttemptAt: 0, leaseUntil: 0 })
  })
}
async function queue(database: AccountDatabase, row: AccountSession): Promise<void> {
  const live = toLive(row)
  validateLive(live)
  // At most one frozen intent per session; later edits stay in row.session until acknowledgement.
  if (await database.outbox.where('resourceId').equals(row.id).count()) return
  const id = crypto.randomUUID()
  const body = JSON.stringify({ mutationId: id, deviceId: row.editorDeviceId, expectedVersion: row.version, session: live })
  if (new TextEncoder().encode(body).length > 1024 * 1024) throw new Error('训练内容过大，尚未保存')
  await database.outbox.add({ id, resourceId: row.id, kind: 'SESSION', body, revision: row.revision, attempts: 0, nextAttemptAt: 0, leaseUntil: 0 })
}
export async function patchAccountSession(account: string, id: string, patch: Partial<WorkoutSession>, cancel = false): Promise<void> {
  const database = accountDatabase(account), device = await deviceId(database)
  await database.transaction('rw', database.sessions, database.outbox, database.meta, async () => {
    const row = await database.sessions.get(id)
    if (!row) throw new Error('未找到账号训练')
    if (row.editorDeviceId !== device) throw new Error('请在原设备编辑训练')
    if (row.session.finished || row.cancelled) throw new Error('首版已结束的账号训练只读')
    if (row.state === 'CONFLICT') throw new Error('训练存在云端冲突，请先保留草稿并处理')
    const key = `editor:${id}`, editor = leaseValue((await database.meta.get(key))?.value)
    if (editor && editor.owner !== editorTab) throw new Error('其他标签页已接管编辑，请重新进入训练读取最新内容')
    if (!editor) await database.meta.put({ key, value: JSON.stringify({ owner: editorTab, until: Date.now() + 20000 }) })
    row.session = { ...row.session, ...patch, exercises: ensureRecordIds(patch.exercises ?? row.session.exercises) }
    row.cancelled = cancel; row.revision++; row.state = row.state === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'PENDING'; row.error = undefined
    // Never create CANCELLED: if creation is pending, first resolve it, then cancel with returned version.
    await database.sessions.put(row); await queue(database, row)
  })
}
export async function acknowledge(account: string, intent: Intent, view: LiveView): Promise<void> {
  const database = accountDatabase(account)
  await database.transaction('rw', database.sessions, database.outbox, async () => {
    const row = await database.sessions.get(intent.resourceId)
    if (!row || !(await database.outbox.get(intent.id))) return
    if (view.session.id !== row.id || view.editorDeviceId !== row.editorDeviceId) throw new Error('训练响应身份不一致')
    await database.outbox.delete(intent.id)
    row.version = view.version; row.updatedAt = view.updatedAt
    if (row.revision === intent.revision) { row.state = 'SYNCED'; row.error = undefined }
    else { row.state = 'PENDING'; await queue(database, row) }
    await database.sessions.put(row)
  })
}
export async function cacheLive(account: string, view: LiveView): Promise<void> {
  const database = accountDatabase(account)
  await database.transaction('rw', database.sessions, database.outbox, async () => {
    const old = await database.sessions.get(view.session.id)
    if (old && (old.state !== 'SYNCED' || old.version > view.version)) return
    await database.sessions.put({ id: view.session.id, session: fromLive(view), version: view.version, revision: old?.revision ?? 0,
      state: 'SYNCED', cancelled: view.session.status === 'CANCELLED', editorDeviceId: view.editorDeviceId, localDate: view.session.localDate, offset: view.session.utcOffsetMinutes, updatedAt: view.updatedAt })
  })
}
export interface WorkoutStorage {
  sessions: { get(id: string): Promise<WorkoutSession | undefined>; add(session: WorkoutSession): Promise<unknown>; update(id: string, patch: Partial<WorkoutSession>): Promise<unknown>; delete(id: string): Promise<unknown>; toArray(): Promise<WorkoutSession[]> }
  exercises: { get(id: string): Promise<Exercise | undefined>; toArray(): Promise<Exercise[]>; add(ex: Exercise): Promise<unknown> }
  templates: { get(id: string): Promise<WorkoutTemplate | undefined> }
}
const storages = new Map<string, WorkoutStorage>()
export function accountStorage(account: string): WorkoutStorage {
  let storage = storages.get(account)
  if (!storage) {
    const database = accountDatabase(account)
    storage = { sessions: {
      add: session => createAccountSession(account, session),
      get: async id => (await database.sessions.get(id))?.session,
      update: (id, patch) => patchAccountSession(account, id, patch), delete: id => patchAccountSession(account, id, {}, true),
      toArray: async () => (await database.sessions.toArray()).filter(r => !r.cancelled).map(r => r.session),
    }, exercises: { get: id => database.exercises.get(id), toArray: () => database.exercises.toArray(), add: ex => addAccountExercise(account, ex) },
    templates: { get: async () => undefined } }
    storages.set(account, storage)
  }
  return storage
}
