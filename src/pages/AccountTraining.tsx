import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import AccountTrainingGate from '../components/AccountTrainingGate'
import Header from '../components/Header'
import ActiveWorkout from './ActiveWorkout'
import AddSession from './AddSession'
import TrainingImportPanel from '../components/TrainingImportPanel'
import { accountDatabase, accountStorage, addAccountExercise, createAccountSession, deviceId, claimLocalEditor, renewLocalEditor, releaseLocalEditor, type SyncState } from '../data/accountTraining'
import { pullTraining, retryTraining } from '../sync/trainingSync'
import { countedSets, sessionVolume } from '../lib/set'
import { db } from '../db'
import { localNoonOf, toLocalDateKey } from '../lib/date'

const labels: Record<SyncState, string> = { PENDING: '本地已保存，待同步', SYNCING: '正在同步', SYNCED: '已同步', AUTH_REQUIRED: '等待重新登录', CONFLICT: '存在冲突，草稿已保留', FAILED: '同步失败，记录已保留' }
export function AccountSyncBanner({ account, sessionId }: { account: string; sessionId?: string }) {
  const database = accountDatabase(account)
  const rows = useLiveQuery(() => sessionId ? database.sessions.where('id').equals(sessionId).toArray() : database.sessions.toArray(), [database, sessionId]) ?? []
  const pending = rows.filter(row => row.state !== 'SYNCED')
  return <div className="border-b border-border bg-surface-1 px-4 py-2 text-xs text-secondary" role="status">
    账号训练 · {sessionId && rows[0] ? labels[rows[0].state] : pending.length ? `${pending.length} 条尚未同步` : '训练记录已同步'}
    {rows.some(row => row.error) && <span className="block">错误：{rows.find(row => row.error)?.error}。可返回账号训练重试，冲突草稿请先导出。</span>}
  </div>
}
export function AccountSessionRoute() {
  const { accountId, sessionId } = useParams()
  return <AccountTrainingGate accountId={accountId}>{account => <AccountActive key={`${account}-${sessionId}`} account={account} sessionId={sessionId ?? ''} />}</AccountTrainingGate>
}
export function AccountAddSessionRoute() {
  const { accountId } = useParams()
  return <AccountTrainingGate accountId={accountId}>{account => <AddSession storage={accountStorage(account)} homePath="/account-training" accountMode />}</AccountTrainingGate>
}
function AccountActive({ account, sessionId }: { account: string; sessionId: string }) {
  const database = accountDatabase(account)
  const row = useLiveQuery(() => database.sessions.get(sessionId), [database, sessionId])
  const [device, setDevice] = useState('')
  const [editorAccess, setEditorAccess] = useState(false)
  useEffect(() => { let disposed = false; void deviceId(database).then(value => { if (!disposed) setDevice(value) }); return () => { disposed = true } }, [database])
  useEffect(() => {
    let disposed = false
    void claimLocalEditor(account, sessionId).then(allowed => { if (!disposed) setEditorAccess(allowed); else if (allowed) void releaseLocalEditor(account, sessionId) }).catch(() => { if (!disposed) setEditorAccess(false) })
    const timer = window.setInterval(() => { void renewLocalEditor(account, sessionId).then(allowed => { if (!disposed) setEditorAccess(allowed) }).catch(() => { if (!disposed) setEditorAccess(false) }) }, 5000)
    return () => { disposed = true; window.clearInterval(timer); void releaseLocalEditor(account, sessionId).catch(() => {}) }
  }, [account, sessionId])
  if (!row || !device) return <div className="p-4 text-sm text-secondary">正在读取本机账号缓存；若此记录来自其他设备，请先刷新账号历史。<Link className="block text-accent-light" to="/account-training">返回账号训练</Link></div>
  if (row.cancelled || row.state === 'CONFLICT' || (!row.session.finished && row.editorDeviceId !== device)) return <div className="p-4 text-sm text-secondary">此训练已取消、存在冲突或正在其他设备编辑；请返回查看详情，草稿仍保留。<Link className="block text-accent-light" to="/account-training">返回账号训练</Link></div>
  if (!editorAccess && !row.session.finished) return <div className="p-4 text-sm text-secondary">正在确认编辑权，或此训练已在另一标签页打开。请关闭另一编辑页后重新进入，草稿保持原样。<Link className="block text-accent-light" to="/account-training">返回账号训练</Link></div>
  return <><AccountSyncBanner account={account} sessionId={sessionId} /><ActiveWorkout storage={accountStorage(account)} homePath="/account-training" accountMode /></>
}
export default function AccountTraining() {
  return <AccountTrainingGate>{account => <Dashboard key={account} account={account} />}</AccountTrainingGate>
}
function Dashboard({ account }: { account: string }) {
  const navigate = useNavigate(), database = accountDatabase(account)
  const rows = useLiveQuery(() => database.sessions.toArray(), [database]) ?? []
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [name, setName] = useState('自由训练')
  const [detail, setDetail] = useState<string | null>(null)
  const [device, setDevice] = useState('')
  useEffect(() => { let disposed = false; void deviceId(database).then(id => { if (!disposed) setDevice(id) }); return () => { disposed = true } }, [database])
  useEffect(() => {
    let disposed = false
    void pullTraining(account).then(next => { if (!disposed) setCursor(next) }).catch(() => { if (!disposed) setMessage('云端暂不可读，当前显示本机账号缓存。可稍后刷新。') })
    return () => { disposed = true }
  }, [account])
  async function act(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，原记录保持不变') }
    finally { setBusy(false) }
  }
  async function start(aerobic: boolean) {
    const id = crypto.randomUUID()
    await createAccountSession(account, { id, date: new Date().toISOString(), templateName: name.trim() || (aerobic ? '有氧训练' : '自由训练'),
      duration: 0, startTime: Date.now(), finished: false, aerobic, exercises: [] })
    navigate(`/account-session/${account}/${id}`)
  }
  async function copyCatalog() {
    const local = await db.exercises.toArray()
    let count = 0
    for (const exercise of local) {
      const key = `localExercise:${exercise.id}`
      const existing = await database.meta.get(key)
      if (existing && await database.exercises.get(existing.value)) continue
      const id = existing?.value ?? crypto.randomUUID()
      await database.meta.put({ key, value: id })
      await addAccountExercise(account, { ...exercise, id }); count++
    }
    setMessage(`已复制 ${count} 个本机动作到此账号，等待同步；未改动原动作库。`)
  }
  function exportDrafts() {
    const blob = new Blob([JSON.stringify({ accountId: account, exportedAt: new Date().toISOString(), sessions: rows }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), a = document.createElement('a')
    a.href = url; a.download = 'workout-account-drafts.json'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('已导出账号草稿文件，含训练内容，请妥善保存。该文件不是旧版全量备份格式。')
  }
  const visible = rows.filter(row => !row.cancelled).sort((a, b) => b.session.date.localeCompare(a.session.date))
  const selected = rows.find(row => row.id === detail)
  return <div className="ui-page"><Header title="账号训练" showBack /><AccountSyncBanner account={account} />
    <div className="content-width space-y-5 px-4 py-6 md:px-8">
      <p className="text-xs text-secondary">新训练自动上云；原本机记录不会自动认领。模板、体重、照片仍在本机功能中管理。本版本同一训练仅原设备可编辑。</p>
      <div className="ui-panel space-y-3">
        <label className="block text-sm text-primary">训练名称<input aria-label="账号训练名称" maxLength={100} value={name} onChange={e => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-surface-0 p-3" /></label>
        <button disabled={busy} onClick={() => void act(() => start(false))} className="ui-primary w-full">开始力量训练</button>
        <button disabled={busy} onClick={() => void act(() => start(true))} className="ui-secondary w-full">开始有氧训练</button>
        <div className="flex flex-wrap gap-4 text-sm text-accent-light">
          <Link to={`/account-add-session/${account}`}>补录已完成训练</Link>
          <button disabled={busy} onClick={() => void act(async () => {
            await createAccountSession(account, { id: crypto.randomUUID(), date: localNoonOf(toLocalDateKey(new Date())).toISOString(), templateName: '休息日', duration: 0, finished: true, exercises: [] })
          })}>记录今日休息</button>
        </div>
        <button disabled={busy} onClick={() => void act(copyCatalog)} className="text-sm text-accent-light">复制本机动作库到此账号</button>
      </div>
      <div className="flex flex-wrap gap-3 text-sm text-accent-light">
        <button disabled={busy} onClick={() => void act(async () => { await retryTraining(account); setCursor(await pullTraining(account)) })}>同步并刷新</button>
        <button disabled={busy} onClick={exportDrafts}>导出账号草稿</button><Link to="/cloud">云账号与备份</Link><Link to="/">本机训练</Link>
      </div>
      {message && <p role="status" className="break-words text-sm text-secondary">{message}</p>}
      <TrainingImportPanel account={account} onImported={async () => setCursor(await pullTraining(account))} />
      <h2 className="font-semibold text-primary">账号训练历史</h2>
      {!visible.length && <p className="text-sm text-muted">尚无账号训练。开始一条训练，或刷新获取已同步历史。</p>}
      {visible.map(row => <article key={row.id} className="ui-panel space-y-2 text-sm">
        <div className="font-semibold text-primary">{row.session.templateName || '训练'}</div>
        <div className="text-secondary">{row.localDate} · {row.session.finished ? '已完成' : '进行中'} · {labels[row.state]}</div>
        <div className="text-secondary">{countedSets(row.session.exercises)} 有效组 · 容量 {sessionVolume(row.session.exercises)} kg</div>
        {row.error && <p className="break-words text-red-500">{row.error}</p>}
        {!row.session.finished && row.editorDeviceId === device && row.state !== 'CONFLICT'
          ? <button className="text-accent-light" onClick={() => navigate(`/account-session/${account}/${row.id}`)}>继续训练</button>
          : <button className="text-accent-light" onClick={() => setDetail(detail === row.id ? null : row.id)}>查看详情</button>}
        {!row.session.finished && row.editorDeviceId !== device && <p className="text-xs text-muted">请在原设备完成训练，此设备只读。</p>}
      </article>)}
      {cursor && <button disabled={busy} className="text-sm text-accent-light" onClick={() => void act(async () => setCursor(await pullTraining(account, cursor)))}>加载更多历史</button>}
      {selected && <section className="space-y-2 rounded-xl bg-surface-1 p-4 text-sm text-primary" aria-label="账号训练详情">
        <h3 className="font-semibold">{selected.session.templateName || '训练'}详情</h3>
        <p>时长 {selected.session.duration} 秒{selected.session.distance != null ? ` · ${selected.session.distance} km` : ''}</p>
        {selected.session.exercises.map((ex, i) => <div key={ex.id ?? i}><p>{ex.exerciseName}</p>{ex.sets.map((set, j) => <p key={set.id ?? j} className="text-secondary">第{j + 1}组：{set.weight ?? '自重'} × {set.reps ?? '-'} {set.completed ? '已完成' : '未完成'}{set.warmup ? '（热身）' : ''}</p>)}</div>)}
        {selected.session.notes && <p className="whitespace-pre-wrap break-words">{selected.session.notes}</p>}
        <button onClick={() => setDetail(null)} className="text-accent-light">收起详情</button>
      </section>}
    </div></div>
}
