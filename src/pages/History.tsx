import { useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Calendar, Image, Trash2, Plus, Database, Play, Coffee, Dumbbell, Route } from 'lucide-react'
import { db } from '../db'
import Header from '../components/Header'
import { normalizeSession } from '../lib/session'
import { localDateKeyOf } from '../lib/date'

// 把「恢复一条已结束的记录」的写库逻辑放在组件外：
// 它不依赖任何 state，属于业务逻辑而不是渲染逻辑；而且 react-hooks/purity
// 会把组件体内函数里的 Date.now() 当成渲染期调用，挪出来这个问题自然消失。
// 返回结果而不是直接 alert/navigate，导航与提示留给调用方。
type ResumeResult = 'busy' | 'missing' | 'ok'

async function resumeSession(id: string): Promise<ResumeResult> {
  const existing = await db.sessions.filter((s) => !s.finished).first()
  if (existing) return 'busy'
  const session = await db.sessions.get(id)
  if (!session) return 'missing'
  // 把 startTime 往前挪「已记录的时长」，这样重新开始后计时器从原时长接着走
  await db.sessions.update(id, {
    finished: false,
    startTime: Date.now() - session.duration * 1000,
  })
  return 'ok'
}

function SwipeableItem({ onDelete, onContinue, onClick, children }: { onDelete: () => void; onContinue?: () => void; onClick: () => void; children: React.ReactNode }) {
  const [offsetLeft, setOffsetLeft] = useState(0)
  const startX = useRef(0)
  const swiping = useRef(false)
  const btnWidth = 80

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    swiping.current = true
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping.current) return
    const diff = startX.current - e.touches[0].clientX
    if (diff > 0) {
      // swipe left: card shifts left, shows delete on right
      setOffsetLeft(-Math.min(diff, btnWidth))
    } else if (diff < 0) {
      // swipe right: card shifts right, shows continue on left
      setOffsetLeft(Math.min(-diff, btnWidth))
    } else {
      setOffsetLeft(0)
    }
  }

  const handleTouchEnd = () => {
    swiping.current = false
    if (Math.abs(offsetLeft) > btnWidth / 2) {
      setOffsetLeft(offsetLeft > 0 ? btnWidth : -btnWidth)
    } else {
      setOffsetLeft(0)
    }
  }

  const handleClick = () => {
    if (offsetLeft === 0) {
      onClick()
    } else {
      setOffsetLeft(0)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Continue button (left) */}
      {onContinue && (
        <div className="absolute left-0 top-0 bottom-0 w-20" aria-hidden={offsetLeft <= 0}>
          <button
            tabIndex={offsetLeft > 0 ? 0 : -1}
            onClick={(e) => { e.stopPropagation(); onContinue() }}
            className="w-full h-full bg-accent flex items-center justify-center active:opacity-80 transition-colors rounded-l-2xl"
          >
            <Play size={20} className="text-white" /><span className="sr-only">继续训练</span>
          </button>
        </div>
      )}

      {/* Delete button (right) */}
      <div className="absolute right-0 top-0 bottom-0 w-20" aria-hidden={offsetLeft >= 0}>
        <button
          tabIndex={offsetLeft < 0 ? 0 : -1}
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="w-full h-full bg-red-500 flex items-center justify-center active:bg-red-600 transition-colors rounded-r-2xl"
        >
          <Trash2 size={20} className="text-white" /><span className="sr-only">删除记录</span>
        </button>
      </div>

      {/* Main content */}
      <div
        className="relative bg-surface-1 transition-transform"
        role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick() } }}
        style={{ transform: `translateX(${offsetLeft}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  )
}

export default function History() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [menuId, setMenuId] = useState<string | null>(null)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const kind = params.get('kind') ?? ''
  const hasFilters = Boolean(from || to || kind)
  const setFilter = (key: string, value: string) => {
    setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  }
  const sessions =
    useLiveQuery(() =>
      db.sessions.orderBy('date').reverse().toArray().then(
        (all) => all.filter((s) => s.finished).map(normalizeSession)
      )
    ) ?? []
  const allExercises = useLiveQuery(() => db.exercises.toArray()) ?? []
  // 每日体重（weights 表是按本地日期一天一条的体重记录）。加载中是 undefined，
  // 这里刻意不用 `?? []` 兜底：那会每次渲染造一个新数组。
  const dayWeights = useLiveQuery(() => db.weights.toArray())

  // 某天的体重：先看当天的体重记录（可能来自没有训练的早上），再退回记录自带的 weight。
  const weightOf = (s: (typeof sessions)[0]): number | undefined => {
    const key = localDateKeyOf(s.date)
    if (!key) return s.weight
    return dayWeights?.find((w) => w.date === key)?.weight ?? s.weight
  }

  const getBodyParts = (s: typeof sessions[0]) => {
    if (s.aerobic) return null
    const parts = new Set<string>()

    // Keyword-based extra body parts for multi-joint exercises
    const extraParts: Record<string, string[]> = {
      '飞鸟': ['肩'],
      '双杠臂屈伸': ['三头', '肩'],
      '窄推': ['胸'],
      '硬拉': ['背'],
      '引体向上': ['二头'],
    }

    for (const ex of s.exercises) {
      // 名字可能缺失（坏备份里的动作只带 id），统一先取一个字符串再用。
      const name = typeof ex.exerciseName === 'string' ? ex.exerciseName : ''
      const def = allExercises.find((e) => e.id === ex.exerciseId)

      if (def) {
        if (def.bodyPart) parts.add(def.bodyPart)
      } else if (name) {
        const byName = allExercises.find((e) => e.name === name)
        if (byName) {
          if (byName.bodyPart) parts.add(byName.bodyPart)
        } else {
          const byPartial = allExercises.find(
            (e) => typeof e.name === 'string' && (e.name.includes(name) || name.includes(e.name)),
          )
          if (byPartial?.bodyPart) parts.add(byPartial.bodyPart)
        }
      }

      // 关键词补充部位。原来这一步在 else 之外，动作没名字时会在 .includes 上抛错。
      if (name) {
        for (const [keyword, exParts] of Object.entries(extraParts)) {
          if (name.includes(keyword)) {
            exParts.forEach(p => parts.add(p))
          }
        }
      }
    }
    return parts.size > 0 ? [...parts] : null
  }

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}时${m}分${s > 0 ? s + '秒' : ''}`
    if (m === 0) return `${s}秒`
    return `${m}分${s > 0 ? s + '秒' : ''}`
  }

  const handleDelete = async (id: string) => {
    if (confirm('确定删除这条训练记录？')) {
      await db.sessions.delete(id)
    }
  }

  const handleContinue = async (id: string) => {
    const result = await resumeSession(id)
    if (result === 'busy') {
      alert('已有进行中的训练，请先结束当前训练')
      return
    }
    if (result === 'ok') navigate(`/session/${id}`)
  }

  const grouped: Record<string, typeof sessions> = {}
  for (const s of sessions) {
    const localDate = localDateKeyOf(s.date)
    const rest = !s.aerobic && !s.exercises.length && !s.startTime
    if (from && (!localDate || localDate < from)) continue
    if (to && (!localDate || localDate > to)) continue
    if (kind === 'strength' && (s.aerobic || rest)) continue
    if (kind === 'aerobic' && !s.aerobic) continue
    if (kind === 'rest' && !rest) continue
    const parsed = new Date(s.date)
    // 日期解析不了时（坏备份 / 手改过的文件）不要把它渲染成「INVALID DATE」——
    // 给一个中性的分组名，记录本身照常显示。
    const dateKey = Number.isNaN(parsed.getTime())
      ? '日期未知'
      : parsed.toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(s)
  }

  // Within the same day, list strength sessions above aerobic ones
  // (rest days count as non-aerobic). Array.sort is stable, so sessions
  // of the same type keep their original time order.
  for (const key of Object.keys(grouped)) {
    grouped[key].sort(
      (a, b) => Number(a.aerobic === true) - Number(b.aerobic === true)
    )
  }

  return (
    <div className="ui-page">
      <Header
        title="历史"
        rightAction={
          <div className="flex items-center gap-1">
            <button
              aria-label="数据管理" onClick={() => navigate('/settings')}
              className="w-11 h-11 rounded-lg bg-surface-1 flex items-center justify-center active:bg-surface-2 transition-colors"
            >
              <Database size={16} className="text-secondary" />
            </button>
            <button
              aria-label="补录训练" onClick={() => navigate('/add-session')}
              className="w-11 h-11 rounded-lg bg-accent/10 flex items-center justify-center active:bg-accent/20 transition-colors"
            >
              <Plus size={18} className="text-accent-light" />
            </button>
          </div>
        }
      />

      <div className="content-width px-4 py-5 md:px-8">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><h2 className="text-xl font-semibold">每一次训练，都在这里</h2><div className="mt-3 flex flex-wrap gap-4 text-xs text-secondary"><span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-accent-light" />力量</span><span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border-2 border-teal-500" />有氧</span><span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-border" />休息</span></div><p className="mt-2 text-xs text-secondary">本机历史 · 账号记录请进入“我的 → 账号训练”</p></div>
        </div>
        <details className="mb-5 rounded-xl border border-border bg-surface-1 px-4">
          <summary className="min-h-11 cursor-pointer py-3 text-sm text-secondary">{hasFilters ? `筛选中 · ${from || '不限起日'} 至 ${to || '不限止日'}${kind ? ' · ' + ({ strength: '力量', aerobic: '有氧', rest: '休息' }[kind] ?? '') : ''}` : '筛选记录'}</summary>
          <div className="grid gap-3 pb-4 sm:grid-cols-3">
            <label className="text-sm text-secondary">开始日期<input aria-label="历史开始日期" type="date" value={from} onInput={e => setFilter('from', e.currentTarget.value)} onChange={e => setFilter('from', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-surface-2 px-2 text-primary" /></label>
            <label className="text-sm text-secondary">结束日期<input aria-label="历史结束日期" type="date" value={to} onInput={e => setFilter('to', e.currentTarget.value)} onChange={e => setFilter('to', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-surface-2 px-2 text-primary" /></label>
            <label className="text-sm text-secondary">训练类型<select aria-label="历史训练类型" value={kind} onChange={e => setFilter('kind', e.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-surface-2 px-2 text-primary"><option value="">全部</option><option value="strength">力量</option><option value="aerobic">有氧</option><option value="rest">休息</option></select></label>
          </div>
        </details>
        {hasFilters && <div className="mb-4 flex items-center justify-between gap-2 text-sm text-secondary"><span>{from && to && from > to ? '开始日期不能晚于结束日期' : `筛选结果 ${Object.values(grouped).reduce((n, rows) => n + rows.length, 0)} 条`}</span><button className="ui-secondary" onClick={() => setParams({})}>清除筛选</button></div>}
        {Object.keys(grouped).length === 0 ? (
          <div className="text-center py-16 animate-rise-in">
            <div className="w-14 h-14 rounded-2xl bg-surface-1 border border-border flex items-center justify-center mx-auto mb-4">
              <Calendar size={24} className="text-muted" />
            </div>
            <p className="text-secondary text-sm">{hasFilters ? '没有符合条件的训练' : '暂无训练记录'}</p>
            <p className="text-muted text-xs mt-1">完成训练后会自动记录</p>
          </div>
        ) : (
          Object.entries(grouped).map(([date, items], groupIdx) => (
            <div key={date} className="mb-6">
              <div
                className="flex items-center gap-2 mb-3 px-1 animate-rise-in"
                style={{ animationDelay: `${Math.min(groupIdx, 6) * 0.05}s` }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-accent/60" />
                <h3 className="text-secondary text-xs font-semibold uppercase tracking-wider">{date}</h3>
              </div>
              <div className="space-y-2">
                {items.map((s, idx) => {
                  const isAerobic = s.aerobic === true
                  // A rest day never ran a timer. A strength workout that was
                  // finished after deleting every exercise still has startTime,
                  // and must not be silently relabelled as a rest day.
                  const isRest = !isAerobic && s.exercises.length === 0 && !s.startTime
                  const photoCount = s.photos?.length ?? 0
                  const startTime = new Date(s.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                  const bodyParts = getBodyParts(s)
                  // 训练类型以重点色边框区分，休息日保留中性细边。
                  const cardBorder = isRest
                    ? 'border border-border'
                    : isAerobic
                      ? 'border-2 border-teal-500 dark:border-teal-400'
                      : 'border-2 border-accent-light'
                  const iconBg = isRest ? 'bg-stone-500/10' : isAerobic ? 'bg-teal-500/10' : 'bg-accent-soft'
                  const iconColor = isRest
                    ? 'text-stone-500 dark:text-stone-400'
                    : isAerobic
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-accent'
                  const RowIcon = isRest ? Coffee : isAerobic ? Route : Dumbbell
                  return (
                    // 入场动画放在**外层 wrapper** 上，不放 SwipeableItem 里那个
                    // 会被 translateX 平移的元素上——两者都动 transform，会互相顶掉。
                    <div
                      key={s.id}
                      className={`rounded-2xl overflow-hidden shadow-card animate-pop-in ${cardBorder}`}
                      style={{ animationDelay: `${Math.min(idx, 8) * 0.04}s` }}
                    >
                    <SwipeableItem
                      key={s.id}
                      onDelete={() => handleDelete(s.id)}
                      onContinue={isRest ? undefined : () => handleContinue(s.id)}
                      onClick={() => navigate(`/session-detail/${s.id}`)}
                    >
                      <div className="flex items-center gap-3.5 py-3 px-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
                          <RowIcon size={18} className={iconColor} />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <p className="font-semibold text-sm flex items-center justify-between">
                            <span className="text-primary">{s.templateName ?? '自由训练'}
                              {isAerobic && s.duration > 0 && <span className="text-muted text-xs font-normal ml-2">{formatDuration(s.duration)}</span>}
                              {!isAerobic && !isRest && <span className="text-muted text-xs font-normal ml-2">{startTime} · {formatDuration(s.duration)}</span>}
                            </span>
                            {weightOf(s) !== undefined && <span className="text-muted text-xs font-normal shrink-0 ml-2">体重：{weightOf(s)}kg</span>}
                          </p>
                          {/* 合并行：部位标签（统一单色）＋照片数＋距离＋饮食。
                              删掉了「n 动作 · n 组」那行以压缩卡片高度，使其与有氧记录高度接近。 */}
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {bodyParts && bodyParts.length > 0 && bodyParts.map((part) => (
                              <span key={part} className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-surface-2 text-secondary">{part}</span>
                            ))}
                            {isAerobic && s.distance ? (
                              <span className="text-muted text-[11px] shrink-0">{s.distance}km</span>
                            ) : null}
                            {!isAerobic && !isRest && photoCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-muted text-[10px] shrink-0">
                                <Image size={10} />
                                {photoCount}
                              </span>
                            )}
                            {s.diet && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${
                                s.diet === 'low' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' :
                                s.diet === 'mid' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' :
                                s.diet === 'high' ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' :
                                'bg-red-500/15 text-red-600 dark:text-red-400'
                              }`}>
                                {s.diet === 'low' ? '低碳' : s.diet === 'mid' ? '中碳' : s.diet === 'high' ? '高碳' : '放纵餐'}
                              </span>
                            )}
                          </div>
                        </div>
                        <button aria-label={`${s.templateName || '训练'}更多操作`} aria-expanded={menuId === s.id} className="flex min-h-11 min-w-11 items-center justify-center text-secondary" onClick={e => { e.stopPropagation(); setMenuId(menuId === s.id ? null : s.id) }} onKeyDown={e => e.stopPropagation()}>···</button>
                        <ChevronRight size={16} className="text-muted shrink-0" />
                      </div>
                    </SwipeableItem>
                    {menuId === s.id && <div className="border-t border-border bg-surface-1 px-4 pt-3 text-xs text-secondary" onClick={e => e.stopPropagation()}><div className="flex gap-3 pb-3">{!isRest && <button className="ui-secondary" onClick={() => handleContinue(s.id)}>继续训练</button>}<button className="ui-secondary text-red-500" onClick={() => handleDelete(s.id)}>删除记录</button></div></div>}
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
