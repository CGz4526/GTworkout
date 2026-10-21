import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Play, Dumbbell, ChevronRight, Activity, Coffee, X } from 'lucide-react'
import { db } from '../db'
import { normalizeTemplate } from '../lib/template'
import { CLIMB_CHOICES } from '../lib/aerobic'
import Header from '../components/Header'
import DailyWeight from '../components/DailyWeight'

export default function Home() {
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.templates.toArray().then(all => all.map(normalizeTemplate)))
  const active = useLiveQuery(() => db.sessions.filter(s => !s.finished).first())
  const [choosing, setChoosing] = useState(false)
  const startDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (choosing) startDialog.current?.showModal()
    else startDialog.current?.close()
  }, [choosing])
  const [busy, setBusy] = useState(false)
  const starting = useRef(false)
  const [error, setError] = useState('')

  const run = async (operation: () => Promise<void>) => {
    if (starting.current) return
    starting.current = true
    setBusy(true)
    setError('')
    try { await operation() } catch { setError('操作未完成，请重试；已有记录保持不变。') }
    finally { starting.current = false; setBusy(false) }
  }
  const resume = async () => {
    const existing = await db.sessions.filter(s => !s.finished).first()
    if (!existing) return false
    navigate(`/session/${existing.id}`)
    return true
  }
  const startOther = (name: string, rest = false) => run(async () => {
    if (await resume()) return
    const id = crypto.randomUUID()
    await db.transaction('rw', db.sessions, async () => {
      const existing = await db.sessions.filter(s => !s.finished).first()
      if (existing) { navigate(`/session/${existing.id}`); return }
      await db.sessions.add({ id, templateName: name, date: new Date().toISOString(), duration: 0, exercises: [],
        finished: rest, ...(rest ? {} : { aerobic: true, startTime: Date.now() }) })
      navigate(rest ? `/session-detail/${id}` : `/session/${id}`)
    })
  })
  const personal = templates?.filter(t => !t.id.startsWith('quick-preset-')) ?? []

  return <div className="ui-page">
    <Header title="训练" rightAction={<button className="ui-secondary" onClick={() => navigate('/account-training')}>账号训练</button>} />
    <div className="content-width space-y-6 px-4 py-6 md:px-8">
      <div><p className="text-sm text-secondary">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })} · 本机训练</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight">今天，练什么？</h2>
        <p className="mt-2 text-sm text-secondary">从熟悉的模板开始，按自己的节奏记录。</p></div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
      <section className="ui-panel flex flex-col justify-center">
        {active ? <><p className="mb-3 text-sm text-secondary">进行中 · {active.templateName || '自由训练'}</p><button className="ui-primary w-full" onClick={() => navigate(`/session/${active.id}`)}><Play size={18} />继续训练</button></> :
          <div className="flex gap-2"><button className="ui-primary flex-1" disabled={busy || !templates} onClick={() => setChoosing(true)}><Play size={18} />开始训练</button><button className="ui-secondary" onClick={() => navigate('/exercises')}><Dumbbell size={18} />动作库</button></div>}
        <p className="mt-3 text-xs text-secondary">这里记录在本机；需要训练上云，请进入顶部“账号训练”。</p>
      </section>
      <DailyWeight />
      </div>
      <section>
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="ui-section-title">预设模板</h2><button className="min-h-11 text-sm text-accent-light" onClick={() => navigate('/templates')}>管理模板</button></div>
        <p className="mb-3 text-xs text-secondary">使用你的模板 · 先预览、调整，再开始训练</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {personal.map(t => <button key={t.id} className="flex min-h-28 flex-col items-start justify-between gap-3 rounded-2xl border border-border bg-surface-1 p-4 text-left transition-colors hover:border-accent/40" onClick={() => navigate(`/template/${t.id}`)} aria-label={`预览${t.name}`}>
            <span className="flex w-full items-center justify-between gap-2"><span className="font-semibold">{t.name}</span><ChevronRight size={16} className="shrink-0 text-muted" /></span>
            <span className="text-xs leading-5 text-secondary">{t.items.length} 个动作 · {t.items.reduce((n, i) => n + i.defaultSets, 0)} 个工作组</span>
          </button>)}
        </div>
        {templates && !personal.length && <div className="ui-panel text-sm text-secondary">还没有自己的模板。<button className="ml-2 min-h-11 text-accent-light" onClick={() => navigate('/templates')}>新建模板 →</button></div>}
      </section>
    </div>
    <dialog ref={startDialog} aria-labelledby="start-title" className="start-dialog" onCancel={e => { if (busy) e.preventDefault(); else setChoosing(false) }} onClick={e => { if (e.target === e.currentTarget && !busy) setChoosing(false) }}>
      <section className="w-full max-w-lg rounded-t-3xl bg-surface-1 p-5 pb-8 animate-sheet-up" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape' && !busy) setChoosing(false) }}>
        <div className="mb-4 flex items-center justify-between"><h2 id="start-title" className="ui-section-title">开始训练</h2><button autoFocus className="ui-secondary" aria-label="关闭开始训练" disabled={busy} onClick={() => setChoosing(false)}><X size={18} /></button></div>
        <button className="ui-primary mb-4 w-full" disabled={busy} onClick={() => run(async () => { if (!await resume()) navigate('/pre-workout') })}><Dumbbell size={18} />自由力量训练</button>
        <p className="mb-2 text-sm text-secondary">有氧训练</p><div className="grid grid-cols-2 gap-2">{['跑步', '游泳', '羽毛球', ...CLIMB_CHOICES].map(name => <button key={name} className="ui-secondary" disabled={busy} onClick={() => startOther(name)}><Activity size={16} />{name}</button>)}</div>
        <button className="mt-4 flex min-h-11 items-center gap-2 text-sm text-secondary" disabled={busy} onClick={() => startOther('休息日', true)}><Coffee size={16} />记录休息日</button>
        {error && <p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
      </section>
    </dialog>
  </div>
}
