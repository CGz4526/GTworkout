import { cloudSessionTicket, invalidateCloudSession, isCloudSessionCurrent } from './cloudSession'

export interface CloudUser { id: string; username: string }
export interface BackupMetadata {
  id: string; createdAt: string; sizeBytes: number; sha256: string; formatVersion: number
  timezone: string; exerciseCount: number; templateCount: number; sessionCount: number; weightCount: number
  projectionStatus: 'NOT_REQUESTED' | 'PROCESSING' | 'READY' | 'FAILED'
  jobId: string | null
}
export interface BackupPage { items: BackupMetadata[]; nextCursor: string | null }

const messages: Record<string, string> = {
  AUTHENTICATION_REQUIRED: '请先登录云账号', INVALID_CREDENTIALS: '账号或密码不正确',
  USERNAME_UNAVAILABLE: '该用户名已被使用', REGISTRATION_DISABLED: '当前环境未开放注册',
  ACCOUNT_QUOTA_EXCEEDED: '当前环境的账号名额已满', INVALID_INPUT: '请检查用户名、密码或时区格式',
  AUTH_RATE_LIMITED: '操作过于频繁，请十分钟后重试', BACKUP_QUOTA_EXCEEDED: '云备份额度已满',
  IDEMPOTENCY_CONFLICT: '本次请求内容已变化，请重新选择文件', INVALID_BACKUP: '备份格式或内容不符合云端要求',
  UNSUPPORTED_BACKUP_VERSION: '不支持此备份版本，请先在原应用恢复后重新导出',
  UPLOAD_BUSY: '备份上传繁忙，请稍后重试', BACKUP_TOO_LARGE: '备份文件不能超过 20 MiB',
  ACCOUNT_CHANGED: '云账号已在其他页面切换，请刷新后重新核对账号和文件',
  STALE_CLOUD_REQUEST: '云会话已变化，已忽略旧请求结果',
  PROJECTION_NOT_READY: '快照还未处理完成，请稍后重试', PROJECTION_NOT_RETRYABLE: '当前状态不能重新处理',
  JOB_NOT_RETRYABLE: '处理任务不能重试，或已达到重试次数上限', DATE_RANGE_TOO_WIDE: '日期点过多，请缩小日期范围',
  INVALID_DATE_RANGE: '请填写有效的起止日期，范围不超过十年',
  ASSISTANT_NOT_CONFIGURED: '教练服务尚未配置模型，请先在本机注入模型环境变量',
  INVALID_COACH_REQUEST: '请填写比较日期、训练天数、时长并选择允许动作，确认数据发送范围',
  INVALID_ALLOWED_EXERCISES: '选择的动作不属于这份快照', AGENT_QUOTA_EXCEEDED: '已有执行中任务，或已达到任务额度',
  PLAN_VERSION_CONFLICT: '草案版本已变化，请重新获取', PLAN_NOT_FOUND: '未找到此计划草案',
  AGENT_RUN_NOT_FOUND: '未找到此教练任务', CATALOG_BUSY: '动作库读取繁忙，请稍后再试',
  BACKUP_NOT_FOUND: '未找到此备份', ACCESS_DENIED: '会话验证失败，请刷新页面后重试',
  TRAINING_NOT_ENABLED: '此服务尚未启用账号训练，请继续使用本机训练',
  INVALID_WORKOUT_INPUT: '训练字段不符合保存要求，请核对数值、名称及日期',
  INVALID_EXERCISE_INPUT: '动作名称、部位或休息时间不符合要求',
  SESSION_NOT_FOUND: '未找到此账号下的训练', ACTIVE_SESSION_EXISTS: '云端已有进行中的训练，请先在原设备完成',
  VERSION_CONFLICT: '训练版本冲突，本地草稿已保留', EDITOR_DEVICE_MISMATCH: '此训练需要在原设备编辑',
  IMPORT_NEEDS_REVIEW: '备份包含冲突或不支持的训练，请先检查预览', IMPORT_BATCH_TOO_LARGE: '单批最多导入 1000 条训练，请拆分备份',
  IMPORT_CONFIRMATION_REQUIRED: '请重新预览并确认迁移内容', TRAINING_QUOTA_EXCEEDED: '账号训练额度已满，请保留导出文件后联系维护',
}
export class CloudError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(messages[code] || `云端请求失败（${status}）`); this.status = status; this.code = code
  }
}
const root = `${import.meta.env.BASE_URL}api/v1`
const responseTickets = new WeakMap<Response, number>()
function assertSession(ticket: number | undefined): void {
  if (ticket === undefined || !isCloudSessionCurrent(ticket)) throw new CloudError(409, 'STALE_CLOUD_REQUEST')
}
export async function readCloudJson<T>(response: Response): Promise<T> {
  const result: T = await response.json()
  assertSession(responseTickets.get(response))
  return result
}

async function call(path: string, init: RequestInit = {}, context: { allowAnonymous?: boolean } = {}): Promise<Response> {
  const ticket = cloudSessionTicket()
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(`${root}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    assertSession(ticket)
    if (!response.ok) {
      let code = response.status === 413 ? 'BACKUP_TOO_LARGE' : 'REQUEST_FAILED'
      try { const body = await response.json(); if (typeof body.code === 'string') code = body.code } catch { /* Non-JSON gateway error. */ }
      assertSession(ticket)
      const anonymousProbe = context.allowAnonymous && path === '/auth/me'
      if (code === 'ACCOUNT_CHANGED' || (response.status === 401 && code !== 'INVALID_CREDENTIALS' && !anonymousProbe)) {
        invalidateCloudSession(code === 'ACCOUNT_CHANGED' ? 'ACCOUNT_CHANGED' : 'AUTHENTICATION_REQUIRED', path !== '/auth/me')
      }
      throw new CloudError(response.status, code)
    }
    responseTickets.set(response, ticket)
    return response
  } finally { window.clearTimeout(timer) }
}
async function write(path: string, body?: BodyInit, contentType?: string, extraHeaders: Record<string, string> = {}) {
  const ticket = cloudSessionTicket()
  const csrf = await readCloudJson<{ token: string; headerName: string }>(await call('/auth/csrf'))
  if (csrf.headerName !== 'X-CSRF-TOKEN' || typeof csrf.token !== 'string') throw new Error('云服务响应格式不正确')
  assertSession(ticket)
  return call(path, { method: 'POST', body, headers: { ...extraHeaders, 'X-CSRF-TOKEN': csrf.token, ...(contentType ? { 'Content-Type': contentType } : {}) } })
}
export { call as cloudRequest, write as cloudWrite }
export async function currentUser(context: { allowAnonymous?: boolean } = {}): Promise<CloudUser | null> {
  try { return await readCloudJson<CloudUser>(await call('/auth/me', {}, context)) }
  catch (error) { if (error instanceof CloudError && error.status === 401) return null; throw error }
}
export async function register(username: string, password: string): Promise<void> {
  await write('/auth/register', JSON.stringify({ username, password }), 'application/json')
}
export async function login(username: string, password: string): Promise<CloudUser> {
  await write('/auth/login', new URLSearchParams({ username, password }), 'application/x-www-form-urlencoded')
  const user = await currentUser()
  if (!user) throw new Error('登录状态未建立，请重试')
  invalidateCloudSession('ACCOUNT_CHANGED')
  return user
}
export async function logout(): Promise<void> { await write('/auth/logout'); invalidateCloudSession('SIGNED_OUT') }
export async function listBackups(cursor?: string): Promise<BackupPage> {
  return readCloudJson<BackupPage>(await call(`/backups${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`))
}
export async function uploadBackup(file: File, timezone: string, key: string, expectedUser: string): Promise<BackupMetadata> {
  const body = new FormData(); body.append('file', file); body.append('timezone', timezone)
  return readCloudJson<BackupMetadata>(await write('/backups', body, undefined, { 'Idempotency-Key': key, 'X-Expected-User': expectedUser }))
}
export async function downloadBackup(id: string): Promise<void> {
  const response = await call(`/backups/${encodeURIComponent(id)}/download`)
  const blob = await response.blob()
  assertSession(responseTickets.get(response))
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `workout-backup-${id}.json`
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 15000)
}

export interface JobStatus { id: string; backupId: string; status: 'PENDING' | 'RUNNING' | 'RETRY_WAIT' | 'SUCCEEDED' | 'FAILED'; attempts: number; errorCode: string | null }
export interface Statistics {
  backupId: string; timezone: string; coverage: { dataFrom: string | null; dataTo: string | null }
  summary: { trainingSessions: number; trainingDays: number; strengthSessions: number; aerobicSessions: number; restDays: number; countedSets: number; volume: number; aerobicDistance: number; aerobicDuration: number }
  bodyParts: { bodyPart: string; trainingDays: number }[]
  weights: { localDate: string; weight: number; source: string }[]
}
export interface TrainingSession { sourceId: string; localDate: string; kind: string; name: string | null; duration: number; countedSets: number; volume: number }
export interface TrainingExercise { sourceExerciseId: string; exerciseName: string | null; bodyPart: string }
export interface Progress { localDate: string; countedSets: number; volume: number; maxWeight: number }
export async function getJob(id: string): Promise<JobStatus> { return readCloudJson<JobStatus>(await call(`/jobs/${encodeURIComponent(id)}`)) }
export async function requestProjection(id: string): Promise<void> { await write(`/backups/${encodeURIComponent(id)}/retry`) }
function rangeQuery(from: string, to: string) { return from || to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : '' }
export async function statistics(id: string, from = '', to = ''): Promise<Statistics> { return readCloudJson<Statistics>(await call(`/backups/${encodeURIComponent(id)}/statistics${rangeQuery(from, to)}`)) }
export async function trainingSessions(id: string, offset = 0): Promise<{ items: TrainingSession[]; offset: number; hasMore: boolean }> { return readCloudJson(await call(`/backups/${encodeURIComponent(id)}/sessions?offset=${offset}`)) }
export async function trainingExercises(id: string): Promise<TrainingExercise[]> { return readCloudJson<TrainingExercise[]>(await call(`/backups/${encodeURIComponent(id)}/exercises`)) }
export async function exerciseProgress(id: string, sourceId: string, from = '', to = ''): Promise<Progress[]> { return readCloudJson<Progress[]>(await call(`/backups/${encodeURIComponent(id)}/exercises/${encodeURIComponent(sourceId)}/progress${rangeQuery(from, to)}`)) }
