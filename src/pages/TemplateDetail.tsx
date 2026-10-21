import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Play, Plus, X, Check, GripVertical, Trash2 } from 'lucide-react'
import { db } from '../db'
import { BODY_PARTS, DEFAULT_REPS, DEFAULT_SETS, type BodyPart, type WorkoutTemplate, type TemplateItem } from '../types'
import Header from '../components/Header'
import { bodyPartMeta } from '../lib/bodyParts'
import { normalizeTemplate, stepItemCount } from '../lib/template'
import { clampRestSeconds, resolveRestSeconds } from '../lib/rest'
import RestField from '../components/RestField'
import SetRepStepper, { CountStepper } from '../components/SetRepStepper'
import { startTemplateSession, warmupCount, ensureTemplateExercise } from '../lib/templateWorkout'

// 拖拽调序的状态。列表行高一致，所以目标槽位可以直接由位移除以 step 算出来。
type DragMeta = {
  startY: number
  dy: number
  index: number
  target: number
  step: number
  count: number
}

// 键盘调序：一次一格。拖拽对键盘 / 读屏用户完全不可用，方向键是兜底。
const KEYBOARD_STEPS: Record<string, number> = { ArrowUp: -1, ArrowDown: 1 }

export default function TemplateDetail() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()
  const [template, setTemplate] = useState<WorkoutTemplate | null>(null)
  const [items, setItems] = useState<TemplateItem[]>([])
  const [starting, setStarting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const pendingWrites = useRef(0)
  const itemsRef = useRef<TemplateItem[]>([])
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const revision = useRef(0)
  const allExercises = useLiveQuery(() => db.exercises.toArray()) ?? []

  const [selectingExercise, setSelectingExercise] = useState(false)
  const [selectTab, setSelectTab] = useState<BodyPart>('肩')
  const [customName, setCustomName] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  // 拖动过程中的权威数据放 ref：pointerup 可能早于最后一次 pointermove 的
  // 重渲染落地，读 state 会拿到过期的 target。
  const dragMetaRef = useRef<DragMeta | null>(null)
  const [drag, setDrag] = useState<DragMeta | null>(null)
  // 键盘调序的播报文案。读屏用户看不到行位置变化，必须靠 aria-live 说出来。
  const [announce, setAnnounce] = useState('')

  useEffect(() => {
    if (templateId) {
      db.templates.get(templateId).then((raw) => {
        if (!raw) {
          navigate('/')
          return
        }
        // 缺 items 的模板（坏备份）在这里补成 []，否则 [...t.items] 会抛错
        const t = normalizeTemplate(raw)
        setTemplate(t)
        itemsRef.current = [...t.items]
        setItems(itemsRef.current)
      }).catch(() => setError('模板读取失败，请返回重试。'))
    }
  }, [templateId, navigate])

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (pendingWrites.current > 0) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  // 编辑即排队写入完整快照；串行提交，迟到的旧写入不能复活动作或覆盖组数。
  const editItems = (change: TemplateItem[] | ((previous: TemplateItem[]) => TemplateItem[])) => {
    if (starting || !templateId) return
    const next = typeof change === 'function' ? change(itemsRef.current) : change
    itemsRef.current = next
    setItems(next)
    setSaved(false)
    setError('')
    const currentRevision = ++revision.current
    pendingWrites.current += 1
    setSaving(true)
    saveQueue.current = saveQueue.current.then(async () => {
      const count = await db.templates.update(templateId, { items: next })
      if (!count) throw new Error('模板已不存在')
      if (revision.current === currentRevision) setSaved(true)
    }).catch(() => setError('模板保存失败，修改仍保留在本页，请重试保存。')).finally(() => {
      pendingWrites.current -= 1
      if (pendingWrites.current === 0) setSaving(false)
    })
  }

  const filteredExercises = allExercises.filter(e => e.bodyPart === selectTab && typeof e.name === 'string' && e.name.toLowerCase().includes(customName.trim().toLowerCase()))

  const addExercise = (exerciseId: string, exerciseName: string) => {
    if (items.some((i) => i.exerciseId === exerciseId)) return
    editItems(previous => previous.some(row => row.exerciseId === exerciseId) ? previous : [...previous, { exerciseId, exerciseName, defaultSets: DEFAULT_SETS, defaultReps: DEFAULT_REPS }])
    setSelectingExercise(false)
  }

  const addCustomExercise = async () => {
    const n = customName.trim()
    if (!n) return

    let exId: string
    try { exId = await ensureTemplateExercise(n, selectTab) }
    catch { setError('动作未能保存，请重试。'); return }
    setCustomName('')
    setSelectingExercise(false)
    if (items.some((i) => i.exerciseId === exId)) return
    editItems(previous => previous.some(row => row.exerciseId === exId) ? previous : [...previous, { exerciseId: exId, exerciseName: n, defaultSets: DEFAULT_SETS, defaultReps: DEFAULT_REPS }])
  }

  const removeItem = (idx: number) => {
    editItems(previous => previous.filter((_, i) => i !== idx))
  }

  // 工作组至少1组、次数至少1次；移除整项使用明确的移除动作按钮。
  const stepItem = (idx: number, field: 'defaultSets' | 'defaultReps', delta: number) => {
    editItems((prev) => {
      const item = prev[idx]
      if (!item) return prev
      const next = [...prev]
      next[idx] = { ...item, [field]: stepItemCount(field, item[field], delta) }
      return next
    })
  }

  // 组间歇走相同的串行保存入口。
  // 同 Templates.tsx：写入的只是「本模板显式覆盖」的值，不填则回落到动作库。
  const setRest = (idx: number, seconds: number) => {
    editItems((prev) => {
      const item = prev[idx]
      if (!item) return prev
      const next = [...prev]
      next[idx] = { ...item, restSeconds: clampRestSeconds(seconds) }
      return next
    })
  }

  const resetRest = (idx: number) => {
    editItems((prev) => {
      const item = prev[idx]
      if (!item) return prev
      const next = [...prev]
      next[idx] = { ...item, restSeconds: undefined }
      return next
    })
  }

  // ---- 拖拽调序（Pointer Events）----
  // 不能用 HTML5 drag-and-drop：移动端浏览器基本不触发。Pointer Events 触屏和鼠标通吃。
  // 只在手柄上监听 pointerdown，列表其余部分仍可正常滚动。
  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, idx: number) => {
    if (items.length < 2) return
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
    if (rows.length < 2) return

    // 量一次原始位置。transform 不影响布局，所以拖动期间这些值一直有效。
    const rects = rows.map((r) => r.getBoundingClientRect())
    const step = rects[1].top - rects[0].top
    if (!(step > 0)) return

    dragMetaRef.current = { startY: e.clientY, dy: 0, index: idx, target: idx, step, count: rows.length }
    setDrag(dragMetaRef.current)
    // 捕获指针，手指移出手柄范围后仍能收到 move / up
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const moveDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const meta = dragMetaRef.current
    if (!meta) return
    meta.dy = e.clientY - meta.startY
    // 行高一致，所以目标槽位可以直接由位移算出来
    meta.target = Math.max(0, Math.min(meta.count - 1, Math.round(meta.index + meta.dy / meta.step)))
    setDrag({ ...meta })
  }

  // 把 from 槽位的条目移到 to 槽位。越界或原地不动都直接返回原数组，
  // 免得白触发一次重渲染（也会白触发一次自动保存）。
  const moveItem = (from: number, to: number) => {
    editItems((prev) => {
      if (from === to || to < 0 || to >= prev.length || from < 0 || from >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const endDrag = () => {
    const meta = dragMetaRef.current
    dragMetaRef.current = null
    setDrag(null)
    if (!meta || meta.target === meta.index) return
    moveItem(meta.index, meta.target)
  }

  // 被系统手势打断时不要提交，直接还原
  const cancelDrag = () => {
    dragMetaRef.current = null
    setDrag(null)
  }

  // ---- 键盘调序 ----
  // 行的 key 是 exerciseId，重排时 React 会把同一个 DOM 节点搬到新位置，
  // 所以焦点自动跟着手柄走，可以按住方向键连续移动。
  const keyboardMove = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const delta = KEYBOARD_STEPS[e.key]
    if (delta === undefined) return
    e.preventDefault() // 否则方向键会把页面滚走
    const to = idx + delta
    const name = items[idx]?.exerciseName ?? '该动作'
    if (to < 0) {
      setAnnounce(`${name} 已经在最前面了`)
      return
    }
    if (to >= items.length) {
      setAnnounce(`${name} 已经在最后面了`)
      return
    }
    moveItem(idx, to)
    setAnnounce(`${name} 已移到第 ${to + 1} 位，共 ${items.length} 个动作`)
  }

  const startWorkout = async () => {
    if (starting || !template || !itemsRef.current.length) return
    setStarting(true)
    setError('')
    try {
      await saveQueue.current
      const id = await startTemplateSession(template.id, itemsRef.current)
      navigate(`/session/${id}`)
    } catch {
      setError('未能开始训练，模板编辑已保留，请重试。')
      setStarting(false)
    }
  }

  if (!template) {
    if (error) return <div className="p-6"><p role="alert">{error}</p><button className="ui-secondary mt-4" onClick={() => navigate('/')}>返回首页</button></div>
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  const exerciseById = new Map(allExercises.map((e) => [e.id, e]))
  const bodyPartCounts: Record<string, number> = {}
  for (const item of items) {
    const ex = exerciseById.get(item.exerciseId)
    if (ex) bodyPartCounts[ex.bodyPart] = (bodyPartCounts[ex.bodyPart] || 0) + 1
  }
  const bp = Object.entries(bodyPartCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '肩'
  const meta = bodyPartMeta(bp)
  const Icon = meta.icon

  return (
    <div className="template-preview">
      <Header
        title={template.name}
        showBack
        rightAction={
          saving ? <span role="status" className="text-xs text-secondary">保存中…</span> : saved ? (
            <span className="flex items-center gap-1 text-accent-light text-xs font-medium">
              <Check size={13} />
              已保存
            </span>
          ) : undefined
        }
      />

      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        {error && <div role="alert" className="mb-4 text-sm text-red-500">{error}<button className="ui-secondary ml-2" onClick={() => editItems(itemsRef.current)}>重试保存</button></div>}
        <section className="plan-overview">
          <span className="plan-symbol"><Icon size={26} /></span>
          <div className="min-w-0"><p className="ui-eyebrow">预设模板 · {bp}</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">{template.name}</h2><p className="mt-2 text-sm text-secondary">调整自动保存</p></div>
          <div className="plan-totals"><div><strong>{items.length}</strong><span>动作</span></div><div><strong>{items.reduce((n, i) => n + i.defaultSets, 0)}</strong><span>工作组</span></div><div><strong>{items.reduce((n, i) => n + warmupCount(i.warmupSets), 0)}</strong><span>热身组</span></div></div>
        </section>

        {/* Section header */}
        <div className="flex items-center justify-between mt-7 mb-3 px-0.5">
          <h3 className="text-muted text-[11px] font-semibold tracking-widest">动作列表</h3>
          <span className="text-muted text-[11px]">拖动排序 · 修改自动保存</span>
        </div>

        {/* Exercise list */}
        <div ref={listRef} className={`space-y-4 ${drag ? 'select-none' : ''}`}>
          {items.map((item, idx) => {
            const ex = exerciseById.get(item.exerciseId)
            
            const isDragging = drag?.index === idx
            // 起点与目标槽位之间的行让位：整体上移或下移一格。
            let shift = 0
            if (drag && !isDragging) {
              if (drag.index < drag.target && idx > drag.index && idx <= drag.target) shift = -drag.step
              else if (drag.index > drag.target && idx >= drag.target && idx < drag.index) shift = drag.step
            }
            // 序号要显示「松手后会落在第几位」，显示当前位置会骗人
            const shownIdx = isDragging ? drag.target : shift < 0 ? idx - 1 : shift > 0 ? idx + 1 : idx
            return (
              <div
                key={item.exerciseId}
                data-row
                className={`plan-exercise border ${
                  isDragging
                    ? 'bg-surface-2 border-accent/40 shadow-raised'
                    : 'bg-surface-1 border-border shadow-card'
                }`}
                style={{
                  // 拖拽用 transform，不动布局，所以量到的行位置在整个拖动过程中都成立
                  transform: isDragging ? `translateY(${drag.dy}px)` : shift ? `translateY(${shift}px)` : undefined,
                  transition: isDragging ? 'none' : 'transform 160ms ease',
                  zIndex: isDragging ? 10 : undefined,
                  position: isDragging ? 'relative' : undefined,
                }}
              >
                {/* 入场动画放在内层：animate-fade-in 的 fill-mode 会一直占着
                    transform，放在外层会把拖拽的 translateY 顶掉 */}
                <div
                  className="flex flex-wrap items-center gap-2 p-4"
                  style={{ animationDelay: `${Math.min(idx, 8) * 0.03}s` }}
                >
                  <button
                    type="button"
                    onPointerDown={(e) => startDrag(e, idx)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                    onKeyDown={(e) => keyboardMove(e, idx)}
                    aria-label={`调整 ${item.exerciseName} 的顺序，第 ${idx + 1} 个，共 ${items.length} 个。方向键上下移动`}
                    className="ui-icon-button shrink-0 text-muted active:text-secondary cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    style={{ touchAction: 'none' }}
                  >
                    <GripVertical size={16} />
                  </button>
                  <span className="text-sm font-semibold text-accent-light shrink-0 tabular-nums">{shownIdx + 1}</span>
                  <span className="flex-1 min-w-24 text-primary text-base font-semibold">{item.exerciseName}</span>
                  {ex && <span className="text-xs text-secondary">{ex.bodyPart}</span>}
                  <button
                    onClick={() => removeItem(idx)}
                    aria-label={`删除 ${item.exerciseName}`}
                    className="ui-icon-button shrink-0 text-secondary"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="border-t border-border p-4 space-y-4">
                  <SetRepStepper
                    sets={item.defaultSets}
                    reps={item.defaultReps}
                    onStep={(f, d) => stepItem(idx, f, d)}
                  />
                  <div className="warmup-field"><div><span className="text-sm font-medium">热身组</span><p className="mt-1 text-xs text-secondary">不计训练容量</p></div><CountStepper label="热身组" value={warmupCount(item.warmupSets)} minimum={0} maximum={10} onStep={delta => editItems(prev => prev.map((row, i) => i === idx ? { ...row, warmupSets: warmupCount(row.warmupSets) + delta } : row))} /></div>
                  <RestField
                    value={resolveRestSeconds(item, allExercises.find((e) => e.id === item.exerciseId))}
                    overridden={typeof item.restSeconds === 'number'}
                    onChange={(s) => setRest(idx, s)}
                    onReset={() => resetRest(idx)}
                  />
                </div>
              </div>
            )
          })}

          {items.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-secondary text-sm">还没有动作</p>
              <p className="text-muted text-xs mt-1">点击下方按钮添加</p>
            </div>
          )}

          <button
            onClick={() => setSelectingExercise(true)}
            className="ui-secondary w-full border border-dashed border-accent/40 text-accent-light"
          >
            <Plus size={16} />
            添加动作
          </button>
        </div>

        {/* 键盘调序的结果读屏看不到，靠这里播报。视觉上隐藏，但仍会被读屏朗读。 */}
        <div aria-live="polite" role="status" className="sr-only">
          {announce}
        </div>
      </div>

      <div className="template-start-bar">
        <button
          onClick={startWorkout}
          disabled={starting || items.length === 0}
          className="ui-primary w-full"
        >
          <Play size={18} fill="currentColor" />
          {starting ? '启动中...' : '开始训练'}
        </button>
      </div>

      {selectingExercise && (
        <div className="exercise-picker fixed inset-0 z-50 bg-surface-0 flex flex-col animate-fade-in">
          <div className="mx-auto flex w-full max-w-lg items-center justify-between px-4 h-14 border-b border-border bg-surface-0/80 backdrop-blur-xl">
            <h3 className="text-primary font-semibold">选择动作</h3>
            <button onClick={() => { setSelectingExercise(false); setCustomName('') }} className="ui-icon-button" aria-label="关闭动作选择">
              <X size={22} className="text-secondary" />
            </button>
          </div>

          <div className="mx-auto w-full max-w-lg px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomExercise()}
                aria-label="搜索或新增模板动作" placeholder="搜索或新增动作"
                className="min-w-0 flex-1 bg-surface-2 text-primary px-4 py-2.5 rounded-xl text-sm outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted"
              />
              <button
                onClick={addCustomExercise}
                disabled={!customName.trim()}
                className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center active:bg-accent/20 disabled:opacity-30"
              >
                <Check size={18} className="text-accent-light" />
              </button>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-lg flex-wrap gap-2 px-4 py-3 border-b border-border no-scrollbar">
            {BODY_PARTS.map((b) => (
              <button
                key={b}
                onClick={() => setSelectTab(b)}
                className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  selectTab === b
                    ? 'bg-accent text-white'
                    : 'bg-surface-1 text-secondary border border-border'
                }`}
              >
                {b}
              </button>
            ))}
          </div>

          <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 py-3">
            {filteredExercises.map((ex) => {
              const disabled = items.some((i) => i.exerciseId === ex.id)
              const m = bodyPartMeta(ex.bodyPart)
              const ExIcon = m.icon
              return (
                <button
                  key={ex.id}
                  onClick={() => addExercise(ex.id, ex.name)}
                  disabled={disabled}
                  className="w-full flex items-center gap-3 text-left p-3.5 bg-surface-1 rounded-2xl mb-2 disabled:opacity-30 active:bg-surface-2 border border-border shadow-card tap-soft"
                >
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${m.soft}`}>
                    <ExIcon size={15} className={m.text} />
                  </span>
                  <span className="text-primary text-sm font-medium flex-1">{ex.name}</span>
                  {disabled && <Check size={15} className="text-accent" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
