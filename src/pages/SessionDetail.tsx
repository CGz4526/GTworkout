import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, X, Clock, Dumbbell, ListChecks, Plus, Trash2, Check, Route } from 'lucide-react'
import { db } from '../db'
import { BODY_PARTS, MAX_RPE, MIN_RPE, type BodyPart, type ExerciseRecord, type WorkoutSession } from '../types'
import Header from '../components/Header'
import { bodyPartMeta } from '../lib/bodyParts'
import { normalizeSession } from '../lib/session'
import { getDayWeight, setDayWeight } from '../lib/weight'
import { clampRpe, countedSets } from '../lib/set'
import { formatRest } from '../lib/rest'

const MAX_PHOTOS = 3
const MAX_NOTES_LENGTH = 500

const toLocalInput = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const allExercises = useLiveQuery(() => db.exercises.toArray()) ?? []

  const [session, setSession] = useState<WorkoutSession | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const [weight, setWeight] = useState<string>('')
  const [duration, setDuration] = useState<string>('')
  const [distance, setDistance] = useState<string>('')
  const [date, setDate] = useState<string>('')
  const [exercises, setExercises] = useState<ExerciseRecord[]>([])
  const [notes, setNotes] = useState('')
  const [editing, setEditing] = useState(false)
  const [selectingExercise, setSelectingExercise] = useState(false)
  const [selectTab, setSelectTab] = useState<BodyPart>('肩')
  const [customName, setCustomName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Snapshot of the values as loaded from the DB. Used so that saving only
  // writes back the fields the user actually touched — otherwise an untouched
  // date/duration gets silently re-quantised (seconds dropped, a 59s session
  // stored as 59 minutes, etc.).
  const initialRef = useRef<{ date: string; duration: string; weight: string; distance: string } | null>(null)

  const filteredExercises = allExercises.filter((e) => e.bodyPart === selectTab)
  const isAerobic = session?.aerobic === true

  useEffect(() => {
    if (!sessionId) return
    db.sessions.get(sessionId).then(async (raw) => {
      if (!raw) {
        navigate('/history')
        return
      }
      const s = normalizeSession(raw)

      const localDate = toLocalInput(new Date(s.date))
      const localDuration = Math.floor(s.duration / 60).toString()
      // 当天可能已经在首页记过体重（那天还没有训练记录），所以以「按天存」的
      // weights 为准，session.weight 只是旧数据的兜底。
      const dayWeight = await getDayWeight(s.date)
      const localWeight = (dayWeight ?? s.weight)?.toString() ?? ''
      const localDistance = s.distance?.toString() ?? ''

      setSession(s)
      setPhotos(s.photos ?? [])
      setWeight(localWeight)
      setDuration(localDuration)
      setDistance(localDistance)
      setDate(localDate)
      setExercises(s.exercises)
      setNotes(s.notes ?? '')

      initialRef.current = {
        date: localDate,
        duration: localDuration,
        weight: localWeight,
        distance: localDistance,
      }
    })
  }, [sessionId, navigate])

  const saveSession = async () => {
    if (!sessionId) return

    // Never persist a blank exercise name — it renders as an empty row everywhere.
    const cleaned = exercises.map((ex) => ({
      ...ex,
      exerciseName: ex.exerciseName.trim() || '未命名动作',
    }))

    const patch: Partial<WorkoutSession> = {
      exercises: cleaned,
      templateName: session?.templateName,
      notes: notes.trim() || undefined,
    }
    const initial = initialRef.current

    // Only write a field back when the user actually changed it. Without this,
    // simply opening the editor and tapping 保存 rewrote the time (seconds were
    // dropped) and the duration (rounded down to whole minutes).
    if (!initial || date !== initial.date) {
      // A cleared datetime-local gives "" -> Invalid Date -> toISOString() throws
      const parsedDate = date ? new Date(date) : null
      if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
        alert('请先选择训练时间')
        return
      }
      patch.date = parsedDate.toISOString()
    }
    if (!initial || duration !== initial.duration) {
      const minutes = Number(duration)
      patch.duration = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0
    }
    if (!initial || weight !== initial.weight) {
      const kg = Number(weight)
      patch.weight = weight && Number.isFinite(kg) ? kg : undefined
    }
    if (!initial || distance !== initial.distance) {
      const km = Number(distance)
      patch.distance = distance && Number.isFinite(km) ? km : undefined
    }

    await db.sessions.update(sessionId, patch)
    setExercises(cleaned)
    // 体重按「天」存在 weights 表（没训练的日子也能记）。日期被改过时，
    // 这份体重要跟着新日期走，否则新日期的详情页会看不到它。
    if (!initial || weight !== initial.weight) {
      const kg = Number(weight)
      await setDayWeight(patch.date ?? session?.date ?? '', weight && Number.isFinite(kg) ? kg : undefined)
    }
    initialRef.current = { date, duration, weight, distance }
    setEditing(false)
  }

  const updateExerciseName = (exIdx: number, name: string) => {
    setExercises(exercises.map((ex, i) => (i === exIdx ? { ...ex, exerciseName: name } : ex)))
  }

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

    const id = crypto.randomUUID()
    const existing = await db.exercises.toArray()
    const nameExists = existing.find((e) => e.name === n && e.bodyPart === selectTab)
    if (!nameExists) {
      await db.exercises.add({ id, name: n, bodyPart: selectTab, createdAt: Date.now() })
    }

    setExercises([...exercises, {
      exerciseId: nameExists?.id ?? id,
      exerciseName: n,
      sets: [{ weight: undefined, reps: 12, completed: true }],
    }])
    setCustomName('')
    setSelectingExercise(false)
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

  const updateSet = (exIdx: number, setIdx: number, field: 'weight' | 'reps' | 'rpe', value: number | undefined) => {
    setExercises(exercises.map((ex, i) =>
      i === exIdx ? { ...ex, sets: ex.sets.map((s, j) => j === setIdx ? { ...s, [field]: value } : s) } : ex
    ))
  }

  const removeExercise = (exIdx: number) => {
    setExercises(exercises.filter((_, i) => i !== exIdx))
  }

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}时${m}分${s > 0 ? s + '秒' : ''}`
    if (m === 0) return `${s}秒`
    return `${m}分${s > 0 ? s + '秒' : ''}`
  }

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const maxSize = 800
          let width = img.width
          let height = img.height

          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = (height / width) * maxSize
              width = maxSize
            } else {
              width = (width / height) * maxSize
              height = maxSize
            }
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, width, height)
          resolve(canvas.toDataURL('image/jpeg', 0.7))
        }
        img.src = e.target?.result as string
      }
      reader.readAsDataURL(file)
    })
  }

  const handleAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0 || !sessionId) return

    const remaining = MAX_PHOTOS - photos.length
    const toAdd = files.slice(0, remaining)

    const compressed = await Promise.all(toAdd.map(compressImage))
    const newPhotos = [...photos, ...compressed]

    await db.sessions.update(sessionId, { photos: newPhotos })
    setPhotos(newPhotos)

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDeletePhoto = async (idx: number) => {
    if (!sessionId) return
    const newPhotos = photos.filter((_, i) => i !== idx)

    await db.sessions.update(sessionId, { photos: newPhotos })
    setPhotos(newPhotos)
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  const totalSets = countedSets(exercises)

  return (
    <div className="ui-page record-detail">
      <Header
        title={editing ? '编辑记录' : '训练详情'}
        showBack
        rightAction={
          editing ? (
            <button onClick={saveSession} className="text-accent-light text-sm font-medium">
              保存
            </button>
          ) : (
            <button onClick={() => setEditing(true)} className="text-accent-light text-sm font-medium">
              编辑
            </button>
          )
        }
      />

      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
        {/* Summary */}
        <div className="bg-surface-1 rounded-2xl p-5 border border-border shadow-card mb-4 animate-rise-in">
          {editing ? (
            <div className="space-y-3 mb-3">
              <input
                value={session.templateName ?? ''}
                onChange={(e) => setSession((prev) => (prev ? { ...prev, templateName: e.target.value } : prev))}
                placeholder="训练名称"
                className="w-full bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted"
              />
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors"
              />
            </div>
          ) : (
            <h2 className="text-lg font-bold text-primary mb-3">{session.templateName ?? '自由训练'}</h2>
          )}
          <div className={`summary-metrics ${isAerobic ? 'summary-aerobic' : ''}`}>
            <div className="text-center">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2">
                <Clock size={16} className="text-accent-light" />
              </div>
              {editing ? (
                <div className="flex items-center justify-center gap-1">
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-12 bg-surface-2 text-primary text-center py-1 rounded-lg text-sm outline-none border border-border font-mono"
                  />
                  <span className="text-muted text-xs">分</span>
                </div>
              ) : (
                <p className="text-primary text-sm font-bold font-mono">{formatDuration(session.duration)}</p>
              )}
              <p className="text-muted text-[10px] uppercase tracking-wider">时长</p>
            </div>
            {isAerobic ? (
              <div className="text-center">
                <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2">
                  <Route size={16} className="text-accent-light" />
                </div>
                {editing ? (
                  <div className="flex items-center justify-center gap-1">
                    <input
                      type="number"
                      value={distance}
                      onChange={(e) => setDistance(e.target.value)}
                      step="0.1"
                      className="w-14 bg-surface-2 text-primary text-center py-1 rounded-lg text-sm outline-none border border-border font-mono"
                    />
                    <span className="text-muted text-xs">km</span>
                  </div>
                ) : (
                  <p className="text-primary text-sm font-bold font-mono">{distance ? `${distance}km` : '-'}</p>
                )}
                <p className="text-muted text-[10px] uppercase tracking-wider">距离</p>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2">
                    <Dumbbell size={16} className="text-accent-light" />
                  </div>
                  <p className="text-primary text-sm font-bold">{exercises.length}</p>
                  <p className="text-muted text-[10px] uppercase tracking-wider">动作</p>
                </div>
                <div className="text-center">
                  <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-2">
                    <ListChecks size={16} className="text-accent-light" />
                  </div>
                  <p className="text-primary text-sm font-bold">{totalSets}</p>
                  <p className="text-muted text-[10px] uppercase tracking-wider">组数</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Exercises */}
        <div className="space-y-3 animate-rise-in" style={{ animationDelay: '0.2s' }}>
          {exercises.map((ex, exIdx) => {
            const def = allExercises.find((e) => e.id === ex.exerciseId)
            const warmupCount = ex.sets.filter((s) => s.warmup === true).length
            return (
            <div key={exIdx} className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card">              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-accent-light">{exIdx + 1}</span>
                  </div>
                  {editing ? (
                    <input
                      value={ex.exerciseName}
                      onChange={(e) => updateExerciseName(exIdx, e.target.value)}
                      placeholder="动作名称"
                      className="flex-1 min-w-0 bg-surface-2 text-primary px-3 py-1.5 rounded-lg text-sm font-semibold outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted"
                    />
                  ) : (
                    <span className="text-primary font-semibold text-base">{ex.exerciseName}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {warmupCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 text-[10px] tabular-nums">热身 {warmupCount}</span>
                  )}
                  {(ex.restSeconds ?? def?.restSeconds) != null && (
                    <span className="text-muted text-[10px] tabular-nums">歇 {formatRest(ex.restSeconds ?? def?.restSeconds)}</span>
                  )}
                  {editing && (
                    <div className="flex items-center gap-1">
                      <button aria-label={`为${ex.exerciseName}添加组`} onClick={() => addSet(exIdx)} className="ui-icon-button">
                        <Plus size={14} />
                      </button>
                      <button aria-label={`移除${ex.exerciseName}`} onClick={() => removeExercise(exIdx)} className="ui-icon-button">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {def?.description && (
                <p className="text-muted text-[10px] leading-relaxed mb-2 ml-9">{def.description}</p>
              )}
              <div className="mt-4 space-y-1.5">
                {ex.sets.map((set, setIdx) => (
                  <div key={setIdx} className={`record-set flex items-center gap-2 ${set.warmup ? 'opacity-60' : ''}`}>
                    {set.warmup ? (
                      <span className="text-amber-600 dark:text-amber-400 text-[10px] w-4 font-bold">热</span>
                    ) : (
                      <span className="text-muted text-xs w-4 font-mono">{setIdx + 1}</span>
                    )}
                    {editing ? (
                      <>
                        <input
                          type="number"
                          value={set.weight ?? ''}
                          onChange={(e) => updateSet(exIdx, setIdx, 'weight', e.target.value ? Number(e.target.value) : undefined)}
                          placeholder="重量"
                          className="flex-1 min-w-0 bg-surface-2 text-primary text-center py-1.5 rounded-lg text-xs outline-none border border-border font-mono placeholder:text-muted"
                        />
                        <span className="text-muted text-xs">kg</span>
                        <input
                          type="number"
                          value={set.reps ?? ''}
                          onChange={(e) => updateSet(exIdx, setIdx, 'reps', e.target.value ? Number(e.target.value) : undefined)}
                          placeholder="次数"
                          className="flex-1 min-w-0 bg-surface-2 text-primary text-center py-1.5 rounded-lg text-xs outline-none border border-border font-mono placeholder:text-muted"
                        />
                        <span className="text-muted text-xs">次</span>
                        <input
                          type="number"
                          min={MIN_RPE}
                          max={MAX_RPE}
                          step="0.5"
                          value={set.rpe ?? ''}
                          onChange={(e) => updateSet(exIdx, setIdx, 'rpe', e.target.value ? clampRpe(Number(e.target.value)) : undefined)}
                          placeholder="RPE"
                          className="w-14 bg-surface-2 text-primary text-center py-1.5 rounded-lg text-xs outline-none border border-border font-mono placeholder:text-muted"
                        />
                        {ex.sets.length > 1 && (
                          <button onClick={() => removeSet(exIdx, setIdx)} className="p-1 text-muted active:text-red-400">
                            <X size={12} />
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-primary text-sm tabular-nums">{set.weight ? `${set.weight}kg` : '-'}</span>
                        <span className="text-muted text-xs">×</span>
                        <span className="text-primary text-sm tabular-nums">{set.reps ?? '-'}</span>
                        {set.rpe != null && (
                          <span className="text-muted text-[10px] font-mono">RPE {set.rpe}</span>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            )
          })}

          {editing && (
            <button
              onClick={() => setSelectingExercise(true)}
              className="ui-secondary w-full border border-dashed border-accent/30 text-accent-light"
            >
              + 添加动作
            </button>
          )}
        </div>

        <details className="record-extras ui-panel mt-6">
          <summary className="font-medium text-sm">补充记录 · 体重、饮食、备注与照片</summary>
          <p className="mt-2 mb-4 text-xs text-secondary">展开查看或补充本次训练信息</p>
        {/* Body Weight */}
        <div className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card mb-4 animate-rise-in" style={{ animationDelay: '0.05s' }}>
          <h3 className="text-primary font-semibold text-sm mb-3">体重记录</h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onBlur={async () => {
                if (sessionId) {
                  const kg = Number(weight)
                  const finalKg = weight && Number.isFinite(kg) ? kg : undefined
                  // session.weight 是冗余镜像，weights 才是按天存的真身
                  await db.sessions.update(sessionId, { weight: finalKg })
                  if (session?.date) await setDayWeight(session.date, finalKg)
                }
              }}
              placeholder="输入体重"
              className="flex-1 bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted font-mono"
            />
            <span className="text-muted text-sm">kg</span>
          </div>
        </div>

        {/* Diet */}
        <div className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card mb-4 animate-rise-in" style={{ animationDelay: '0.06s' }}>
          <h3 className="text-primary font-semibold text-sm mb-3">碳循环饮食</h3>
          <div className="flex gap-2">
            {([
              ['low', '低碳日', 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'],
              ['mid', '中碳日', 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'],
              ['high', '高碳日', 'bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400'],
              ['cheat', '放纵餐', 'bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-400'],
            ] as const).map(([value, label, activeClass]) => (
              <button
                key={value}
                onClick={async () => {
                  if (sessionId) await db.sessions.update(sessionId, { diet: value })
                  setSession((prev) => (prev ? { ...prev, diet: value } : prev))
                }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                  session.diet === value
                    ? activeClass
                    : 'bg-surface-2 border-border text-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card mb-4 animate-rise-in" style={{ animationDelay: '0.08s' }}>
          <h3 className="text-primary font-semibold text-sm mb-3">训练备注</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES_LENGTH))}
            onBlur={async () => {
              if (!sessionId) return
              await db.sessions.update(sessionId, { notes: notes.trim() || undefined })
            }}
            placeholder="今天的状态、不适、器械调整…"
            rows={2}
            className="w-full bg-surface-0 text-primary px-4 py-3 rounded-xl text-base outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted resize-none"
          />
        </div>

        {/* Photos */}
        <div className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card mb-4 animate-rise-in" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-primary font-semibold text-sm">训练照片</h3>
            <span className="text-muted text-xs">{photos.length}/{MAX_PHOTOS}</span>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {photos.map((photo, idx) => (
              <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-surface-2" onClick={() => setPreviewIdx(idx)}>
                <img src={photo} alt={`训练照片 ${idx + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeletePhoto(idx) }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center active:bg-black/80 transition-colors"
                >
                  <X size={14} className="text-white" />
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-surface-3 flex flex-col items-center justify-center gap-1 active:bg-surface-2 transition-colors"
              >
                <Camera size={20} className="text-muted" />
                <span className="text-muted text-[10px]">添加照片</span>
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleAddPhotos}
            className="hidden"
          />
        </div>

        </details>

        {/* Delete */}
        <div className="mt-6 text-center">
          <button
            onClick={async () => {
              if (confirm('确定删除这条训练记录？')) {
                await db.sessions.delete(session.id)
                navigate('/history')
              }
            }}
            className="text-red-400/80 text-xs active:text-red-400 transition-colors"
          >
            删除训练记录
          </button>
        </div>
      </div>

      {/* Exercise selector */}
      {selectingExercise && (
        <div className="exercise-picker fixed inset-0 z-50 bg-surface-0 flex justify-center animate-fade-in">
          <div className="picker-content flex h-full w-full max-w-2xl flex-col">
          <div className="flex items-center justify-between px-4 h-14 border-b border-border bg-surface-0/80 backdrop-blur-xl">
            <h3 className="text-primary font-semibold">选择动作</h3>
            <button onClick={() => { setSelectingExercise(false); setCustomName('') }} aria-label="关闭" className="p-1.5 rounded-lg active:bg-surface-2 tap">
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
                className="w-10 h-10 rounded-xl bg-accent-soft flex items-center justify-center active:bg-accent/20 disabled:opacity-30 tap"
              >
                <Check size={18} className="text-accent" />
              </button>
            </div>
          </div>

          <div className="flex overflow-x-auto gap-2 px-4 py-3 border-b border-border no-scrollbar">
            {BODY_PARTS.map((bp) => {
              const m = bodyPartMeta(bp)
              const TabIcon = m.icon
              const active = selectTab === bp
              return (
                <button
                  key={bp}
                  onClick={() => setSelectTab(bp)}
                  aria-pressed={active}
                  className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 tap ${
                    active
                      ? `bg-accent text-white`
                      : 'bg-surface-1 text-secondary border border-border active:bg-surface-2'
                  }`}
                >
                  <TabIcon size={14} className={active ? 'text-white' : m.text} />
                  {bp}
                </button>
              )
            })}
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

      {/* Photo Preview */}
      {previewIdx !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center animate-fade-in"
          onClick={() => setPreviewIdx(null)}
        >
          <button
            onClick={() => setPreviewIdx(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
          >
            <X size={24} className="text-white" />
          </button>
          <img
            src={photos[previewIdx]}
            alt={`训练照片 ${previewIdx + 1}`}
            className="max-w-[90vw] max-h-[85vh] object-contain"
          />
        </div>
      )}
    </div>
  )
}
