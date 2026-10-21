import { useEffect, useState } from 'react'
import Header from '../components/Header'
import CoachPanel from '../components/CoachPanel'
import { getServiceStatus } from '../api/status'
import * as cloud from '../api/cloud'
import { cloudSessionTicket, invalidateCloudSession, isCloudSessionCurrent, subscribeCloudSession } from '../api/cloudSession'

interface UploadIntent {
  file: File; key: string; timezone: string
  counts: { exercises: number; templates: number; sessions: number; weights: number }
}

export default function Cloud() {
  const [connected, setConnected] = useState(false)
  const [user, setUser] = useState<cloud.CloudUser | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [items, setItems] = useState<cloud.BackupMetadata[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [intent, setIntent] = useState<UploadIntent | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('正在连接…')
  const [jobs, setJobs] = useState<Record<string, cloud.JobStatus>>({})
  const [selected, setSelected] = useState<cloud.BackupMetadata | null>(null)
  const [statistics, setStatistics] = useState<cloud.Statistics | null>(null)
  const [sessions, setSessions] = useState<cloud.TrainingSession[]>([])
  const [hasMoreSessions, setHasMoreSessions] = useState(false)
  const [exercises, setExercises] = useState<cloud.TrainingExercise[]>([])
  const [progress, setProgress] = useState<cloud.Progress[] | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exerciseId, setExerciseId] = useState('')
  const hasProcessing = items.some(item => item.projectionStatus === 'PROCESSING')
  const inputClass = 'ui-input mt-2'

  useEffect(() => subscribeCloudSession(reason => {
    setUser(null); setItems([]); setCursor(null); setIntent(null); setConfirmed(false); setJobs({})
    setSelected(null); setStatistics(null); setSessions([]); setHasMoreSessions(false); setExercises([]); setProgress(null)
    setPassword(''); setFrom(''); setTo(''); setExerciseId('')
    setBusy(false)
    setMessage(reason === 'SIGNED_OUT' ? '已退出云账号，本地训练保持原样。' : '云会话已变化，请重新登录并核对账号。')
  }), [])

  useEffect(() => {
    if (!user) return
    let disposed = false
    let pending = false
    const check = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      const ticket = cloudSessionTicket()
      try {
        const account = await cloud.currentUser()
        if (!disposed && isCloudSessionCurrent(ticket) && account?.id !== user.id) invalidateCloudSession('ACCOUNT_CHANGED')
      } catch {
        if (!disposed && isCloudSessionCurrent(ticket)) invalidateCloudSession('AUTHENTICATION_REQUIRED', false)
      } finally { pending = false }
    }
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check)
    return () => { disposed = true; window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [user])

  async function loadPage(next?: string) {
    const ticket = cloudSessionTicket()
    const page = await cloud.listBackups(next)
    if (!isCloudSessionCurrent(ticket)) return
    setItems(previous => next ? [...previous, ...page.items] : page.items); setCursor(page.nextCursor)
  }
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    let disposed = false
    void (async () => {
      try {
        const status = await getServiceStatus(controller.signal)
        if (!status.capabilities.identity) throw new Error('云账号服务尚未开放')
        const ticket = cloudSessionTicket()
        const account = await cloud.currentUser({ allowAnonymous: true })
        const page = account ? await cloud.listBackups() : null
        if (!disposed) {
          setConnected(true)
          if (!isCloudSessionCurrent(ticket)) return
          setUser(account); setMessage(account ? '云服务已连接' : '云服务已连接，请登录云账号。')
          if (page) { setItems(page.items); setCursor(page.nextCursor) }
        }
      } catch {
        if (!disposed) setMessage('云服务暂不可用，本地训练和备份仍可使用。')
      } finally { window.clearTimeout(timeout) }
    })()
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [])

  useEffect(() => {
    if (!user || !hasProcessing) return
    let disposed = false
    let inFlight = false
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      const ticket = cloudSessionTicket()
      try {
        const page = await cloud.listBackups()
        const statuses = await Promise.all(page.items.filter(item => item.jobId && item.projectionStatus === 'PROCESSING').map(item => cloud.getJob(item.jobId!)))
        if (!disposed && isCloudSessionCurrent(ticket)) { setItems(page.items); setCursor(page.nextCursor); setJobs(Object.fromEntries(statuses.map(job => [job.id, job]))) }
      } catch { /* Keep explicit refresh available; do not affect local training. */ }
      finally { inFlight = false }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 2000)
    return () => { disposed = true; window.clearInterval(interval) }
  }, [user, hasProcessing])

  async function analyze(item: cloud.BackupMetadata) {
    const ticket = cloudSessionTicket()
    const [result, page, definitions] = await Promise.all([cloud.statistics(item.id), cloud.trainingSessions(item.id), cloud.trainingExercises(item.id)])
    if (!isCloudSessionCurrent(ticket)) return
    setSelected(item); setStatistics(result); setSessions(page.items); setHasMoreSessions(page.hasMore)
    setExercises(definitions); setExerciseId(''); setProgress(null); setFrom(''); setTo('')
  }

  async function run(action: () => Promise<void>) {
    const ticket = cloudSessionTicket()
    setBusy(true)
    try { await action() }
    catch (error) {
      if (!isCloudSessionCurrent(ticket) || (error instanceof cloud.CloudError && error.code === 'STALE_CLOUD_REQUEST')) return
      setMessage(error instanceof cloud.CloudError ? error.message : '连接中断或请求失败，请重试。上传重试会复用本次请求标识。')
      if (error instanceof cloud.CloudError && error.status === 401) { setUser(null); setItems([]); setCursor(null); setSelected(null); setStatistics(null) }
    } finally { if (isCloudSessionCurrent(ticket)) setBusy(false) }
  }
  async function selectFile(file?: File) {
    const ticket = cloudSessionTicket()
    setIntent(null); setConfirmed(false)
    if (!file) return
    if (file.size > 20 * 1024 * 1024) { setMessage('文件不能超过 20 MiB'); return }
    await run(async () => {
      let data: unknown
      try { data = JSON.parse(await file.text()) }
      catch { if (isCloudSessionCurrent(ticket)) setMessage('无法读取此 JSON，请选择原应用导出的备份文件。'); return }
      if (!isCloudSessionCurrent(ticket)) return
      if (!data || typeof data !== 'object' || !('exercises' in data) || !Array.isArray(data.exercises)
        || !('templates' in data) || !Array.isArray(data.templates) || !('sessions' in data) || !Array.isArray(data.sessions)) {
        setMessage('请选择原应用导出的 JSON 备份'); return
      }
      setIntent({ file, key: crypto.randomUUID(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        counts: { exercises: data.exercises.length, templates: data.templates.length, sessions: data.sessions.length,
          weights: 'weights' in data && Array.isArray(data.weights) ? data.weights.length : 0 } })
      setMessage('已读取文件摘要，请核对账号、记录数量和时区。')
    })
  }
  return (
    <div className="ui-page service-page">
      <Header title="云服务" showBack />
      <div className="content-width px-4 py-6 md:px-8 space-y-5">
        <section className="ui-panel space-y-4">
          <h2 className="font-semibold text-primary">服务状态</h2>
          <p role="status" className="text-sm text-muted">{message}</p>
          {!connected && <button className="text-accent-light text-sm" onClick={() => window.location.reload()}>重新连接</button>}
        </section>
        {connected && !user && <form className="ui-panel space-y-4" onSubmit={event => {
          event.preventDefault(); void run(async () => { const account = await cloud.login(username, password); setPassword(''); setUser(account); setIntent(null); setSelected(null); setStatistics(null); setConfirmed(false); await loadPage(); setMessage('已登录，账号不会自动上传或切换本地数据。') })
        }}>
          <h2 className="font-semibold text-primary">云账号</h2>
          <label className="block text-sm text-muted">用户名<input disabled={busy} required className={inputClass} value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" maxLength={32} placeholder="3–32 位字母、数字或下划线" /></label>
          <label className="block text-sm text-muted">密码<input disabled={busy} required className={inputClass} value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" placeholder="至少 8 个字符，最多 72 个 UTF-8 字节" /></label>
          <div className="flex gap-4 text-accent-light text-sm">
            <button disabled={busy} type="submit">登录</button>
            <button disabled={busy} type="button" onClick={() => void run(async () => {
              await cloud.register(username, password); setPassword(''); setMessage('注册成功，请重新输入密码登录。')
            })}>注册账号</button>
          </div>
        </form>}
        {user && <>
          <section className="ui-panel space-y-4">
            <div className="flex justify-between gap-3 text-sm text-primary"><span>当前云账号：{user.username}</span>
              <button className="text-accent-light" disabled={busy} onClick={() => void run(async () => {
                await cloud.logout(); setUser(null); setItems([]); setCursor(null); setIntent(null); setSelected(null); setStatistics(null); setConfirmed(false); setMessage('已退出，当前浏览器的训练记录保持原样。')
              })}>退出</button></div>
            <h2 className="font-semibold text-primary">上传已有备份文件</h2>
            <p className="text-sm text-muted">先从数据备份页导出 JSON，再选择文件。云备份不会自动同步训练；文件可能含训练照片。</p>
            <label className="block text-sm text-muted">JSON 文件<input disabled={busy} type="file" accept=".json,application/json" className="block w-full mt-2" onChange={event => void selectFile(event.target.files?.[0])} /></label>
            {intent && <>
              <p className="text-sm text-muted">动作 {intent.counts.exercises} · 模板 {intent.counts.templates} · 训练 {intent.counts.sessions} · 体重 {intent.counts.weights}</p>
              <label className="block text-sm text-muted">训练日期时区<input disabled={busy} className={inputClass} value={intent.timezone} onChange={event => {
                setIntent({ ...intent, timezone: event.target.value, key: crypto.randomUUID() }); setConfirmed(false)
              }} /></label>
              <label className="flex gap-2 text-sm text-primary"><input disabled={busy} type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />确认将此文件上传到 {user.username}</label>
              <button className="text-accent-light text-sm disabled:opacity-40" disabled={busy || !confirmed} onClick={() => void run(async () => {
                const result = await cloud.uploadBackup(intent.file, intent.timezone, intent.key, user.id)
                await loadPage(); setMessage(`备份已保存（${new Date(result.createdAt).toLocaleString()}），可下载原始文件。`)
              })}>{busy ? '处理中…' : '上传 / 重试本次上传'}</button>
            </>}
          </section>
          <section className="ui-panel space-y-4">
            <div className="flex justify-between text-primary"><h2 className="font-semibold">云备份版本</h2><button className="text-accent-light text-sm" disabled={busy} onClick={() => void run(() => loadPage())}>刷新</button></div>
            {items.length === 0 && <p className="text-sm text-muted">还没有云备份</p>}
            {items.map(item => <article key={item.id} className="border-t border-border pt-3 space-y-1">
              <p className="text-sm text-primary">{new Date(item.createdAt).toLocaleString()}</p>
              <p className="text-xs text-muted">训练 {item.sessionCount} · 体重 {item.weightCount} · {(item.sizeBytes / 1024).toFixed(1)} KiB · {item.timezone}</p>
              <p className="text-xs text-muted">{({ NOT_REQUESTED: '尚未申请分析', PROCESSING: '分析处理中', READY: '分析已就绪', FAILED: '分析失败，原始文件仍可下载' })[item.projectionStatus]}</p>
              {item.jobId && jobs[item.jobId] && <p className="text-xs text-muted">任务：{({ PENDING: '等待执行', RUNNING: '正在构建快照', RETRY_WAIT: '等待有限重试', SUCCEEDED: '已完成', FAILED: '已失败' })[jobs[item.jobId].status]} · 第 {jobs[item.jobId].attempts} 次尝试</p>}
              <button className="text-accent-light text-sm" disabled={busy} onClick={() => void run(() => cloud.downloadBackup(item.id))}>下载恢复文件</button>
              {['NOT_REQUESTED', 'FAILED'].includes(item.projectionStatus) && <button className="text-accent-light text-sm ml-4" disabled={busy} onClick={() => void run(async () => { await cloud.requestProjection(item.id); await loadPage(); setMessage('已提交分析任务，原始备份保持不变。') })}>{item.projectionStatus === 'FAILED' ? '重试分析' : '生成快照分析'}</button>}
              {item.projectionStatus === 'READY' && <button className="text-accent-light text-sm ml-4" disabled={busy} onClick={() => void run(() => analyze(item))}>查看快照分析</button>}
              {item.projectionStatus === 'FAILED' && item.jobId && <button className="text-accent-light text-sm ml-4" disabled={busy} onClick={() => void run(async () => { const job = await cloud.getJob(item.jobId!); setMessage(`分析失败：${job.errorCode || '未知原因'}。原文件仍可下载，允许有限次数重试。`) })}>查看失败原因</button>}
            </article>)}
            {cursor && <button className="text-accent-light text-sm" disabled={busy} onClick={() => void run(() => loadPage(cursor))}>加载更早版本</button>}
          </section>
          {selected && statistics && <section className="ui-panel space-y-4">
            <h2 className="font-semibold text-primary">快照分析</h2>
            <p className="text-xs text-muted">上传于 {new Date(selected.createdAt).toLocaleString()} · 时区 {statistics.timezone}</p>
            <p className="text-xs text-muted">数据覆盖 {statistics.coverage.dataFrom || '无记录'} 至 {statistics.coverage.dataTo || '无记录'}，后续本地训练不会自动更新此快照。</p>
            <div className="flex gap-2"><label className="text-xs text-muted flex-1">开始日期<input type="date" className={inputClass} value={from} onChange={event => setFrom(event.target.value)} /></label><label className="text-xs text-muted flex-1">结束日期<input type="date" className={inputClass} value={to} onChange={event => setTo(event.target.value)} /></label></div>
            <button className="text-accent-light text-sm" disabled={busy} onClick={() => void run(async () => { setStatistics(await cloud.statistics(selected.id, from, to)); setProgress(null) })}>更新统计范围</button>
            <dl className="grid grid-cols-2 gap-3 text-sm text-primary">
              <div><dt className="text-muted">训练次数 / 天数</dt><dd>{statistics.summary.trainingSessions} / {statistics.summary.trainingDays}</dd></div>
              <div><dt className="text-muted">有效组 / 容量</dt><dd>{statistics.summary.countedSets} / {statistics.summary.volume.toLocaleString()} kg·次</dd></div>
              <div><dt className="text-muted">力量 / 有氧次数</dt><dd>{statistics.summary.strengthSessions} / {statistics.summary.aerobicSessions}</dd></div>
              <div><dt className="text-muted">有氧距离 / 时长</dt><dd>{statistics.summary.aerobicDistance} km / {Math.round(statistics.summary.aerobicDuration / 60)} 分钟</dd></div>
            </dl>
            <p className="text-xs text-muted">仅已完成训练计入。热身不计有效组；部位天数按同日去重，与原统计页按 session 累加的口径不同。</p>
            <p className="text-sm text-primary">部位天数：{statistics.bodyParts.map(part => `${part.bodyPart} ${part.trainingDays}`).join(' · ') || '暂无'}</p>
            {statistics.weights.length > 0 && <p className="text-sm text-primary">期间最新体重：{statistics.weights.at(-1)!.weight} kg（{statistics.weights.at(-1)!.localDate}）</p>}
            {exercises.length > 0 && <>
              <label className="block text-sm text-muted">动作趋势<select className={inputClass} value={exerciseId} onChange={event => setExerciseId(event.target.value)}><option value="">选择动作</option>{exercises.map(exercise => <option key={exercise.sourceExerciseId} value={exercise.sourceExerciseId}>{exercise.exerciseName || exercise.sourceExerciseId} · {exercise.bodyPart}</option>)}</select></label>
              <button className="text-accent-light text-sm" disabled={busy || !exerciseId} onClick={() => void run(async () => setProgress(await cloud.exerciseProgress(selected.id, exerciseId, from, to)))}>查询动作趋势</button>
              {progress && <div className="max-h-48 overflow-auto text-xs text-muted">{progress.length === 0 ? '此范围没有有效组' : progress.map(point => <p key={point.localDate}>{point.localDate} · {point.countedSets} 组 · 容量 {point.volume} · 最大重量 {point.maxWeight} kg</p>)}</div>}
            </>}
            <CoachPanel key={`${user.id}:${selected.id}`} backupId={selected.id} userId={user.id} dataTo={statistics.coverage.dataTo} />
            <h3 className="text-sm font-semibold text-primary">完整快照中的已完成记录</h3>
            <div className="text-xs text-muted space-y-2">{sessions.map(session => <p key={session.sourceId}>{session.localDate} · {session.name || ({ STRENGTH: '力量', AEROBIC: '有氧', REST: '休息' })[session.kind as 'STRENGTH' | 'AEROBIC' | 'REST']} · {session.countedSets} 组 · 容量 {session.volume}</p>)}</div>
            {hasMoreSessions && <button className="text-accent-light text-sm" disabled={busy} onClick={() => void run(async () => { const next = await cloud.trainingSessions(selected.id, sessions.length); setSessions(previous => [...previous, ...next.items]); setHasMoreSessions(next.hasMore) })}>加载更多训练</button>}
          </section>}
        </>}
        <p className="text-sm text-muted">训练记录继续保存在当前浏览器。切换电脑或网址前，请先在数据备份页导出 JSON。</p>
      </div>
    </div>
  )
}
