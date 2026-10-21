import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Trash2, Edit3, X, ArrowUpRight, Layers } from 'lucide-react'
import { db } from '../db'
import Header from '../components/Header'
import { normalizeTemplate } from '../lib/template'
import { resetTemplateSetCounts, warmupCount } from '../lib/templateWorkout'
import type { WorkoutTemplate } from '../types'

export default function Templates() {
  const navigate = useNavigate()
  const templates = useLiveQuery(() => db.templates.toArray().then(rows => rows.map(normalizeTemplate)))
  const [editor, setEditor] = useState<{ id?: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const operation = useRef(false)
  useEffect(() => {
    if (editor) {
      if (!dialog.current?.open) { dialog.current?.showModal(); nameInput.current?.focus() }
    } else dialog.current?.close()
  }, [editor])
  const saveName = async () => {
    if (!editor?.name.trim() || operation.current) return
    operation.current = true
    setBusy(true)
    setMessage('')
    try {
      const id = editor.id ?? crypto.randomUUID()
      if (editor.id) {
        if (!await db.templates.update(id, { name: editor.name.trim() })) throw new Error('missing template')
      } else await db.templates.add({ id, name: editor.name.trim(), items: [] })
      setEditor(null)
      navigate(`/template/${id}`)
    } catch { setMessage('保存未完成，请重试。') }
    finally { operation.current = false; setBusy(false) }
  }
  const remove = async (template: WorkoutTemplate) => {
    if (!window.confirm(`删除模板“${template.name}”？已有训练记录会保留。`)) return
    try { await db.templates.delete(template.id) } catch { setMessage('删除未完成，请重试。') }
  }
  const resetCounts = async () => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    try { const count = await resetTemplateSetCounts(); setMessage(`已将 ${count} 个模板中的工作组设为 1，训练记录不变。`) }
    catch { setMessage('设置未完成，请重试。') }
    finally { operation.current = false; setBusy(false) }
  }
  return <div className="ui-page">
    <Header title="预设模板" showBack />
    <div className="content-width space-y-6 px-4 py-6 md:px-8">
      <div className="page-heading"><div><p className="ui-eyebrow">训练计划</p><h2>把常练的动作，整理成自己的节奏</h2><p>先调整动作与组数，准备好后再开始。</p></div><button className="ui-primary shrink-0" aria-label="新增模板" onClick={() => { setMessage(''); setEditor({ name: '' }) }}><Plus size={18} />新建模板</button></div>
      {message && <p role="status" className="ui-notice">{message}</p>}
      {!templates ? <p className="text-secondary">正在读取模板…</p> : !templates.length ? <section className="ui-panel py-12 text-center"><Layers size={32} className="mx-auto mb-4 text-accent-light" /><h3 className="text-lg font-semibold">建立你的第一个模板</h3><p className="mt-2 text-sm text-secondary">给它起个名字，再加入熟悉的动作。</p></section> :
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map((t, index) => <article key={t.id} className="plan-card">
          <div className="flex items-center justify-between"><span className="ui-eyebrow">计划 {String(index + 1).padStart(2, '0')}</span><div className="flex"><button className="ui-icon-button" aria-label={`编辑${t.name}名称与内容`} onClick={() => { setMessage(''); setEditor({ id: t.id, name: t.name }) }}><Edit3 size={16} /></button><button className="ui-icon-button text-red-500" aria-label={`删除模板${t.name}`} onClick={() => void remove(t)}><Trash2 size={16} /></button></div></div>
          <button className="flex flex-1 flex-col items-start text-left" aria-label={`预览${t.name}`} onClick={() => navigate(`/template/${t.id}`)}><h3 className="mt-2 text-xl font-semibold">{t.name}</h3><p className="mt-3 line-clamp-2 text-sm leading-6 text-secondary">{t.items.map(i => i.exerciseName).join(' · ') || '还没有动作，进入后添加'}</p><div className="mt-auto flex w-full items-center justify-between border-t border-border pt-4"><span className="text-xs text-secondary">{t.items.length} 动作 · {t.items.reduce((n, i) => n + i.defaultSets, 0)} 工作组 · {t.items.reduce((n, i) => n + warmupCount(i.warmupSets), 0)} 热身</span><ArrowUpRight size={20} className="text-accent-light" /></div></button>
        </article>)}</div>}
      <details className="ui-panel"><summary className="text-sm text-secondary">批量调整组数</summary><p className="my-3 text-sm text-secondary">将所有模板动作设为 1 个工作组，热身配置保留。</p><button className="ui-secondary" disabled={busy} onClick={() => void resetCounts()}>{busy ? '正在设置…' : '全部设为 1 个工作组'}</button></details>
    </div>
    <dialog ref={dialog} className="exercise-dialog" aria-labelledby="template-name-title" onCancel={e => { if (busy) e.preventDefault(); else setEditor(null) }} onClick={e => { if (e.target === e.currentTarget && !busy) setEditor(null) }}>
      <form className="space-y-5 p-6" onSubmit={e => { e.preventDefault(); void saveName() }}>
        <div className="flex items-center justify-between"><h2 id="template-name-title" className="text-xl font-semibold">{editor?.id ? '模板名称' : '新建预设模板'}</h2><button type="button" className="ui-icon-button" aria-label="关闭模板编辑" disabled={busy} onClick={() => setEditor(null)}><X size={20} /></button></div>
        <label className="block text-sm text-secondary">名称<input ref={nameInput} required maxLength={100} className="ui-input mt-2" placeholder="例如：胸部训练日" value={editor?.name ?? ''} onChange={e => setEditor(previous => previous ? { ...previous, name: e.target.value } : previous)} /></label>
        <p className="text-sm text-secondary">下一步选择动作，设置工作组、次数和热身组。</p>
        {message && <p role="alert" className="text-sm text-red-500">{message}</p>}
        <button type="submit" className="ui-primary w-full" disabled={busy || !editor?.name.trim()}>{busy ? '正在保存…' : '保存并编辑动作'}<ArrowUpRight size={18} /></button>
      </form>
    </dialog>
  </div>
}
