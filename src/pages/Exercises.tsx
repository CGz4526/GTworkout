import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search, Plus, ChevronRight, Dumbbell, X, Timer, Trash2 } from 'lucide-react'
import { db } from '../db'
import { BODY_PARTS, DEFAULT_REST_SECONDS, type Exercise } from '../types'
import { clampRestSeconds, formatRest } from '../lib/rest'
import Header from '../components/Header'
import RestField from '../components/RestField'

export default function Exercises() {
  const all = useLiveQuery(() => db.exercises.toArray())
  const [part, setPart] = useState('全部')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [formPart, setFormPart] = useState<string>('肩')
  const [rest, setRest] = useState(DEFAULT_REST_SECONDS)
  const [tips, setTips] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  const rows = (all ?? []).filter(e => (part === '全部' || e.bodyPart === part) && typeof e.name === 'string' && e.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  const edit = (exercise?: Exercise) => {
    setEditingId(exercise?.id ?? null)
    setName(exercise?.name ?? '')
    setFormPart(exercise?.bodyPart ?? (part === '全部' ? '肩' : part))
    setRest(clampRestSeconds(exercise?.restSeconds))
    setTips(exercise?.description ?? '')
    setError('')
    setOpen(true)
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const fields = { name: name.trim(), bodyPart: formPart, restSeconds: clampRestSeconds(rest), description: tips.trim().slice(0, 200) || undefined }
      if (editingId) {
        const updated = await db.exercises.update(editingId, fields)
        if (!updated) throw new Error('动作已不存在')
      } else await db.exercises.add({ id: crypto.randomUUID(), ...fields, createdAt: Date.now() })
      setOpen(false)
    } catch { setError('保存失败，填写内容已保留，请重试。') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!editingId || busy || !window.confirm('从动作库删除这个动作？已有训练记录和模板内容会保留。')) return
    setBusy(true)
    try { await db.exercises.delete(editingId); setOpen(false) }
    catch { setError('删除未完成，请重试。') }
    finally { setBusy(false) }
  }
  return <div className="ui-page">
    <Header title="动作库" showBack />
    <div className="content-width px-4 py-6 md:px-8">
      <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">找到下一组动作</h2><p className="mt-2 text-sm text-secondary">本机动作库 · 保留原有动作与身体部位分类</p></div><button className="ui-primary shrink-0" onClick={() => edit()}><Plus size={18} /><span className="hidden sm:inline">新增动作</span><span className="sr-only sm:hidden">新增动作</span></button></div>
      <label className="mb-5 flex min-h-12 items-center gap-3 rounded-xl border border-border bg-surface-1 px-4"><Search size={18} className="shrink-0 text-secondary" /><span className="sr-only">搜索动作</span><input aria-label="搜索动作" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索动作名称" className="min-w-0 flex-1 bg-transparent py-3 outline-none" />{search && <button type="button" aria-label="清除搜索" className="min-h-11 min-w-11" onClick={() => setSearch('')}><X size={16} /></button>}</label>
      <div className="exercise-library-layout">
        <nav aria-label="动作部位分类" className="exercise-categories">{['全部', ...BODY_PARTS].map(p => <button key={p} className={`exercise-category ${part === p ? 'exercise-category-active' : ''}`} aria-pressed={part === p} onClick={() => setPart(p)}><span>{p}</span><span className="text-xs tabular-nums">{p === '全部' ? all?.length ?? 0 : all?.filter(e => e.bodyPart === p).length ?? 0}</span></button>)}</nav>
        <section className="min-w-0"><div className="mb-3 flex items-center justify-between text-sm"><h3 className="font-semibold">{part === '全部' ? '全部动作' : part + '部动作'}</h3><span className="text-secondary">{rows.length} 个</span></div>
          {!all ? <p className="py-12 text-center text-secondary">正在读取动作库…</p> : rows.length ? <div className="grid gap-3 xl:grid-cols-2">{rows.map(e => <button key={e.id} className="exercise-row" onClick={() => edit(e)} aria-label={`查看编辑${e.name}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-light"><Dumbbell size={18} /></span><span className="min-w-0 flex-1"><span className="block font-medium">{e.name}</span><span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-secondary"><span>{e.bodyPart}</span><span aria-hidden="true">·</span><Timer size={12} /><span>{formatRest(e.restSeconds)}</span></span>{e.description && <span className="mt-2 block truncate text-xs text-secondary">{e.description}</span>}</span><ChevronRight size={17} className="shrink-0 text-muted" /></button>)}</div> : <div className="ui-panel py-12 text-center"><p className="text-secondary">{search ? '没有匹配的动作' : '这个部位还没有动作'}</p><button className="mt-3 min-h-11 text-sm text-accent-light" onClick={() => edit()}>新增动作 →</button></div>}
        </section>
      </div>
    </div>
    <dialog ref={dialog} className="exercise-dialog" aria-labelledby="exercise-editor-title" onCancel={e => { if (busy) e.preventDefault(); else setOpen(false) }}>
      <form onSubmit={save} className="space-y-5 p-5">
        <div className="flex items-center justify-between"><h2 id="exercise-editor-title" className="ui-section-title">{editingId ? '动作详情与编辑' : '新增动作'}</h2><button type="button" aria-label="关闭动作编辑" className="ui-secondary" disabled={busy} onClick={() => setOpen(false)}><X size={18} /></button></div>
        <label className="block text-sm text-secondary">动作名称<input autoFocus aria-label="动作名称" required maxLength={100} value={name} onChange={e => setName(e.target.value)} disabled={busy} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface-2 px-3 text-primary" /></label>
        <label className="block text-sm text-secondary">身体部位<select aria-label="动作身体部位" value={formPart} onChange={e => setFormPart(e.target.value)} disabled={busy} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface-2 px-3 text-primary">{BODY_PARTS.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
        <div className="rounded-xl border border-border p-3"><RestField value={rest} overridden onChange={setRest} /></div>
        <label className="block text-sm text-secondary">动作要点 · 可选<textarea aria-label="动作要点" value={tips} maxLength={200} onChange={e => setTips(e.target.value)} rows={3} disabled={busy} className="mt-2 w-full resize-none rounded-xl border border-border bg-surface-2 p-3 text-primary" /></label>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4"><button type="submit" className="ui-primary flex-1" disabled={busy || !name.trim()}>{busy ? '处理中…' : '保存动作'}</button><button type="button" className="ui-secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button>{editingId && <button type="button" className="ui-secondary text-red-500" disabled={busy} onClick={remove}><Trash2 size={16} />删除</button>}</div>
      </form>
    </dialog>
  </div>
}
