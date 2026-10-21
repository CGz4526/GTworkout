import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2, X, Check } from 'lucide-react'
import { db } from '../db'
import { BODY_PARTS, type BodyPart, type ExerciseRecord } from '../types'
import { isTooShortToRecord } from '../lib/session'
import { AEROBIC_TYPES } from '../lib/aerobic'
import Header from '../components/Header'
import { bodyPartMeta } from '../lib/bodyParts'
import type { WorkoutStorage } from '../data/accountTraining'

const toLocalInput = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 力量和有氧的记录形状差别很大：力量是一堆动作 × 组，有氧只有一个时长（+可选距离）。
// 所以整张表单跟着类型切，而不是在同一条路径上塞一堆条件分支。
type SessionMode = 'strength' | 'aerobic'

export default function AddSession({ storage = db, homePath = '/history', accountMode = false }: { storage?: WorkoutStorage; homePath?: string; accountMode?: boolean }) {
  const navigate = useNavigate()
  const allExercises = useLiveQuery(() => storage.exercises.toArray(), [storage]) ?? []
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [mode, setMode] = useState<SessionMode>('strength')
  const [name, setName] = useState('自由训练')
  const [date, setDate] = useState(() => toLocalInput(new Date()))
  const [duration, setDuration] = useState(60)
  const [distance, setDistance] = useState('')
  const [exercises, setExercises] = useState<ExerciseRecord[]>([])
  const [selectingExercise, setSelectingExercise] = useState(false)
  const [selectTab, setSelectTab] = useState<BodyPart>('肩')
  const [customName, setCustomName] = useState('')

  const isAerobic = mode === 'aerobic'

  // 切类型时顺手把默认名换掉：「自由训练」是有氧的错误名字，还会污染 Stats 的类型分组
  // （Stats 按 templateName 分组统计有氧项目）。
  const switchMode = (next: SessionMode) => {
    if (next === mode) return
    if (next === 'aerobic' && (name.trim() === '' || name === '自由训练')) setName(AEROBIC_TYPES[0])
    if (next === 'strength' && (AEROBIC_TYPES as readonly string[]).includes(name)) setName('自由训练')
    setMode(next)
  }

  const filteredExercises = allExercises.filter((e) => e.bodyPart === selectTab)

  const addExercise = (exerciseId: string, exerciseName: string) => {
    setExercises([...exercises, {
      exerciseId,
      exerciseName,
      sets: [{ weight: undefined, reps: 12, completed: true }],
    }])
    setSelectingExercise(false)
  }

  const addCustomExercise = async () => {
    const n = customName.trim()
    if (!n) return
    try {

    const id = crypto.randomUUID()
    const existing = await storage.exercises.toArray()
    const nameExists = existing.find((e) => e.name === n && e.bodyPart === selectTab)
    if (!nameExists) {
      await storage.exercises.add({ id, name: n, bodyPart: selectTab, createdAt: Date.now() })
    }

    setExercises([...exercises, {
      exerciseId: nameExists?.id ?? id,
      exerciseName: n,
      sets: [{ weight: undefined, reps: 12, completed: true }],
    }])
    setCustomName('')
    setSelectingExercise(false)
    } catch (error) { setSaveError(error instanceof Error ? error.message : '动作保存失败，请重试') }
  }

  const addSet = (exIdx: number) => {
    setExercises(exercises.map((ex, i) =>
      i === exIdx ? { ...ex, sets: [...ex.sets, { weight: undefined, reps: 12, completed: true }] } : ex
    ))
  }

  const removeSet = (exIdx: number, setIdx: number) => {
    setExercises(exercises.map((ex, i) =>
      i === exIdx ? { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) } : ex
    ))
  }

  const updateSet = (exIdx: number, setIdx: number, field: 'weight' | 'reps', value: number | undefined) => {
    setExercises(exercises.map((ex, i) =>
      i === exIdx ? { ...ex, sets: ex.sets.map((s, j) => j === setIdx ? { ...s, [field]: value } : s) } : ex
    ))
  }

  const removeExercise = (exIdx: number) => {
    setExercises(exercises.filter((_, i) => i !== exIdx))
  }

  const handleSave = async () => {
    if (saving) return
    // 力量训练必须有动作；有氧本来就只有时长（和可选距离）
    if (!isAerobic && exercises.length === 0) return

    // A cleared datetime-local gives "" -> new Date("") is an Invalid Date and
    // toISOString() would throw, silently losing the whole record.
    const parsedDate = date ? new Date(date) : null
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
      alert('请先选择训练时间')
      return
    }

    // 留空(0) 视为「时长未知」，允许；但明确填了不足 1 分钟的要拦住。
    // 有氧豁免：爬几趟楼梯就是几十秒，拦掉用户就没法先建记录、再回详情页改时长。
    const minutes = Number(duration)
    const seconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0
    if (isTooShortToRecord(seconds, { aerobic: isAerobic })) {
      alert('训练时长不足 1 分钟，不会记入训练记录')
      return
    }

    const km = Number(distance)
    setSaving(true); setSaveError('')
    try {
    await storage.sessions.add({
      id: crypto.randomUUID(),
      templateName: name.trim() || (isAerobic ? '有氧' : '自由训练'),
      date: parsedDate.toISOString(),
      duration: seconds,
      exercises: isAerobic ? [] : exercises,
      finished: true,
      // 只有有氧才写这两个字段，力量记录不背它们
      ...(isAerobic
        ? { aerobic: true, distance: distance && Number.isFinite(km) ? km : undefined }
        : {}),
    })

    navigate(homePath)
    } catch (error) { setSaveError(error instanceof Error ? error.message : '保存失败，请保留页面重试') }
    finally { setSaving(false) }
  }

  return (
    <div className="ui-page">
      <Header title={accountMode ? '补录账号训练' : '添加记录'} showBack />
      {saveError && <p role="alert" className="p-4 text-sm text-red-500">{saveError}</p>}
      {accountMode && <p className="px-4 pt-3 text-xs text-secondary">保存后进入账号待同步队列；首版已完成记录只读，请先核对内容。</p>}

      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 space-y-4">
        {/* 力量 / 有氧 */}
        <div className="flex gap-1 p-1 bg-surface-1 rounded-2xl border border-border shadow-card">
          {([
            ['strength', '力量训练'],
            ['aerobic', '有氧训练'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => switchMode(value)}
              aria-pressed={mode === value}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                mode === value
                  ? 'bg-accent text-white'
                  : 'text-secondary active:bg-surface-2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Basic info */}
        <div className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card">
          <div className="space-y-3">
            <div>
              <label className="text-muted text-xs mb-1.5 block">训练名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isAerobic ? '如：跑步' : '如：肩训日'}
                className="w-full bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted"
              />
              {/* 快选：名字必须和首页入口一致，否则 Stats 会把同一项目算成两项 */}
              {isAerobic && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {AEROBIC_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setName(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                        name === t
                          ? 'bg-accent/15 border-accent/40 text-accent-light'
                          : 'bg-surface-2 border-border text-secondary active:bg-surface-3'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-muted text-xs mb-1.5 block">训练时间</label>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors"
              />
            </div>
            <div className={isAerobic ? 'grid grid-cols-2 gap-3' : ''}>
              <div>
                <label className="text-muted text-xs mb-1.5 block">
                  {isAerobic ? '时长（分钟）' : '训练时长（分钟）'}
                </label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  // min=0 + step=0.5：有氧可以只练几十秒，写 0.5 就是 30 秒。
                  // 力量填了不足 1 分钟仍会被 isTooShortToRecord 拦下并提示。
                  min="0"
                  step="0.5"
                  className="w-full bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors font-mono"
                />
              </div>
              {isAerobic && (
                <div>
                  <label className="text-muted text-xs mb-1.5 block">距离 km（可留空）</label>
                  <input
                    type="number"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                    min="0"
                    step="0.1"
                    placeholder="如 5.2"
                    className="w-full bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors font-mono placeholder:text-muted"
                  />
                </div>
              )}
            </div>
            {isAerobic && (
              <p className="text-muted text-[10px] leading-relaxed">
                {accountMode ? '有氧可保存几十秒的训练；账号首版保存后只读，请先核对。' : '有氧不限制最短时长，几十秒也能先存下来，之后在详情页改。'}
              </p>
            )}
          </div>
        </div>

        {/* Exercises（只有力量训练才有动作） */}
        {!isAerobic && (
        <div className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card">
          <h3 className="text-primary font-semibold text-sm mb-3">训练动作</h3>

          {exercises.length === 0 ? (
            <p className="text-muted text-xs text-center py-4">点击下方添加动作</p>
          ) : (
            <div className="space-y-3 mb-3">
              {exercises.map((ex, exIdx) => (
                <div key={exIdx} className="bg-surface-2 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-primary text-sm font-medium">{ex.exerciseName}</span>
                    <button onClick={() => removeExercise(exIdx)} className="p-1 text-muted active:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {ex.sets.map((set, setIdx) => (
                      <div key={setIdx} className="flex items-center gap-2">
                        <span className="text-muted text-xs w-4">{setIdx + 1}</span>
                        <input
                          type="number"
                          value={set.weight ?? ''}
                          onChange={(e) => updateSet(exIdx, setIdx, 'weight', e.target.value ? Number(e.target.value) : undefined)}
                          placeholder="重量"
                          className="flex-1 min-w-0 bg-surface-1 text-primary text-center py-1.5 rounded-lg text-xs outline-none border border-border font-mono placeholder:text-muted"
                        />
                        <span className="text-muted text-xs">kg</span>
                        <input
                          type="number"
                          value={set.reps ?? ''}
                          onChange={(e) => updateSet(exIdx, setIdx, 'reps', e.target.value ? Number(e.target.value) : undefined)}
                          placeholder="次数"
                          className="flex-1 min-w-0 bg-surface-1 text-primary text-center py-1.5 rounded-lg text-xs outline-none border border-border font-mono placeholder:text-muted"
                        />
                        <span className="text-muted text-xs">次</span>
                        {ex.sets.length > 1 && (
                          <button onClick={() => removeSet(exIdx, setIdx)} className="p-1 text-muted active:text-red-400">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => addSet(exIdx)}
                    className="w-full mt-2 py-1.5 border border-dashed border-surface-3 rounded-lg text-muted text-xs active:bg-surface-1 transition-colors"
                  >
                    + 添加一组
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setSelectingExercise(true)}
            className="w-full py-3 border border-dashed border-surface-3 rounded-xl text-secondary text-sm active:bg-surface-2 transition-colors"
          >
            + 添加动作
          </button>
        </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving || (!isAerobic && exercises.length === 0)}
          className="ui-primary w-full"
        >
          保存记录
        </button>
      </div>

      {/* Exercise selector */}
      {selectingExercise && (
        <div className="exercise-picker fixed inset-0 z-50 bg-surface-0 flex justify-center animate-fade-in">
          <div className="picker-content flex h-full w-full max-w-2xl flex-col">
          <div className="flex items-center justify-between px-4 h-14 border-b border-border bg-surface-0/80 backdrop-blur-xl">
            <h3 className="text-primary font-semibold">选择动作</h3>
            <button onClick={() => { setSelectingExercise(false); setCustomName('') }} className="p-1.5 rounded-lg active:bg-surface-2">
              <X size={22} className="text-secondary" />
            </button>
          </div>

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

          <div className="flex overflow-x-auto gap-2 px-4 py-3 border-b border-border no-scrollbar">
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
              const m = bodyPartMeta(ex.bodyPart)
              const ExIcon = m.icon
              return (
                <button
                  key={ex.id}
                  onClick={() => addExercise(ex.id, ex.name)}
                  className="w-full flex items-center gap-3 text-left p-3.5 bg-surface-1 rounded-2xl mb-2 active:bg-surface-2 border border-border shadow-card tap-soft animate-pop-in"
                  style={{ animationDelay: `${Math.min(idx, 8) * 0.03}s` }}
                >
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${m.soft}`}>
                    <ExIcon size={15} className={m.text} />
                  </span>
                  <span className="text-primary text-sm font-medium flex-1">{ex.name}</span>
                </button>
              )
            })}
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
