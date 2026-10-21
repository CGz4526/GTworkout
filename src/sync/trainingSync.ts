import { CloudError, currentUser } from '../api/cloud'
import { cloudSessionTicket, isCloudSessionCurrent, invalidateCloudSession } from '../api/cloudSession'
import { liveRead, liveWrite, type LivePage, type LiveView } from '../api/workouts'
import { accountDatabase, acknowledge, cacheLive, type Intent } from '../data/accountTraining'

const running = new Set<string>()
export async function syncTraining(account: string): Promise<void> {
  if (running.has(account) || !navigator.onLine) return
  running.add(account)
  const database = accountDatabase(account), ticket = cloudSessionTicket()
  try {
    if (!(await database.outbox.count())) return
    const user = await currentUser()
    if (!isCloudSessionCurrent(ticket)) return
    if (user?.id !== account) {
      if (user) invalidateCloudSession('ACCOUNT_CHANGED')
      return
    }
    // Bound each foreground pass. New input remains durable for the next pass.
    for (let step = 0; step < 40 && isCloudSessionCurrent(ticket); step++) {
      const now = Date.now()
      const intent = await database.transaction('rw', database.outbox, database.exercises, async () => {
        const candidates = await database.outbox.orderBy('nextAttemptAt').toArray()
        for (const candidate of candidates) {
          if (candidate.nextAttemptAt > now || candidate.leaseUntil > now || candidate.attempts >= 6) continue
          if (candidate.kind === 'SESSION') {
            const body = JSON.parse(candidate.body)
            let ready = true
            for (const exercise of body.session.exercises) if (!(await database.exercises.get(exercise.exerciseId))?.synced) ready = false
            if (!ready) continue
          }
          await database.outbox.update(candidate.id, { leaseUntil: now + 90000 })
          return candidate
        }
        return undefined
      })
      if (!intent) break
      try {
        if (!isCloudSessionCurrent(ticket)) return
        if (intent.kind === 'EXERCISE') {
          const result = await liveWrite<{ id: string }>('/exercises', 'POST', intent.body, account)
          if (!isCloudSessionCurrent(ticket)) return
          if (result.id !== intent.resourceId) throw new Error('动作响应标识不一致')
          await database.transaction('rw', database.exercises, database.outbox, async () => {
            await database.exercises.update(intent.resourceId, { synced: true }); await database.outbox.delete(intent.id)
          })
        } else {
          await database.sessions.update(intent.resourceId, { state: 'SYNCING' })
          const body = JSON.parse(intent.body)
          const response = await liveWrite<LiveView>(body.expectedVersion === 0 ? '/workout-sessions' : `/workout-sessions/${intent.resourceId}`,
            body.expectedVersion === 0 ? 'POST' : 'PUT', intent.body, account)
          if (!isCloudSessionCurrent(ticket)) return
          await acknowledge(account, intent, response)
        }
      } catch (error) {
        if (!isCloudSessionCurrent(ticket)) return
        await failed(account, intent, error)
        if (error instanceof CloudError && (error.status === 401 || error.code === 'ACCOUNT_CHANGED')) break
      }
    }
  } finally { running.delete(account) }
}
async function failed(account: string, intent: Intent, error: unknown) {
  const database = accountDatabase(account)
  const code = error instanceof CloudError ? error.code : 'NETWORK_OR_RESPONSE_ERROR'
  const auth = error instanceof CloudError && (error.status === 401 || error.code === 'ACCOUNT_CHANGED')
  const conflict = error instanceof CloudError && error.status === 409
  const permanent = error instanceof CloudError && error.status >= 400 && error.status < 500 && error.status !== 429 && !auth
  const attempts = auth ? intent.attempts : permanent ? 6 : intent.attempts + 1
  await database.transaction('rw', database.sessions, database.outbox, async () => {
    await database.outbox.update(intent.id, { attempts, leaseUntil: 0, nextAttemptAt: Date.now() + Math.min(30000, 1000 * 2 ** attempts) + Math.floor(Math.random() * 500) })
    const state = auth ? 'AUTH_REQUIRED' : conflict ? 'CONFLICT' : attempts >= 6 ? 'FAILED' : 'PENDING'
    if (intent.kind === 'SESSION') await database.sessions.update(intent.resourceId, { state, error: code })
    else {
      // Surface failed dependencies instead of leaving training indefinitely pending without a reason.
      const rows = await database.sessions.toArray()
      for (const row of rows) if (row.state !== 'SYNCED' && row.session.exercises.some(ex => ex.exerciseId === intent.resourceId)) {
        await database.sessions.update(row.id, { state, error: code })
      }
    }
  })
}
export async function retryTraining(account: string): Promise<void> {
  const database = accountDatabase(account)
  await database.transaction('rw', database.sessions, database.outbox, async () => {
    for (const row of await database.sessions.toArray()) {
      if (row.state === 'CONFLICT') continue
      if (row.state !== 'SYNCED') await database.sessions.update(row.id, { state: 'PENDING', error: undefined })
    }
    for (const intent of await database.outbox.toArray()) {
      const row = intent.kind === 'SESSION' ? await database.sessions.get(intent.resourceId) : undefined
      if (row?.state === 'CONFLICT') continue
      await database.outbox.update(intent.id, { attempts: 0, nextAttemptAt: 0, leaseUntil: 0 })
    }
  })
  await syncTraining(account)
}
export async function pullTraining(account: string, cursor?: string): Promise<string | null> {
  const ticket = cloudSessionTicket()
  const page = await liveRead<LivePage>(`/workout-sessions?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, account)
  if (!isCloudSessionCurrent(ticket)) return null
  for (const view of page.items) { if (!isCloudSessionCurrent(ticket)) return null; await cacheLive(account, view) }
  if (!cursor) {
    // CANCELLED rows are absent from history lists. Resolve previously cached active rows explicitly.
    const database = accountDatabase(account)
    const cached = await database.sessions.filter(row => row.state === 'SYNCED' && !row.session.finished && !row.cancelled).toArray()
    for (const row of cached.slice(0, 10)) {
      if (page.items.some(view => view.session.id === row.id)) continue
      if (!isCloudSessionCurrent(ticket)) return null
      const view = await liveRead<LiveView>(`/workout-sessions/${row.id}`, account)
      if (!isCloudSessionCurrent(ticket)) return null
      await cacheLive(account, view)
    }
  }
  return page.nextCursor
}
export function watchTrainingSync(account: string): () => void {
  const run = () => { void syncTraining(account).catch(() => { /* Durable queue remains intact; explicit retry is available. */ }) }
  run()
  const timer = window.setInterval(run, 5000)
  window.addEventListener('online', run); window.addEventListener('focus', run)
  return () => { window.clearInterval(timer); window.removeEventListener('online', run); window.removeEventListener('focus', run) }
}
