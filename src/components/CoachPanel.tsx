import { useEffect, useRef, useState } from 'react'
import * as agent from '../api/assistant'
import { currentUser } from '../api/cloud'
import { getServiceStatus } from '../api/status'
import { db } from '../db'
import { applyAgentPlan } from '../lib/applyAgentPlan'

export default function CoachPanel({ backupId, userId, dataTo }: { backupId: string; userId: string; dataTo: string | null }) {
  const [catalog, setCatalog] = useState<agent.AvailableExercise[]>([])
  const [allowed, setAllowed] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(dataTo || '')
  const [days, setDays] = useState(3)
  const [minutes, setMinutes] = useState(60)
  const [consent, setConsent] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [run, setRun] = useState<agent.CoachRun | null>(null)
  const [draft, setDraft] = useState<agent.PlanDraft | null>(null)
  const [lookup, setLookup] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('正在读取快照动作库…')
  const mounted = useRef(false)
  const intent = useRef<{ json: string; key: string } | null>(null)
  const inputClass = 'ui-input mt-2'
  useEffect(() => {
    mounted.current = true
    let disposed = false
    const controller = new AbortController()
    void Promise.all([agent.availableExercises(backupId), getServiceStatus(controller.signal)]).then(([items, status]) => {
      if (disposed) return
      setCatalog(items); setConfigured(status.capabilities.assistant)
      setMessage(status.capabilities.assistant ? '请选择用于生成计划的动作和复盘日期。' : '教练模型尚未配置，云备份和快照分析仍可使用。')
    }).catch(() => { if (!disposed) setMessage('读取教练服务失败，请重新选择快照。') })
    return () => { disposed = true; mounted.current = false; controller.abort() }
  }, [backupId])
  const active = run?.status === 'PENDING' || run?.status === 'RUNNING'
  const runId = run?.id
  useEffect(() => {
    if (!runId || !active) return
    let disposed = false
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const next = await agent.getRun(runId)
        const plan = next.result ? await agent.getDraft(next.result.draftId) : null
        if (!disposed) { setRun(next); if (plan) setDraft(plan) }
      } catch (error) { if (!disposed) setMessage(error instanceof Error ? error.message : '任务状态查询失败，可再次获取任务') }
      finally { pending = false }
    }
    const timer = window.setInterval(() => void refresh(), 2000)
    void refresh()
    return () => { disposed = true; window.clearInterval(timer) }
  }, [runId, active])
  async function action(task: () => Promise<void>) {
    setBusy(true)
    try { await task() } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : '请求失败') }
    finally { if (mounted.current) setBusy(false) }
  }
  async function loadRun(id: string) {
    const next = await agent.getRun(id)
    if (next.backupId !== backupId) throw new Error('此任务属于其他快照，请先选择对应备份')
    const plan = next.result ? await agent.getDraft(next.result.draftId) : null
    if (mounted.current) { setRun(next); setDraft(plan) }
  }
  return <section className="border-t border-border pt-4 space-y-3">
    <h3 className="font-semibold text-primary">教练计划草案</h3>
    <p role="status" className="text-sm text-muted">{message}</p>
    <p className="text-xs text-muted">根据这份快照比较所选期间与前一等长期间，生成下周计划。记录缺失不代表没有训练，建议需自行判断。</p>
    <div className="flex gap-2"><label className="flex-1 text-xs text-muted">复盘开始<input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></label><label className="flex-1 text-xs text-muted">复盘结束<input type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></label></div>
    <div className="flex gap-2"><label className="flex-1 text-xs text-muted">下周训练天数<input type="number" min={1} max={7} className={inputClass} value={days} onChange={e => setDays(Number(e.target.value))} /></label><label className="flex-1 text-xs text-muted">每次最多分钟<input type="number" min={15} max={120} className={inputClass} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></label></div>
    <p className="text-xs text-muted">允许使用的动作（来自完整快照动作库，最多选 30 个）</p>
    <div className="max-h-48 overflow-auto space-y-2">{catalog.map(ex => <label key={ex.id} className="flex gap-2 text-sm text-primary"><input type="checkbox" checked={allowed.includes(ex.id)} disabled={!allowed.includes(ex.id) && allowed.length >= 30} onChange={e => setAllowed(previous => e.target.checked ? [...previous, ex.id] : previous.filter(id => id !== ex.id))} />{ex.name} · {ex.bodyPart}</label>)}</div>
    <label className="flex gap-2 text-xs text-muted"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />我同意向 DeepSeek 发送所选动作名称和必要训练统计；不发送照片、备注或完整备份。生成会产生模型调用费用。</label>
    <button className="ui-primary w-full" disabled={busy || active || !configured || !consent || !allowed.length || !from || !to} onClick={() => void action(async () => {
      const request: agent.CoachRequest = { backupId, from, to, days, minutes, allowedExerciseIds: allowed, consent }
      const json = JSON.stringify(request)
      if (intent.current?.json !== json) intent.current = { json, key: crypto.randomUUID() }
      const next = await agent.createRun(request, intent.current.key)
      if (mounted.current) { setRun(next); setDraft(null); setLookup(next.id); setMessage('已提交。相同输入重试会复用任务，不重复扣费请求。') }
    })}>{active ? '教练任务处理中…' : '生成 / 重试提交本次计划'}</button>
    <div className="flex gap-2"><input aria-label="已有教练任务编号" className={inputClass} value={lookup} onChange={e => setLookup(e.target.value)} placeholder="任务编号，可在刷新后重新获取" /><button disabled={busy || !lookup} className="ui-secondary shrink-0" onClick={() => void action(() => loadRun(lookup))}>获取任务</button></div>
    {run && <div className="text-xs text-muted space-y-1"><p className="break-all">任务编号：{run.id}</p><p>状态：{run.status} · 模型请求 {run.usage.modelCalls} 次 · 工具 {run.usage.toolCalls} 次</p>{run.status === 'FAILED' && <p>失败原因：{run.errorCode}。不会自动重复付费调用；修改约束后可创建新任务。</p>}</div>}
    {run?.status === 'FAILED' && <button className="text-accent-light text-sm" disabled={busy} onClick={() => { intent.current = null; setRun(null); setDraft(null); setMessage('已准备新的提交。再次点击生成会创建新任务，可能再次计费。') }}>准备新任务（可能再次计费）</button>}
    {run?.result && <div className="text-sm text-primary"><p>复盘期间：训练 {run.result.evidence.recent.summary.trainingSessions} 次，容量 {run.result.evidence.recent.summary.volume} kg·次</p><p>前一等长期间：训练 {run.result.evidence.previous.summary.trainingSessions} 次，容量 {run.result.evidence.previous.summary.volume} kg·次</p><p className="text-xs text-muted">上述数字由服务端统计，计划由模型建议并通过规则校验。</p></div>}
    {draft && <div className="space-y-3">{draft.payload.templates.map((template, i) => <article key={template.id} className="text-sm text-primary"><p className="font-semibold">{i + 1}. {template.name} · 估算 {draft.payload.estimatedMinutes[i]} 分钟</p>{template.items.map(item => <p key={item.exerciseId}>{item.exerciseName} · {item.defaultSets} × {item.defaultReps} · 间歇 {item.restSeconds} 秒</p>)}</article>)}<p className="text-xs text-muted">{draft.payload.estimateAssumptions}</p>
      <button disabled={busy} className="text-accent-light text-sm" onClick={() => void action(async () => {
        const confirmed = await agent.confirmDraft(draft.id)
        if (!mounted.current) return
        setDraft(confirmed)
        const account = await currentUser()
        if (!mounted.current) return
        if (account?.id !== userId) throw new Error('云账号已变化，请重新登录并获取草案')
        const count = await applyAgentPlan(db, confirmed)
        if (mounted.current) setMessage(count ? `已新增 ${count} 个本地模板，可前往模板页查看。` : '此计划已应用，保留你之后对模板的编辑。')
      })}>{draft.status === 'CONFIRMED' ? '重新应用到本地（已有模板不会覆盖）' : '确认计划并添加到本地模板'}</button>
    </div>}
  </section>
}
