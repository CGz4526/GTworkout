import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Timer, Trophy, Clock, Dumbbell, ListChecks, Zap, Route, X, Check } from 'lucide-react'
import { db } from '../db'
import { BODY_PARTS, MAX_RPE, MIN_RPE, type BodyPart, type ExerciseRecord, type SetRecord, type TemplateItem } from '../types'
import Header from '../components/Header'
import CheckButton from '../components/CheckButton'
import NumberWheel from '../components/NumberWheel'
import { alertRestDone, notificationPermission, primeAudio, requestNotificationPermission } from '../lib/feedback'
import { useWakeLock } from '../lib/useWakeLock'
import { isTooShortToRecord, normalizeSession } from '../lib/session'
import { normalizeTemplate } from '../lib/template'
import { appendWorkoutSet, editSetWeight, keyboardWeightPreferred, removeWorkoutSet } from '../lib/workoutEntry'
import { recordsFromTemplate } from '../lib/templateWorkout'
import { bodyPartMeta } from '../lib/bodyParts'
import { resolveRestSeconds, clampRestSeconds } from '../lib/rest'
import { clampRpe, isCountedSet } from '../lib/set'
import { ensureRecordIds, type WorkoutStorage } from '../data/accountTraining'

const REST_FALLBACK = 150
const MAX_NOTES_LENGTH = 500

// 训练页三个数字字段的滚轮参数。重量用 2.5kg 一档（杠铃片的最小组合），
// 次数 1 下一档，RPE 半档——和各自的语义对齐。
const WHEEL_CFG = {
  weight: { title: '重量', min: 0, max: 600, step: 2.5, unit: 'kg' as string | undefined },
  reps: { title: '次数', min: 1, max: 100, step: 1, unit: '次' as string | undefined },
  rpe: { title: 'RPE', min: MIN_RPE, max: MAX_RPE, step: 0.5, unit: undefined as string | undefined },
}

// "上次成绩" 的日期前缀：只到「天」这一粒度就够了，精确到时分反而难读。
function daysAgoLabel(dateStr: string) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOfDay(new Date()) - startOfDay(new Date(dateStr))) / 86400000)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff < 30) return `${diff} 天前`
  return `${Math.floor(diff / 30)} 个月前`
}

// 最多列 3 组，再多会把动作名挤掉
function formatPrevSets(sets: SetRecord[]) {
  const shown = sets.slice(0, 3).map((s) => `${s.weight ?? '-'}×${s.reps ?? '-'}`).join(' · ')
  return sets.length > 3 ? `${shown} +${sets.length - 3}` : shown
}

// 秒 → 「分钟」输入框的初值。向下取整，和 SessionDetail 的编辑口径保持一致
// （那边也是 Math.floor(s.duration / 60)）。0 秒表示「时长未知」，显示成空。
function secondsToMinutesInput(seconds: number): string {
  return Number.isFinite(seconds) && seconds > 0 ? String(Math.floor(seconds / 60)) : ''
}

// 把模板动作铺成训练记录。
// defaultSets 有两个不受源码控制的来源（备份导入、sessionStorage 的 preset），
// 所以必须先用 sanitizeItem 夹住再 Array.from——一个坏掉的备份里出现
// defaultSets: 100000，这里就会当场铺出十万个组对象把页面卡死。
/**
 * 把模板条目铺成训练记录。
 *
 * 入参是**敌意数据**，不是内部结构：它来自 `sessionStorage` 的 preset JSON 和
 * 库里的模板，两者都由备份导入 / 手改产生，没有任何 schema 校验。
 * 不是数组就退回空列表——否则 `items.map` 抛错会让这个初始化 effect 中途死掉，
 * `setLoaded(true)` 永远执行不到，训练页会一直卡在加载态。
 */
const buildRecordsFromItems = recordsFromTemplate

// 事件阶段的动作创建，与渲染和纯录入规则分开；账号模式沿用其专属仓储。
async function ensureCustomExercise(storage: WorkoutStorage, name: string, bodyPart: BodyPart): Promise<string> {
  const existing = (await storage.exercises.toArray()).find(e => e.name === name && e.bodyPart === bodyPart)
  if (existing) return existing.id
  const id = crypto.randomUUID()
  await storage.exercises.add({ id, name, bodyPart, createdAt: Date.now() })
  return id
}

export default function ActiveWorkout({ storage = db, homePath = '/', accountMode = false }: { storage?: WorkoutStorage; homePath?: string; accountMode?: boolean }) {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const session = useLiveQuery(
    async () => {
      const raw = await storage.sessions.get(sessionId!)
      return raw ? normalizeSession(raw) : raw
    },
    [sessionId, storage],
  )
  const [exercises, updateExercises] = useState<ExerciseRecord[]>([])
  const setExercises = useCallback((next: ExerciseRecord[]) => updateExercises(accountMode ? ensureRecordIds(next) : next), [accountMode])
  const [storageError, setStorageError] = useState('')
  const reportSaveError = useCallback(() => setStorageError('本机保存失败，请勿关闭页面。请检查可用存储空间后重试。'), [])
  const [finished, setFinished] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  // 训练不足 1 分钟被丢弃时，记下时长用来给用户一个说明页（而不是静默跳走）
  const [discardedSeconds, setDiscardedSeconds] = useState<number | null>(null)
  // 当前时间戳，每秒由下面的 interval 推进一次。
  // 用它而不是在 render 里直接 Date.now()：render 必须是纯函数
  // （react-hooks/purity），而且并发渲染下每次重渲染取到的时间会漂移。
  const [now, setNow] = useState(() => Date.now())
  const [finalElapsed, setFinalElapsed] = useState(0)
  const timerRef = useRef<number | null>(null)

  const [restEndTime, setRestEndTime] = useState<number | null>(null)
  // 当前展开的动作；其余动作显示摘要。
  const [focusedExercise, setFocusedExercise] = useState(0)
  const [distance, setDistance] = useState<string>('')
  // 有氧结束后允许修正时长。存的是「分钟」字符串，和 SessionDetail 的编辑口径一致；
  // 落库时再换算成秒。
  const [durationInput, setDurationInput] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const restTimerRef = useRef<number | null>(null)
  const initializedForRef = useRef<string | null>(null)
  // 已经播报过的休息结束时间戳，保证同一次休息只提醒一次
  // （interval 可能在下一次重渲染清空 state 之前再跳一次）。
  const restAlertedRef = useRef<number | null>(null)
  const notifAskedRef = useRef(false)
  // 训练备注。和 exercises 一样用防抖落库——用户每敲一个字都写一次库没意义。
  const [notesInput, setNotesInput] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)
  const notesTimerRef = useRef<number | null>(null)
  const [notifState, setNotifState] = useState<NotificationPermission | 'unsupported'>(
    () => notificationPermission()
  )
  // 动作 → 最近一次已结束训练的成绩，用于训练时显示「上次」
  const [lastPerf, setLastPerf] = useState<Record<string, { sets: SetRecord[]; date: string }>>({})
  // 本次训练所用模板的条目，用来解析每个动作的组间歇（模板值 > 动作库值 > 默认）
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([])
  // 数字滚轮选择器：点重量/次数/RPE 弹出（滑动优先，键盘次之）
  const [wheel, setWheel] = useState<{ exIdx: number; setIdx: number; field: 'weight' | 'reps' | 'rpe' } | null>(null)

  // Calculate elapsed from startTime
  const elapsed = finished
    ? finalElapsed
    : session?.startTime
      ? Math.floor((now - session.startTime) / 1000)
      : 0

  // Calculate rest remaining from end time
  const restRemaining = restEndTime ? Math.max(0, Math.ceil((restEndTime - now) / 1000)) : 0

  // Debounced save exercises to DB
  const saveTimeoutRef = useRef<number | null>(null)
  const saveExercises = useCallback((exs: ExerciseRecord[], restEnd?: number) => {
    if (!sessionId) return
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    const save = () => {
      void storage.sessions.update(sessionId, {
        exercises: exs,
        restEndTime: restEnd,
      }).catch(reportSaveError)
    }
    if (accountMode) save()
    else saveTimeoutRef.current = window.setTimeout(save, 300)
  }, [sessionId, storage, accountMode, reportSaveError])

  // Init from session (runs once per session)
  //
  // 关于 react-hooks/set-state-in-effect：这里是「把异步加载到的外部数据（Dexie）
  // 一次性播种成本地可编辑 state」，属于该规则明确允许的「与外部系统同步」场景——
  // 不能用 useLiveQuery 订阅，否则用户正在编辑时会被库里的旧值覆盖。
  // 代价只是挂载时多一次渲染，可接受。
  // 真正的修法是把组件拆成「加载器 + 内层」并用 key={sessionId} 重挂载，
  // 但那会牵动 initializedForRef / loaded / 防抖保存三者的耦合，风险不划算。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!session || initializedForRef.current === sessionId) return
    initializedForRef.current = sessionId ?? null

    if (session.finished) {
      setExercises(session.exercises)
      setFinalElapsed(session.duration)
      setNotesInput(session.notes ?? '')
      // 有氧的时长/距离在总结页是可编辑的，所以要把库里已有的值回填进输入框。
      // 之前只回填了 exercises，重开一条已结束的有氧记录时距离框是空的——
      // 明明存了 5km 却显示空白。
      setDurationInput(secondsToMinutesInput(session.duration))
      setDistance(session.distance != null ? String(session.distance) : '')
      setFinished(true)
      setShowSummary(true)
      setLoaded(true)
      return
    }

    if (session.exercises.length > 0) {
      setExercises(session.exercises)
      setLoaded(true)
    } else {
      // Prefer the preset prepared right before starting (it reflects any
      // last-minute edits made on the template / pre-workout screens),
      // otherwise fall back to the saved template.
      const presetKey = `preset-${sessionId}`
      const presetData = sessionStorage.getItem(presetKey)
      if (presetData) {
        // 坏 JSON 会让 JSON.parse 抛错，同样会打断初始化；解不开就当没有 preset
        let presetItems: unknown
        try {
          presetItems = JSON.parse(presetData)
        } catch {
          presetItems = null
        }
        setExercises(buildRecordsFromItems(presetItems))
        sessionStorage.removeItem(presetKey)
        setLoaded(true)
      } else if (session.templateId) {
        storage.templates.get(session.templateId).then((raw) => {
          // 缺 items 的模板（坏备份）在这里补成 []，否则 .length 会抛错、
          // 整个 .then 中断，训练页永远停在加载态
          const template = raw ? normalizeTemplate(raw) : null
          if (template && template.items.length > 0) {
            setExercises(buildRecordsFromItems(template.items))
          }
          setLoaded(true)
        })
      } else {
        setLoaded(true)
      }
    }

    // Restore an in-progress rest timer
    if (session.restEndTime && session.restEndTime > Date.now()) {
      setRestEndTime(session.restEndTime)
    }
    // 备注在两条分支里都要回填：恢复一条已结束的记录，以及从中途继续的训练
    setNotesInput(session.notes ?? '')
  }, [session, sessionId, storage, setExercises])

  // 模板条目单独取一次：组间歇的解析要用它（模板值优先于动作库值）。
  // 用不到模板也能训练——那种情况回落回动作库值，再回落回默认两分半。
  useEffect(() => {
    if (!session?.templateId) return
    let cancelled = false
    storage.templates.get(session.templateId).then((raw) => {
      if (cancelled) return
      setTemplateItems(raw ? normalizeTemplate(raw).items : [])
    })
    return () => {
      cancelled = true
    }
  }, [session?.templateId, storage])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Display tick: re-render every second so elapsed updates
  useEffect(() => {
    if (finished) return
    timerRef.current = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [finished])

  // Rest timer - just trigger re-renders, actual calculation is done above
  useEffect(() => {
    // 用 Date.now() 而不是 restRemaining 做这个前置判断：restRemaining 是由
    // 每秒推进的 now 派生的，把它写进依赖数组会让定时器每秒重建一次。
    if (!restEndTime || Date.now() >= restEndTime) return
    restTimerRef.current = window.setInterval(() => {
      const t = Date.now()
      setNow(t) // trigger re-render to recalculate
      if (t >= restEndTime) {
        // 后台标签页的定时器会被节流，所以这里可能在超时后才第一次命中——
        // 那也照样提醒（用户刚回到页面时正需要这个提示）。
        if (restAlertedRef.current !== restEndTime) {
          restAlertedRef.current = restEndTime
          alertRestDone()
        }
        setRestEndTime(null)
        if (restTimerRef.current) clearInterval(restTimerRef.current)
      }
    }, 1000)
    return () => {
      if (restTimerRef.current) clearInterval(restTimerRef.current)
    }
  }, [restEndTime])

  // Persist exercises + rest timer state whenever either changes.
  // Gated on `loaded` (not on a non-empty list) so that deleting every exercise
  // is persisted too — otherwise the UI shows 0 while the DB keeps the previous
  // state, and the deleted exercises come back on the next visit.
  useEffect(() => {
    if (finished || !loaded) return
    saveExercises(exercises, restEndTime ?? undefined)
  }, [exercises, restEndTime, finished, loaded, saveExercises])

  // 整个训练过程保持屏幕常亮——训练中伸手去点手机结果发现它锁屏了，
  // 正好抵消掉「实时记录」的意义。
  useWakeLock(!finished && loaded)

  // 「上次成绩」：该动作最近一次**已结束**训练里真正完成的组。
  // 只在进入本次训练时算一次——训练期间唯一会变的是当前这条记录，而它已被排除。
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    storage.sessions
      .toArray()
      .then((all) => {
        if (cancelled) return
        const map: Record<string, { sets: SetRecord[]; date: string }> = {}
        all
          .filter((s) => s.finished && s.id !== sessionId)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .forEach((s) => {
            for (const ex of s.exercises) {
              // 排除热身组：把空杆热身算进「上次成绩」会让参考值失真，
              // 用户看到的是 20kg×15，而正式组其实是 60kg×8。
              const done = ex.sets.filter(isCountedSet)
              if (done.length === 0) continue
              // 从新到旧遍历，第一次命中即为最近一次。
              // 同时按 id 和名称建索引：训练中新增的自定义动作可能带新 id。
              if (!map[ex.exerciseId]) map[ex.exerciseId] = { sets: done, date: s.date }
              if (!map[ex.exerciseName]) map[ex.exerciseName] = { sets: done, date: s.date }
            }
          })
        setLastPerf(map)
      })
      .catch(() => {
        // 读历史失败不应该影响正在进行的训练
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, storage])

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // 某个动作这次训练该歇多久。入参是敌意数据（模板/动作库都可能来自备份导入），
  // resolveRestSeconds 内部会夹取。
  const restFor = (exIdx: number): number => {
    const ex = exercises[exIdx]
    if (!ex) return REST_FALLBACK
    if (typeof ex.restSeconds === 'number') return clampRestSeconds(ex.restSeconds)
    const item = templateItems.find((i) => i.exerciseId === ex.exerciseId)
    const def = allExercises.find((e) => e.id === ex.exerciseId)
    return resolveRestSeconds(item, def)
  }

  // 备注防抖落库。和 saveExercises 同一套思路：flush 在 finishWorkout 里做，
  // 否则刚敲完字就结束训练，那一段还没写进去就丢了。
  const saveNotes = useCallback((text: string) => {
    if (!sessionId) return
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    const save = () => {
      const trimmed = text.trim()
      void storage.sessions.update(sessionId, { notes: trimmed || undefined }).then(() => {
        setNotesSaved(true)
        window.setTimeout(() => setNotesSaved(false), 1500)
      }).catch(reportSaveError)
    }
    if (accountMode) save()
    else notesTimerRef.current = window.setTimeout(save, 400)
  }, [sessionId, storage, accountMode, reportSaveError])

  const formatRestTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const startRest = (seconds: number) => {
    // 这里是从点击事件同步调用的，而 iOS 只允许在用户手势里解锁音频，
    // 所以必须在这一刻 prime，否则休息结束的提示音会一直是哑的。
    primeAudio()
    // 通知权限只在第一次开始休息时问一次：此刻是真实用户手势（Chrome 的硬性要求），
    // 而且「组间休息」这个上下文能让权限弹窗显得不突兀。
    if (!notifAskedRef.current && notifState === 'default') {
      notifAskedRef.current = true
      requestNotificationPermission().then(setNotifState)
    }
    restAlertedRef.current = null
    // 用每秒推进的 now 而不是 Date.now()：后者会让 react-hooks/purity
    // 把这个函数判成「可能在渲染期调用」，报 impure function。
    // 最多差 1 秒，对休息倒计时无影响。
    setRestEndTime(now + seconds * 1000)
  }

  const skipRest = () => {
    setRestEndTime(null)
    if (restTimerRef.current) clearInterval(restTimerRef.current)
  }

  const addRestTime = (seconds: number) => {
    setRestEndTime(prev => {
      if (!prev || prev <= Date.now()) return null
      const end = prev + seconds * 1000
      return end > Date.now() ? end : null
    })
  }

  const toggleSet = (exIdx: number, setIdx: number) => {
    if (finished) return
    const wasCompleted = exercises[exIdx].sets[setIdx].completed
    setExercises(
      exercises.map((ex, i) =>
        i === exIdx
          ? { ...ex, sets: ex.sets.map((s, j) => j === setIdx ? { ...s, completed: !s.completed } : s) }
          : ex
      )
    )
    // 热身组不触发休息——它本来就不该按正式组的节奏走。
    if (!wasCompleted && !exercises[exIdx].sets[setIdx].warmup) startRest(restFor(exIdx))
  }

  const updateSet = (exIdx: number, setIdx: number, field: 'weight' | 'reps' | 'rpe', value: number | undefined) => {
    if (finished) return
    setExercises(
      exercises.map((ex, i) =>
        i === exIdx
          ? field === 'weight' ? editSetWeight(ex, setIdx, value) : { ...ex, sets: ex.sets.map((s, j) => j === setIdx ? { ...s, [field]: value } : s) }
          : ex
      )
    )
  }

  // 热身标记。热身组不计入容量与有效组数，但重量/次数照记——
  // 回看时能看出当天开了多少组空杆热身。
  const toggleWarmup = (exIdx: number, setIdx: number) => {
    if (finished) return
    setExercises(
      exercises.map((ex, i) =>
        i === exIdx
          ? { ...ex, sets: ex.sets.map((s, j) => j === setIdx ? { ...s, warmup: !s.warmup } : s).sort((a, b) => Number(!!b.warmup) - Number(!!a.warmup)) }
          : ex
      )
    )
  }

  const addSet = (exIdx: number, warmup = false) => {
    if (finished) return
    setExercises(exercises.map((ex, i) => i === exIdx ? appendWorkoutSet(ex, warmup) : ex))
  }

  const removeGroup = (exIdx: number, setIdx: number) => {
    if (finished) return
    const group = exercises[exIdx]?.sets[setIdx]
    if (!group) return
    if ((group.completed || group.weight != null || group.rpe != null) && !window.confirm('这一组已有记录，仍要移除？其他组保持不变。')) return
    setExercises(exercises.map((ex, i) => i === exIdx ? removeWorkoutSet(ex, setIdx) : ex))
  }

  const removeSet = (exIdx: number) => {
    const sets = exercises[exIdx]?.sets ?? []
    if (sets.filter(set => !set.warmup).length <= 1) return
    const index = sets.map(set => !set.warmup).lastIndexOf(true)
    removeGroup(exIdx, index)
  }

  const removeExercise = (exIdx: number) => {
    if (finished) return
    if (!window.confirm(`从本次训练移除“${exercises[exIdx].exerciseName}”及其组记录？动作库和模板不会改变。`)) return
    setFocusedExercise(Math.max(0, focusedExercise - (exIdx <= focusedExercise ? 1 : 0)))
    setExercises(exercises.filter((_, i) => i !== exIdx))
  }

  const allExercises = useLiveQuery(() => storage.exercises.toArray(), [storage]) ?? []
  const [selectingExercise, setSelectingExercise] = useState(false)
  const [replacingExercise, setReplacingExercise] = useState<number | null>(null)
  const [selectTab, setSelectTab] = useState<BodyPart>('肩')
  const [customName, setCustomName] = useState('')

  const filteredExercises = allExercises.filter(e => e.bodyPart === selectTab && typeof e.name === 'string' && e.name.toLowerCase().includes(customName.trim().toLowerCase()))

  const addExerciseFromLib = (exerciseId: string, exerciseName: string) => {
    if (finished) return
    const record = recordsFromTemplate([{ exerciseId, exerciseName, defaultSets: 1, defaultReps: 12 }], allExercises)[0]
    if (replacingExercise != null) {
      setExercises(exercises.map((ex, i) => i === replacingExercise ? record : ex))
      setFocusedExercise(replacingExercise)
      setReplacingExercise(null)
    } else {
      setFocusedExercise(exercises.length)
      setExercises([...exercises, record])
    }
    setSelectingExercise(false)
  }

  const addCustomExercise = async () => {
    if (finished) return
    const n = customName.trim()
    if (!n) return
    try {

    const id = await ensureCustomExercise(storage, n, selectTab)
    addExerciseFromLib(id, n)
    setCustomName('')
    setSelectingExercise(false)
    } catch (error) { setStorageError(error instanceof Error ? error.message : '动作保存失败，请重试') }
  }

  const finishWorkout = async () => {
    if (!sessionId) return
    try {
    if (timerRef.current) clearInterval(timerRef.current)
    if (restTimerRef.current) clearInterval(restTimerRef.current)
    // 丢掉还没落库的防抖写入，免得它在记录被删掉之后又 update 一次
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)

    const duration = session?.startTime
      ? Math.floor((now - session.startTime) / 1000)
      : 0

    // 不足 1 分钟的力量训练直接丢弃，不留空记录。
    // 休息日不走这条路径——它在 Home 就以 finished: true 建好，直接进详情页。
    // 有氧豁免：爬几趟楼梯就是几十秒，把记录删掉反而是丢数据（用户要能事后手改时长）。
    if (isTooShortToRecord(duration, { aerobic: session?.aerobic === true })) {
      await storage.sessions.delete(sessionId)
      setDiscardedSeconds(duration)
      setFinished(true)
      return
    }

    setFinalElapsed(duration)
    setDurationInput(secondsToMinutesInput(duration))
    await storage.sessions.update(sessionId, {
      // 每个动作存一份训练时生效的组间歇快照：模板/动作库之后可能被改，
      // 历史详情页要还原的是「当时歇了多久」
      exercises: exercises.map((ex, i) => ({ ...ex, restSeconds: restFor(i) })),
      duration,
      finished: true,
      restEndTime: undefined,
      distance: distance ? Number(distance) : undefined,
      // 备注和 exercises 一起 flush：刚敲完字就结束训练时，防抖还没跑完
      notes: notesInput.trim() || undefined,
    })
    setFinished(true)
    setShowSummary(true)
    } catch { reportSaveError() }
  }

  // 有氧结束后修正时长 / 距离。时长输入的是分钟，落库换算成秒。
  // 空值或非正数一律当作「时长未知」存 0，和 AddSession 的口径一致。
  const saveAerobicField = async (field: 'duration' | 'distance', raw: string) => {
    if (!sessionId) return
    if (accountMode && finished) return
    if (field === 'duration') {
      const minutes = Number(raw)
      await storage.sessions.update(sessionId, {
        duration: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0,
      })
      return
    }
    const km = Number(raw)
    await storage.sessions.update(sessionId, {
      distance: raw && Number.isFinite(km) ? km : undefined,
    })
  }

  // 太短被丢弃时给一个明确的说明页——静默跳回首页会让用户以为已经存上了。
  // 必须放在下面那个加载态判断之前：记录已被删除，session 会变成 undefined。
  if (discardedSeconds !== null) {
    return (
      <div className="min-h-screen bg-surface-0 flex flex-col">
        <Header title="未记录" />
        <div className="flex-1 px-8 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-surface-1 border border-border flex items-center justify-center mb-5">
            <Timer size={26} className="text-muted" />
          </div>
          <h2 className="text-lg font-bold text-primary mb-2">训练不足 1 分钟</h2>
          <p className="text-secondary text-sm leading-relaxed mb-8">
            本次只练了 {formatTime(discardedSeconds)}，太短了。
            <br />
            已丢弃，没有写入训练记录。
          </p>
          <button
            onClick={() => navigate(homePath)}
            className="ui-primary w-full max-w-xs"
          >
            返回首页
          </button>
        </div>
      </div>
    )
  }

  if (!session || !loaded) {
    return (
      <div className="min-h-screen bg-surface-0 flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        <button
          onClick={() => navigate(homePath)}
          className="text-secondary text-sm active:text-primary transition-colors"
        >
          返回首页
        </button>
      </div>
    )
  }

  const isAerobic = session.aerobic === true

  const totalSets = exercises.reduce((sum, ex) => sum + ex.sets.length, 0)
  const completedSets = exercises.reduce((sum, ex) => sum + ex.sets.filter((s) => s.completed).length, 0)
  // 有效组 = 已完成且非热身。进度条仍用 completedSets（它衡量「有没有都勾完」），
  // 但总结页对外展示的数字必须排除热身，否则热身会把成绩算得偏乐观。
  const workingSets = exercises.reduce((sum, ex) => sum + ex.sets.filter(isCountedSet).length, 0)
  const completedExercises = exercises.filter((ex) => ex.sets.some(isCountedSet))
  const progress = totalSets > 0 ? (completedSets / totalSets) * 100 : 0

  if (showSummary) {
    return (
      <div className="ui-page workout-summary">
        <Header title="训练回顾" />
        <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
          {storageError && <p role="alert" className="ui-notice text-red-500">{storageError}</p>}
          <section className="summary-heading"><span className="plan-symbol"><Trophy size={28} /></span><p className="ui-eyebrow mt-5">本次训练已结束</p><h2 className="mt-2 text-3xl font-semibold">完成，收下今天的积累。</h2><p className="mt-3 text-sm text-secondary">{session.templateName || '自由训练'} · {new Date(session.date).toLocaleDateString('zh-CN')}</p></section>
          <div className={`summary-metrics ${isAerobic ? 'summary-aerobic' : ''}`}>
            <div><Clock size={18} /><span>训练时长</span>{isAerobic ? <label className="summary-value"><input aria-label="有氧时长（分钟）" type="number" inputMode="numeric" min="0" value={durationInput} disabled={accountMode} onChange={e => setDurationInput(e.target.value)} onBlur={() => saveAerobicField('duration', durationInput)} placeholder="0" /><small>分钟</small></label> : <strong>{formatTime(elapsed)}</strong>}</div>
            {isAerobic ? <div><Route size={18} /><span>完成距离</span><label className="summary-value"><input aria-label="有氧距离（公里）" type="number" inputMode="decimal" value={distance} disabled={accountMode} onChange={e => setDistance(e.target.value)} onBlur={() => saveAerobicField('distance', distance)} placeholder="0" step="0.1" /><small>km</small></label></div> : <><div><Dumbbell size={18} /><span>完成动作</span><strong>{completedExercises.length}<small>个</small></strong></div><div><ListChecks size={18} /><span>有效工作组</span><strong>{workingSets}<small>组</small></strong></div></>}
          </div>
          {!isAerobic && <section><div className="mb-3 flex items-center justify-between"><h3 className="ui-section-title">训练明细</h3><span className="text-xs text-secondary">仅展示有效工作组</span></div><div className="space-y-3">{exercises.filter(ex => ex.sets.some(isCountedSet)).map((ex, idx) => {
            const doneSets = ex.sets.filter(isCountedSet)
            return <article key={ex.id ?? idx} className="ui-panel"><div className="mb-4 flex items-center justify-between gap-3"><h4 className="font-semibold">{ex.exerciseName}</h4><span className="text-xs text-accent-light">{ex.sets.some(set => set.warmup) && <span className="mr-2 text-secondary">热身 {ex.sets.filter(set => set.warmup).length}</span>}{doneSets.length} 工作组</span></div><div className="summary-set-row text-xs text-secondary"><span>组</span><span>重量 kg</span><span>次数</span><span>RPE</span></div>{doneSets.map((set, i) => <div key={set.id ?? i} className="summary-set-row border-t border-border text-sm tabular-nums"><span className="text-secondary">{i + 1}</span><span>{set.weight ?? '—'}</span><span>{set.reps ?? '—'}</span><span>{set.rpe ?? '—'}</span></div>)}</article>
          })}</div>{!workingSets && <p className="ui-panel text-sm text-secondary">本次没有有效工作组，可在训练记录中核对详情。</p>}</section>}
          <div className="flex flex-wrap gap-3"><button className="ui-primary flex-1" onClick={() => navigate(homePath)}>返回{accountMode ? '账号训练' : '训练首页'}</button>{!accountMode && <button className="ui-secondary flex-1" onClick={() => navigate('/history')}>查看历史记录</button>}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-0 pb-64">
      <Header
        title={session.templateName ?? '训练中'}
        showBack
        rightAction={
          <div className="flex items-center gap-1.5 text-secondary text-xs font-mono bg-surface-2 px-2.5 py-1 rounded-lg">
            <Timer size={13} className="text-accent-light" />
            {formatTime(elapsed)}
          </div>
        }
      />

      {storageError && <p role="alert" className="p-4 text-sm text-red-500">{storageError}</p>}

      {!isAerobic && (
        <div className="px-4 py-3.5 border-b border-border">
          <div className="flex items-center justify-between text-xs mb-2.5">
            <span className="text-secondary tabular-nums">{completedSets}/{totalSets} 组</span>
            <span className="text-secondary">
              {exercises.filter((ex) => ex.sets.every((s) => s.completed)).length}/{exercises.length} 完成
            </span>
          </div>
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {isAerobic ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-20">
          <div className="relative w-48 h-48 mb-8">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="43" fill="none" stroke="var(--color-surface-2)" strokeWidth="5" />
              <circle
                cx="50" cy="50" r="43" fill="none"
                stroke="url(#timerGradient)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 43}`}
                strokeDashoffset="0"
                className="transition-all duration-1000 ease-linear"
              />
              <defs>
                <linearGradient id="timerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-primary text-4xl font-bold font-mono tracking-tight">
                {formatTime(elapsed)}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-5">
          {exercises.map((ex, exIdx) => {
            const allDone = ex.sets.every((s) => s.completed)
            const prev = lastPerf[ex.exerciseId] ?? lastPerf[ex.exerciseName]
            return (
              <div key={exIdx} className={`bg-surface-1 rounded-2xl p-4 border shadow-card transition-colors duration-300 ${allDone ? 'border-accent/30' : 'border-border'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-300 ${allDone ? 'bg-accent/20' : 'bg-surface-2'}`}>
                      <span className={`text-xs font-bold ${allDone ? 'text-accent-light' : 'text-secondary'}`}>{exIdx + 1}</span>
                    </div>
                    <div>
                      <h3><button className={`min-h-11 text-left font-semibold text-sm ${allDone ? 'text-accent-light' : 'text-primary'}`} aria-expanded={focusedExercise === exIdx} onClick={() => setFocusedExercise(exIdx)}>{ex.exerciseName}<span className="ml-2 text-xs font-normal text-secondary">{focusedExercise === exIdx ? '记录中' : '展开'}</span></button></h3>
                      <p className="text-muted text-[10px] mt-0.5">
                        {ex.sets.filter(s => s.completed).length}/{ex.sets.length} 组
                      </p>
                      {prev && (
                        <p className="text-muted/80 text-[10px] mt-0.5 max-w-[190px] truncate">
                          上次 {daysAgoLabel(prev.date)}：{formatPrevSets(prev.sets)}
                        </p>
                      )}
                    </div>
                  </div>

                </div>

                <div hidden={focusedExercise !== exIdx}>
                {/* 最后一列必须定宽，不能写 auto：表头这格是空 span（宽 0），数据行那格是
                    CheckButton（44px），用 auto 会让同一套 grid-cols 算出两套列宽——
                    RPE 列整体右移 36px，标题和下面的格子对不上（实测 deltaCenter=36）。
                    表头统一 text-center，与各列居中的内容对齐。 */}
                <div className="grid grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1fr)_2.75rem_2.75rem] gap-1 items-center text-[10px] text-muted mb-1.5 px-0.5 uppercase tracking-wider text-center">
                  <span>组</span>
                  <span>重量</span>
                  <span>次数</span>
                  <span>RPE</span>
                  <span />
                </div>

                {ex.sets.map((set, setIdx) => (
                  <div key={set.id ?? setIdx}>
                  <div
                    className={`grid grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1fr)_2.75rem_2.75rem] gap-1 items-center py-2 px-0.5 rounded-xl transition-colors duration-200 ${
                      set.warmup ? 'bg-amber-500/[0.05]' : set.completed ? 'bg-accent/[0.06]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleWarmup(exIdx, setIdx)}
                      disabled={finished}
                      aria-pressed={set.warmup === true}
                      aria-label={set.warmup ? `取消第 ${setIdx + 1} 组的热身标记` : `把第 ${setIdx + 1} 组标为热身`}
                      className={`min-h-11 w-full rounded-md flex items-center justify-center text-[10px] font-mono transition-colors tap disabled:opacity-40 ${
                        set.warmup
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold'
                          : set.completed ? 'text-accent-light font-bold' : 'text-muted'
                      }`}
                    >
                      {set.warmup ? '热' : ex.sets.slice(0, setIdx + 1).filter(row => !row.warmup).length}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWheel({ exIdx, setIdx, field: 'weight' })}
                      disabled={finished}
                      aria-label={`第 ${setIdx + 1} 组重量`}
                      className="relative min-h-11 bg-surface-2 text-primary text-center py-2 pr-6 rounded-lg text-sm border border-border transition-colors disabled:opacity-40 font-mono tap min-w-0 w-full"
                    >
                      {set.weight ?? <span className="text-muted">-</span>}
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted text-[10px] pointer-events-none">kg</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWheel({ exIdx, setIdx, field: 'reps' })}
                      disabled={finished}
                      aria-label={`第 ${setIdx + 1} 组次数`}
                      className="min-h-11 bg-surface-2 text-primary text-center py-2 rounded-lg text-sm border border-border transition-colors disabled:opacity-40 font-mono tap min-w-0"
                    >
                      {set.reps ?? <span className="text-muted">-</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWheel({ exIdx, setIdx, field: 'rpe' })}
                      disabled={finished}
                      aria-label={`第 ${setIdx + 1} 组 RPE`}
                      className="min-h-11 bg-surface-2 text-primary text-center py-2 rounded-lg text-xs border border-border transition-colors disabled:opacity-40 font-mono tap min-w-0"
                    >
                      {set.rpe ?? <span className="text-muted text-[10px]">RPE</span>}
                    </button>
                    <div className="flex justify-center">
                      <CheckButton checked={set.completed} label={`${ex.exerciseName}第${setIdx + 1}组${set.completed ? '取消完成' : '完成'}`} disabled={finished} onClick={() => toggleSet(exIdx, setIdx)} />
                    </div>
                  </div>
                  {set.warmup && !finished && <button className="min-h-11 px-2 text-xs text-secondary" aria-label={`移除${ex.exerciseName}第${setIdx + 1}个热身组`} onClick={() => removeGroup(exIdx, setIdx)}>移除此热身组</button>}
                  </div>
                ))}
                {!finished && <div className="mt-3 grid grid-cols-2 gap-2"><button className="ui-secondary" onClick={() => addSet(exIdx, true)}>+ 热身组</button><button className="ui-secondary" onClick={() => addSet(exIdx)}>+ 工作组</button></div>}
                {!finished && <details className="mt-2 text-xs text-secondary"><summary className="min-h-11 cursor-pointer py-3">动作选项</summary><div className="flex flex-wrap gap-2"><button className="ui-secondary" aria-label={`${ex.exerciseName}减少一组`} onClick={() => removeSet(exIdx)} disabled={ex.sets.filter(s => !s.warmup).length <= 1}>移除最后工作组</button><button className="min-h-11 px-2 text-xs text-secondary" onClick={() => {
                  const hasInput = ex.sets.some(s => s.completed || s.weight != null || s.rpe != null)
                  if (hasInput && !window.confirm('替换后会清空本动作的组记录，模板与动作库不变，是否继续？')) return
                  setReplacingExercise(exIdx)
                  setSelectingExercise(true)
                }}>替换本次动作</button>
                  <button
                    onClick={() => removeExercise(exIdx)}
                    className="text-red-500 dark:text-red-400 text-xs min-h-11 mt-2 px-2 py-1 rounded-lg active:bg-red-500/10 transition-colors"
                  >
                    移除本次动作
                  </button>
                </div></details>}
                </div>
              </div>
            )
          })}

          {!finished && (
            <button
              onClick={() => { setReplacingExercise(null); setSelectingExercise(true) }}
              className="w-full py-3.5 border border-dashed border-surface-3 rounded-2xl text-secondary text-sm active:bg-surface-1 transition-colors tap-soft"
            >
              + 添加动作
            </button>
          )}

          {/* 训练备注。当场记下「今天肩不舒服」「换了器械」，
              回看重量下滑时能对上原因——事后想不起来是常事。 */}
          <div className="bg-surface-1 rounded-2xl p-4 border border-border shadow-card">
            <h3 className="text-primary font-semibold text-sm mb-2.5">训练备注</h3>
            <textarea
              value={notesInput}
              onChange={(e) => {
                const text = e.target.value.slice(0, MAX_NOTES_LENGTH)
                setNotesInput(text)
                if (accountMode) saveNotes(text)
              }}
              onBlur={() => saveNotes(notesInput)}
              placeholder="今天的状态、不适、器械调整…"
              rows={2}
              disabled={finished}
              className="w-full bg-surface-2 text-primary px-4 py-2.5 rounded-xl text-sm outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted resize-none disabled:opacity-40"
            />
            {notesSaved && <p className="text-accent text-[10px] mt-1.5">已保存</p>}
          </div>
        </div>
      )}

      {restRemaining > 0 && !finished && !wheel && !selectingExercise && (
        <aside aria-label="组间休息" className="fixed bottom-24 left-3 right-3 z-40 mx-auto max-w-xl rounded-2xl border border-border bg-surface-1 p-3 shadow-raised">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-xs text-secondary">组间休息</p><p role="timer" className="text-2xl font-semibold tabular-nums">{formatRestTime(restRemaining)}</p></div>
            <div className="flex gap-1.5"><button className="ui-secondary" onClick={() => addRestTime(-30)}>−30秒</button><button className="ui-secondary" onClick={() => addRestTime(30)}>+30秒</button><button className="ui-secondary" onClick={skipRest}>跳过</button></div>
          </div>
          <details className="mt-1 text-xs text-secondary"><summary className="cursor-pointer py-2">休息选项</summary><button className="ui-secondary" onClick={() => addRestTime(60)}>+1分钟</button>{notifState !== 'granted' && <p className="mt-2 leading-5">{notifState === 'denied' ? '通知未允许，将尝试声音和振动提醒。' : '锁屏或后台提醒受浏览器限制。'}</p>}</details>
        </aside>
      )}

      {selectingExercise && (
        <div className="exercise-picker fixed inset-0 z-50 bg-surface-0 flex justify-center animate-fade-in">
          <div className="picker-content flex h-full w-full max-w-2xl flex-col">
          <div className="flex items-center justify-between px-4 h-14 border-b border-border bg-surface-0/80 backdrop-blur-xl">
            <h3 className="text-primary font-semibold">{replacingExercise == null ? '添加动作' : '替换本次动作'}</h3>
            <button onClick={() => { setSelectingExercise(false); setReplacingExercise(null); setCustomName('') }} aria-label="关闭" className="p-1.5 rounded-lg active:bg-surface-2 tap">
              <X size={22} className="text-secondary" />
            </button>
          </div>

          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomExercise()}
                aria-label="搜索或新增动作" placeholder="搜索或新增动作"
                className="min-w-0 flex-1 bg-surface-2 text-primary px-4 py-2.5 rounded-xl text-sm outline-none border border-border focus:border-accent/50 transition-colors placeholder:text-muted"
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

          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border no-scrollbar">
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
                  onClick={() => addExerciseFromLib(ex.id, ex.name)}
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

      <div className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-[680px] p-4 workout-footer bg-surface-0/80 backdrop-blur-xl border-t border-border">
        <button
          onClick={finishWorkout}
          className="ui-primary w-full"
        >
          <Zap size={18} />
          结束训练
        </button>
      </div>

      {/* 自由重量动作默认键盘输入重量；其他数字保留滚轮，均可手动切换。 */}
      {wheel && (
        <NumberWheel
          title={WHEEL_CFG[wheel.field].title}
          value={exercises[wheel.exIdx]?.sets[wheel.setIdx]?.[wheel.field]}
          min={WHEEL_CFG[wheel.field].min}
          max={WHEEL_CFG[wheel.field].max}
          step={WHEEL_CFG[wheel.field].step}
          unit={WHEEL_CFG[wheel.field].unit}
          clearable
          initialMode={wheel.field === 'weight' && keyboardWeightPreferred(exercises[wheel.exIdx]?.exerciseName ?? '') ? 'keyboard' : 'wheel'}
          onClose={() => setWheel(null)}
          onConfirm={(v) => {
            if (!wheel) return
            updateSet(wheel.exIdx, wheel.setIdx, wheel.field, wheel.field === 'rpe' ? clampRpe(v) : v)
          }}
        />
      )}
    </div>
  )
}
