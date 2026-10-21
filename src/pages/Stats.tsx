import { useState, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { db } from '../db'
import { BODY_PARTS, type BodyWeight, type Exercise, type WorkoutSession } from '../types'
import Header from '../components/Header'
import { bodyPartMeta } from '../lib/bodyParts'
import { normalizeSession } from '../lib/session'
import { localNoonOf, toLocalDateKey } from '../lib/date'
import { sessionVolume } from '../lib/set'
import { trainingFrequency, type FrequencyWeek } from '../lib/trainingFrequency'

type TimeRange = '1w' | '1m' | '3m'

type Bucket = { label: string; start: number; end: number }

// 更多分析中的容量图沿用原分桶规则；频率卡独立按自然周统计。
const buildBuckets = (range: TimeRange, now: Date): Bucket[] => {
  if (range === '1w') {
    return Array.from({ length: 7 }, (_, i) => {
      const start = new Date(now)
      start.setDate(now.getDate() - (6 - i))
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(start.getDate() + 1)
      return {
        label: start.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        start: start.getTime(),
        end: end.getTime(),
      }
    })
  }
  if (range === '1m') {
    return Array.from({ length: 4 }, (_, i) => {
      const end = new Date(now)
      end.setDate(now.getDate() - (3 - i) * 7)
      end.setHours(23, 59, 59, 999)
      const start = new Date(end)
      start.setDate(end.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      return {
        label: `${start.getMonth() + 1}/${start.getDate()}周`,
        start: start.getTime(),
        end: end.getTime(),
      }
    })
  }
  return Array.from({ length: 3 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (2 - i), 1)
    const end = new Date(now.getFullYear(), now.getMonth() - (1 - i), 1)
    return { label: `${start.getMonth() + 1}月`, start: start.getTime(), end: end.getTime() }
  })
}

// 训练容量 = Σ(重量 × 次数)，只算「已完成、非热身、且填了重量」的组。
// 排除热身：不排除的话，每次开头的空杆热身会把总量算得偏乐观，
// 而且自重动作没有重量，计入只会把容量拉低成噪声。
const sessionVolumeOf = (s: WorkoutSession) => sessionVolume(s.exercises)

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

// useLiveQuery 在首次结果到达前返回 undefined。写成 `?? []` 会在**每一次渲染**
// 造出一个新数组，于是下面每个 useMemo 的依赖每帧都变、缓存全部失效。
// 用模块级常量兜底，身份才稳定。
const EMPTY_SESSIONS: WorkoutSession[] = []
const EMPTY_EXERCISES: Exercise[] = []
const EMPTY_WEIGHTS: BodyWeight[] = []

export default function Stats() {
  const navigate = useNavigate()
  const sessions = useLiveQuery(() =>
    db.sessions.orderBy('date').reverse().toArray().then(
      (all) => all.filter((s) => s.finished).map(normalizeSession)
    )
  ) ?? EMPTY_SESSIONS
  const allExercises = useLiveQuery(() => db.exercises.toArray()) ?? EMPTY_EXERCISES
  // 按天一条的体重记录（没训练的日子也有），是体重趋势的真身
  const dayWeights = useLiveQuery(() => db.weights.toArray()) ?? EMPTY_WEIGHTS

  const [timeRange, setTimeRange] = useState<TimeRange>('1w')
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })

  const cutoffDate = useMemo(() => {
    const now = new Date()
    switch (timeRange) {
      case '1w': now.setDate(now.getDate() - 7); break
      case '1m': now.setMonth(now.getMonth() - 1); break
      case '3m': now.setMonth(now.getMonth() - 3); break
    }
    return now
  }, [timeRange])

  const filteredSessions = useMemo(() =>
    sessions.filter((s) => new Date(s.date) >= cutoffDate),
    [sessions, cutoffDate]
  )

  const strengthSessions = useMemo(() =>
    filteredSessions.filter((s) => !s.aerobic && s.exercises.length > 0),
    [filteredSessions]
  )

  const aerobicSessions = useMemo(() =>
    filteredSessions.filter((s) => s.aerobic === true),
    [filteredSessions]
  )

  // Calendar heatmap data
  const calendarData = useMemo(() => {
    const { year, month } = calMonth
    const firstDay = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    // getDay(): 0=Sun, 1=Mon... We want Monday as first column
    const startOffset = (firstDay.getDay() + 6) % 7 // Monday=0

    // Build a map of date -> { strength, aerobic }
    const dateMap: Record<string, { strength: boolean; aerobic: boolean }> = {}
    for (const s of sessions) {
      const d = new Date(s.date)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const isAerobic = s.aerobic === true
      // Rest days never ran a timer; see History.tsx for the same rule.
      const isRest = !isAerobic && s.exercises.length === 0 && !s.startTime
      if (isRest) continue
      if (!dateMap[key]) dateMap[key] = { strength: false, aerobic: false }
      if (isAerobic) dateMap[key].aerobic = true
      else dateMap[key].strength = true
    }

    const cells: { day: number; strength?: boolean; aerobic?: boolean }[] = []
    for (let i = 0; i < startOffset; i++) cells.push({ day: 0 })
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${year}-${month}-${day}`
      cells.push({ day, strength: dateMap[key]?.strength, aerobic: dateMap[key]?.aerobic })
    }
    // Pad to complete weeks
    while (cells.length % 7 !== 0) cells.push({ day: 0 })

    const weeks: typeof cells[] = []
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7))
    }

    return { weeks, daysInMonth }
  }, [calMonth, sessions])

  const calLabel = `${calMonth.year}年${calMonth.month + 1}月`

  // Weight trend data (sorted by date, using days-ago for proportional spacing)
  const weightData = useMemo(() => {
    const now = new Date()
    now.setHours(23, 59, 59, 999)
    const daysAgo = (date: Date) => Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    // 按本地日期去重。weights 表是真身（含没有训练的早上记的体重），
    // session.weight 只作兜底——同一天有两条时 weights 覆盖前者。
    const byDay = new Map<string, { daysAgo: number; label: string; weight: number }>()
    for (const s of filteredSessions) {
      if (typeof s.weight !== 'number') continue
      const d = new Date(s.date)
      if (Number.isNaN(d.getTime())) continue
      byDay.set(toLocalDateKey(d), {
        daysAgo: daysAgo(d),
        label: d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        weight: s.weight,
      })
    }
    for (const w of dayWeights) {
      const d = localNoonOf(w.date)
      // 权重趋势同样要遵守「近一周/一月/三月」的范围。旧实现从 filteredSessions
      // 取数所以天然受约束；weights 表是另一份数据，必须自己按 cutoffDate 过滤，
      // 否则两年前的体重会漏进「近一周」的图里。
      if (d < cutoffDate) continue
      byDay.set(w.date, {
        daysAgo: daysAgo(d),
        label: d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        weight: w.weight,
      })
    }
    return [...byDay.values()].sort((a, b) => b.daysAgo - a.daysAgo)
  }, [filteredSessions, dayWeights, cutoffDate])

  // Body part stats (count each part once per training day)
  const bodyPartData = useMemo(() => {
    const counts: Record<string, number> = {}
    BODY_PARTS.forEach(bp => counts[bp] = 0)

    for (const s of strengthSessions) {
      // Collect unique body parts for this session
      const sessionParts = new Set<string>()
      for (const ex of s.exercises) {
        const def = allExercises.find((e) => e.id === ex.exerciseId)
        if (def) sessionParts.add(def.bodyPart)
      }
      // Each part counts once per day
      for (const part of sessionParts) {
        counts[part] = (counts[part] || 0) + 1
      }
    }

    return BODY_PARTS.map(bp => ({ name: bp, count: counts[bp], fill: bodyPartMeta(bp).hex })).filter(d => d.count > 0)
  }, [strengthSessions, allExercises])

  // Aerobic stats
  // 注意别再在这里 `const aerobicSessions = filteredSessions.filter(...)`：
  // 那会遮蔽外层的同名变量，既白跑一次过滤，又让依赖数组写错（声明的是
  // aerobicSessions、真正用到的却是 filteredSessions）。外层已经是同一个集合。
  const aerobicStats = useMemo(() => {
    const total = aerobicSessions.length
    const totalDistance = aerobicSessions.reduce((sum, s) => sum + (s.distance ?? 0), 0)
    const totalDuration = aerobicSessions.reduce((sum, s) => sum + s.duration, 0)

    // Count by type
    const byType: Record<string, number> = {}
    for (const s of aerobicSessions) {
      const name = s.templateName ?? '有氧'
      byType[name] = (byType[name] || 0) + 1
    }

    return { total, totalDistance, totalDuration, byType }
  }, [aerobicSessions])

  const frequency = useMemo(() => trainingFrequency(sessions, new Date()), [sessions])

  // Training volume per bucket — the one curve that actually shows progress,
  // which frequency/body-part counts cannot.
  const volumeData = useMemo(() => {
    const now = new Date()
    now.setHours(23, 59, 59, 999)
    const buckets = buildBuckets(timeRange, now)
    const data = buckets.map((b) => ({ day: b.label, volume: 0 }))

    for (const s of strengthSessions) {
      const vol = sessionVolumeOf(s)
      if (vol <= 0) continue
      const t = new Date(s.date).getTime()
      const i = buckets.findIndex((b) => t >= b.start && t < b.end)
      if (i >= 0) data[i].volume += vol
    }

    return { data, total: data.reduce((sum, d) => sum + d.volume, 0) }
  }, [strengthSessions, timeRange])

  // LabelList只会在有高度的分段上渲染：总数标在该周最高的非空分段上。
  const frequencyChartData = frequency.weeks.map(week => ({ ...week,
    strengthLabel: !week.aerobicOnly && !week.both ? week.total : undefined,
    aerobicLabel: !week.both ? week.total : undefined,
    bothLabel: week.total,
  }))
  const firstWeight = weightData[0]
  const lastWeight = weightData[weightData.length - 1]
  const tooltipStyle = { backgroundColor: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: 12, color: 'var(--color-primary)', fontSize: 12 }
  const tickStyle = { fontSize: 11, fill: 'var(--color-secondary)' }
  const monthCells = calendarData.weeks.flat()
  const monthStrength = monthCells.filter(c => c.strength).length
  const monthAerobic = monthCells.filter(c => c.aerobic).length
  const monthDays = monthCells.filter(c => c.strength || c.aerobic).length

  return <div className="ui-page">
    <Header title="趋势" />
    <div className="content-width space-y-5 px-4 py-5 md:px-8">
        <section className="ui-panel">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="ui-section-title">训练概览</h2><div className="flex items-center gap-1"><button aria-label="上个月" className="ui-secondary" onClick={() => setCalMonth(prev => { const d = new Date(prev.year, prev.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}><ChevronLeft size={16} /></button><button className="min-h-11 px-1 text-sm" title="回到本月" onClick={() => { const d = new Date(); setCalMonth({ year: d.getFullYear(), month: d.getMonth() }) }}>{calLabel}</button><button aria-label="下个月" className="ui-secondary" onClick={() => setCalMonth(prev => { const d = new Date(prev.year, prev.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}><ChevronRight size={16} /></button></div></div>
          <div className="grid grid-cols-7 gap-1.5">{WEEKDAYS.map(w => <span key={w} className="pb-2 text-center text-xs text-secondary">{w}</span>)}
            {monthCells.map((cell, i) => cell.day ? <button key={i} className={`relative flex min-h-11 items-center justify-center overflow-hidden rounded-lg text-sm tabular-nums ${cell.strength ? 'bg-accent text-white' : cell.aerobic ? 'bg-teal-500/15 text-primary ring-1 ring-inset ring-teal-500/60' : 'bg-surface-2 text-primary'}`} aria-label={`${calLabel}${cell.day}日${cell.strength ? ' 力量' : ''}${cell.aerobic ? ' 有氧' : ''}，查看记录`} onClick={() => { const key = toLocalDateKey(new Date(calMonth.year, calMonth.month, cell.day)); navigate(`/history?from=${key}&to=${key}`) }}><span className="relative z-10">{cell.day}</span>{cell.aerobic && <span className="absolute left-0 top-0 h-0 w-0 border-r-[18px] border-t-[18px] border-r-transparent border-t-teal-500 drop-shadow-sm" />}</button> : <span key={i} />)}
          </div>
          <p className="mt-4 text-xs leading-6 text-secondary">蓝底：力量 {monthStrength} 天 · 左上角标：有氧 {monthAerobic} 天<br />本月合计 {monthDays} 个训练日，同日力量与有氧只算一天</p>
        </section>
      <section className="ui-panel" aria-labelledby="frequency-title">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="frequency-title" className="ui-section-title">训练节奏</h2><p className="mt-1 text-xs text-secondary">最近六周 · 按训练天数看规律</p></div><span className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-light">本周进行中</span></div>
        <div className="frequency-summary"><div><span>本周已练</span><p><strong>{frequency.current.total}</strong><small>天</small></p><span>力量 {frequency.current.strengthDays} 天 · 有氧 {frequency.current.aerobicDays} 天</span></div><div><span>{frequency.completedWeeks ? `近${frequency.completedWeeks}个完整周平均` : '完整周平均'}</span><p><strong>{frequency.average?.toFixed(1) ?? '—'}</strong><small>天 / 周</small></p><span>{frequency.completedWeeks ? '不含本周和开始记录前的整周' : '完成一个自然周后显示'}</span></div></div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-secondary"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-accent-light" />仅力量</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-teal-600" />仅有氧</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-violet-500" />力量 + 有氧</span></div>
        {frequency.weeks.some(w => w.total) ? <div className="mt-4" aria-label="最近六周训练天数堆叠柱状图">
          <ResponsiveContainer width="100%" height={230}><BarChart data={frequencyChartData} margin={{ top: 22, right: 5, left: -28, bottom: 0 }} barCategoryGap="35%">
            <CartesianGrid vertical={false} stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={tickStyle} tickLine={false} axisLine={false} interval={0} />
            <YAxis interval={0} domain={[0, 7]} ticks={[0, 1, 2, 3, 4, 5, 6, 7]} tick={tickStyle} axisLine={false} tickLine={false} unit="天" />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-surface-2)' }} formatter={(value, name) => [`${value} 天`, name]} labelFormatter={(_, payload) => { const week = payload?.[0]?.payload as FrequencyWeek | undefined; return week ? `${week.from} 至 ${week.to}${week.current ? '（截至今天）' : ''}` : '' }} />
            <Bar dataKey="strengthOnly" name="仅力量" stackId="days" fill="var(--color-accent-light)" maxBarSize={34} isAnimationActive={false}><LabelList dataKey="strengthLabel" position="top" fill="var(--color-secondary)" fontSize={12} /></Bar>
            <Bar dataKey="aerobicOnly" name="仅有氧" stackId="days" fill="#0d9488" maxBarSize={34} isAnimationActive={false}><LabelList dataKey="aerobicLabel" position="top" fill="var(--color-secondary)" fontSize={12} /></Bar>
            <Bar dataKey="both" name="力量 + 有氧" stackId="days" fill="#8b5cf6" maxBarSize={34} isAnimationActive={false}><LabelList dataKey="bothLabel" position="top" fill="var(--color-secondary)" fontSize={12} /></Bar>
          </BarChart></ResponsiveContainer>
        </div> : <div className="my-5 rounded-xl bg-surface-0 px-4 py-8 text-center text-sm text-secondary">最近六周还没有已完成的训练记录。<Link className="mt-3 block text-accent-light" to="/">开始记录训练 →</Link></div>}
        <p className="mt-2 text-xs leading-5 text-secondary">每根柱代表一周，柱顶是训练总天数。同一天练多次只算一天；同时练力量和有氧记为紫色一天。仅根据已保存记录统计。</p>
        <details className="mt-2 text-sm"><summary className="min-h-11 py-3 text-secondary">每周明细与训练记录</summary><table className="w-full text-left text-xs"><caption className="sr-only">最近六周训练天数明细</caption><thead><tr className="text-secondary"><th className="py-2">周起始</th><th>合计</th><th>力量</th><th>有氧</th><th><span className="sr-only">记录</span></th></tr></thead><tbody>{frequency.weeks.map(week => <tr key={week.from} className="border-t border-border"><th className="py-3 font-normal">{week.current ? '本周至今' : week.from.slice(5).replace('-', '/')}</th><td>{week.total}天</td><td>{week.strengthDays}天</td><td>{week.aerobicDays}天</td><td className="text-right"><Link className="inline-flex min-h-11 items-center text-accent-light" to={`/history?from=${week.from}&to=${week.to}`}>查看 →</Link></td></tr>)}</tbody></table><p className="text-xs leading-5 text-secondary">力量和有氧各自按天去重，可能发生在同一天，二者相加不等于合计。</p></details>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-secondary">体重与更多分析的时间范围</p>
        <div className="inline-flex rounded-xl bg-surface-2 p-1" aria-label="统计时间范围">
          {(['1w', '1m', '3m'] as TimeRange[]).map(range => <button key={range} aria-pressed={timeRange === range} onClick={() => setTimeRange(range)} className={`min-h-11 rounded-lg px-4 text-sm ${timeRange === range ? 'bg-surface-1 font-semibold text-accent-light shadow-card' : 'text-secondary'}`}>{range === '1w' ? '近一周' : range === '1m' ? '近一月' : '近三月'}</button>)}
        </div>
      </div>
      <div className="space-y-5">

        <section id="weight" className="ui-panel scroll-mt-20">
          <div className="flex items-center justify-between"><h2 className="ui-section-title">体重趋势</h2><Link to="/" className="inline-flex min-h-11 items-center text-sm text-accent-light">记体重 →</Link></div>
          {lastWeight ? <><div className="my-3 flex flex-wrap items-end justify-between gap-2"><div><span className="text-3xl font-semibold tabular-nums">{lastWeight.weight}</span><span className="ml-1 text-sm text-secondary">kg</span><p className="mt-1 text-xs text-secondary">范围内最近记录 · {lastWeight.label}</p></div><p className="text-sm text-secondary">{weightData.length > 1 ? `较${firstWeight.label} ${lastWeight.weight - firstWeight.weight > 0 ? '+' : ''}${(lastWeight.weight - firstWeight.weight).toFixed(1)} kg` : '再记录一次后可比较'}</p></div>
            <ResponsiveContainer width="100%" height={210}><LineChart data={weightData} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--color-border)" /><XAxis dataKey="daysAgo" type="number" reversed domain={['dataMin', 'dataMax + 1']} ticks={weightData.map(p => p.daysAgo)} allowDecimals={false} tick={tickStyle} tickFormatter={v => weightData.find(p => p.daysAgo === v)?.label ?? ''} /><YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={tickStyle} /><Tooltip contentStyle={tooltipStyle} labelFormatter={v => weightData.find(p => p.daysAgo === Number(v))?.label ?? ''} formatter={v => [`${v} kg`, '实测体重']} /><Line type="linear" dataKey="weight" stroke="var(--color-accent-light)" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} /></LineChart></ResponsiveContainer>
            <details className="text-sm"><summary className="min-h-11 py-3 text-secondary">测量明细</summary><ul className="divide-y divide-border">{weightData.map(p => <li key={p.daysAgo} className="flex justify-between py-2"><span>{p.label}</span><span className="tabular-nums">{p.weight} kg</span></li>)}</ul></details>
          </> : <div className="py-12 text-center text-sm text-secondary">这个时间范围还没有体重记录<br /><Link className="mt-3 inline-flex min-h-11 items-center text-accent-light" to="/">记录第一次体重 →</Link></div>}
          <p className="mt-2 text-xs text-secondary">本机测量数据 · 未记录日期不会补成0</p>
        </section>
      </div>
      <details className="ui-panel"><summary className="ui-section-title cursor-pointer py-2">更多分析</summary><div className="mt-5 space-y-6">
        <section><h3 className="mb-3 text-sm font-semibold">力量容量 · kg·次</h3><p className="mb-2 text-xs text-secondary">已完成非热身组，合计 {volumeData.total.toLocaleString()} kg·次</p><ResponsiveContainer width="100%" height={200}><BarChart data={volumeData.data}><XAxis dataKey="day" tick={tickStyle} /><YAxis tick={tickStyle} width={55} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="volume" name="容量" fill="var(--color-accent-light)" maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></section>
        <section><h3 className="mb-3 text-sm font-semibold">各部位训练次数</h3>{bodyPartData.length ? <ResponsiveContainer width="100%" height={200}><BarChart data={bodyPartData}><XAxis dataKey="name" tick={tickStyle} /><YAxis allowDecimals={false} tick={tickStyle} width={30} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="count" name="次数" isAnimationActive={false}>{bodyPartData.map(p => <Cell key={p.name} fill={p.fill} />)}</Bar></BarChart></ResponsiveContainer> : <p className="text-sm text-secondary">该范围没有力量动作记录</p>}</section>
        <section><h3 className="mb-3 text-sm font-semibold">有氧汇总</h3><p className="text-sm text-secondary">{aerobicStats.total} 次 · {Math.round(aerobicStats.totalDuration / 60)} 分钟 · {aerobicStats.totalDistance.toFixed(1)} km</p><div className="mt-3 flex flex-wrap gap-2">{Object.entries(aerobicStats.byType).map(([name, n]) => <span key={name} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">{name} {n}次</span>)}</div></section>
        <p className="text-xs leading-6 text-secondary">本轮保留原统计口径：此处容量图按日/四周/自然月分桶；体重及有氧汇总沿用滚动一周/一月/三月筛选，边界可能不同。上方训练节奏独立按自然周与训练天数统计。</p>
      </div></details>
    </div>
  </div>
}
