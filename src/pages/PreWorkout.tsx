import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Play, Trash2, X, Check } from 'lucide-react'
import { db } from '../db'
import { BODY_PARTS, DEFAULT_REPS, DEFAULT_SETS, type BodyPart, type ExerciseRecord, type TemplateItem } from '../types'
import Header from '../components/Header'
import { type CountField, stepItemCount } from '../lib/template'
import { bodyPartMeta } from '../lib/bodyParts'
import { clampRestSeconds, resolveRestSeconds } from '../lib/rest'
import RestField from '../components/RestField'
import SetRepStepper from '../components/SetRepStepper'

export default function PreWorkout() {
  const navigate = useNavigate()
  const allExercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  const [items, setItems] = useState<TemplateItem[]>([])
  const [selectingExercise, setSelectingExercise] = useState(false)
  const [selectTab, setSelectTab] = useState<BodyPart>('肩')
  const [starting, setStarting] = useState(false)
  const [customName, setCustomName] = useState('')

  const filteredExercises = allExercises.filter((e) => e.bodyPart === selectTab)

  const addExercise = (exerciseId: string) => {
    if (items.some((i) => i.exerciseId === exerciseId)) return
    const ex = allExercises.find((e) => e.id === exerciseId)
    setItems([...items, { exerciseId, exerciseName: ex?.name ?? '未知动作', defaultSets: DEFAULT_SETS, defaultReps: DEFAULT_REPS }])
    setSelectingExercise(false)
  }

  const addCustomExercise = async () => {
    const name = customName.trim()
    if (!name) return

    const id = crypto.randomUUID()
    const existing = await db.exercises.toArray()
    const nameExists = existing.find((e) => e.name === name && e.bodyPart === selectTab)
    if (!nameExists) {
      await db.exercises.add({ id, name, bodyPart: selectTab, createdAt: Date.now() })
    }

    setItems([...items, { exerciseId: nameExists?.id ?? id, exerciseName: name, defaultSets: DEFAULT_SETS, defaultReps: DEFAULT_REPS }])
    setCustomName('')
    setSelectingExercise(false)
  }

  const updateItem = (idx: number, field: CountField, delta: number) => {
    setItems(
      items.map((item, i) =>
        i === idx
          ? { ...item, [field]: stepItemCount(field, item[field], delta) }
          : item
      )
    )
  }

  // 同 Templates.tsx：不填则回落到动作库的值，所以写入的只是「本次覆盖」。
  const setRest = (idx: number, seconds: number) => {
    setItems(
      items.map((item, i) =>
        i === idx ? { ...item, restSeconds: clampRestSeconds(seconds) } : item
      )
    )
  }

  const resetRest = (idx: number) => {
    setItems(items.map((item, i) => (i === idx ? { ...item, restSeconds: undefined } : item)))
  }

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx))
  }

  const startWorkout = async () => {
    if (starting || items.length === 0) return
    setStarting(true)

    const existing = await db.sessions.filter((s) => !s.finished).first()
    if (existing) {
      navigate(`/session/${existing.id}`)
      return
    }

    const session = {
      id: crypto.randomUUID(),
      templateName: '自由训练',
      date: new Date().toISOString(),
      duration: 0,
      exercises: [] as ExerciseRecord[],
      finished: false,
      startTime: Date.now(),
    }

    await db.sessions.add(session)
    sessionStorage.setItem(`preset-${session.id}`, JSON.stringify(items))
    navigate(`/session/${session.id}`)
  }

  return (
    <div className="ui-page template-preview">
      <Header title="自由训练" showBack />

      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
        {items.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-secondary text-sm">今天想练什么？从下方添加动作开始。</p>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {items.map((item, idx) => {
              const m = bodyPartMeta(allExercises.find((e) => e.id === item.exerciseId)?.bodyPart ?? '肩')
              const ItemIcon = m.icon
              return (
                <div
                  key={item.exerciseId}
                  className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card animate-pop-in"
                  style={{ animationDelay: `${Math.min(idx, 8) * 0.04}s` }}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.soft}`}>
                      <ItemIcon size={14} className={m.text} />
                    </span>
                    <span className="flex-1 min-w-0 text-primary text-sm font-medium truncate">{item.exerciseName}</span>
                    <button onClick={() => removeItem(idx)} aria-label={`删除 ${item.exerciseName}`} className="p-2 rounded-lg text-muted active:text-red-400 active:bg-red-500/10 tap"><Trash2 size={15} /></button>
                  </div>
                  <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-2.5">
                    <SetRepStepper
                      sets={item.defaultSets}
                      reps={item.defaultReps}
                      onStep={(f, d) => updateItem(idx, f, d)}
                    />
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
          </div>
        )}

        <button
          onClick={() => setSelectingExercise(true)}
          className="ui-secondary w-full border border-dashed border-accent/30 text-accent-light"
        >
          + 添加动作
        </button>
      </div>

      {selectingExercise && (
        <div className="exercise-picker fixed inset-0 z-50 bg-surface-0 flex justify-center animate-fade-in">
          <div className="picker-content flex h-full w-full max-w-2xl flex-col">
          <div className="flex items-center justify-between px-4 h-14 border-b border-border bg-surface-0/80 backdrop-blur-xl">
            <h3 className="text-primary font-semibold">选择动作</h3>
            <button onClick={() => { setSelectingExercise(false); setCustomName('') }} className="p-1.5 rounded-lg active:bg-surface-2">
              <X size={22} className="text-secondary" />
            </button>
          </div>

          {/* Custom exercise input */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomExercise()}
                placeholder="输入自定义动作名称"
                className="flex-1 bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted"
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

          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border no-scrollbar">
            {BODY_PARTS.map((bp) => (
              <button
                key={bp}
                onClick={() => setSelectTab(bp)}
                className={`shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  selectTab === bp
                    ? 'bg-accent text-white'
                    : 'bg-surface-1 text-secondary border border-border'
                }`}
              >
                {bp}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {filteredExercises.map((ex, idx) => {
              const disabled = items.some((i) => i.exerciseId === ex.id)
              const m = bodyPartMeta(ex.bodyPart)
              const ExIcon = m.icon
              return (
                <button
                  key={ex.id}
                  onClick={() => addExercise(ex.id)}
                  disabled={disabled}
                  className="w-full flex items-center gap-3 text-left p-3.5 bg-surface-1 rounded-2xl mb-2 disabled:opacity-30 active:bg-surface-2 border border-border shadow-card tap-soft animate-pop-in"
                  style={{ animationDelay: `${Math.min(idx, 8) * 0.03}s` }}
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
        </div>
      )}

      <div className="template-start-bar">
        <button
          onClick={startWorkout}
          disabled={starting || items.length === 0}
          className="ui-primary w-full"
        >
          <Play size={20} fill="currentColor" />
          {starting ? '启动中...' : '开始训练'}
        </button>
      </div>
    </div>
  )
}
