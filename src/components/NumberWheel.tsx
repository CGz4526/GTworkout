import { useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, Keyboard as KeyboardIcon } from 'lucide-react'

// 一行的高度。中选行的位置和「第 i 项该滚到哪里」都按它算，改这一个值即可。
const ITEM_H = 44

/** 在候选值里找离 v 最近的一项的下标。库里可能有不在步长网格上的历史值。 */
function nearestIndex(v: number | undefined, values: number[]): number {
  if (v === undefined) return 0
  let best = Infinity
  let idx = 0
  values.forEach((x, i) => {
    const d = Math.abs(x - v)
    if (d < best) {
      best = d
      idx = i
    }
  })
  return idx
}

export interface NumberWheelProps {
  title: string
  value: number | undefined
  min: number
  max: number
  /** 步长，默认 1。0.5 这类小数步长会按两位小数取整，避免浮点误差。 */
  step?: number
  /** 数字后面的单位，如 kg / 次 */
  unit?: string
  /** 自定义显示（组间歇用 formatRest 显示「2分30秒」） */
  format?: (v: number) => string
  /** 允许留空（重量可以空着 = 自重），底部多一个「清空」 */
  clearable?: boolean
  /** 「清空」按钮的文案。组间歇用它说「恢复默认」，语义比「清空」准确。 */
  clearLabel?: string
  initialMode?: 'wheel' | 'keyboard'
  onClose: () => void
  onConfirm: (v: number | undefined) => void
}

/**
 * iOS 风格的滚轮数字选择器（底部浮层）。
 *
 * 主交互是滑动选择；底部可切到「键盘」直接输入（用户要的是「滑动优先、输入次之」）。
 * 滚轮用 CSS scroll-snap 实现，不引第三方依赖——iOS Safari 16+ 支持良好。
 *
 * **本组件只在打开时才挂载**（调用方写 `{open && <NumberWheel …/>}`），
 * 所以初始值可以直接由 props 推出来，不需要「打开时重置 state」那种 effect
 * ——在 effect 里同步 setState 会被 react-hooks/set-state-in-effect 拦下，
 * 而且那本来就是级联渲染。关闭时直接卸载，省掉清理逻辑。
 */
export default function NumberWheel({
  title,
  value,
  min,
  max,
  step = 1,
  unit,
  format,
  clearable,
  clearLabel = '清空',
  initialMode = 'wheel',
  onClose,
  onConfirm,
}: NumberWheelProps) {
  // 用整数索引累加再除以 100，避免 0.5 步长累加出 6.499999999 这种值
  const values = useMemo(() => {
    const n = Math.max(0, Math.round((max - min) / step))
    return Array.from({ length: n + 1 }, (_, i) => Math.round((min + i * step) * 100) / 100)
  }, [min, max, step])

  const [idx, setIdx] = useState(() => nearestIndex(value, values))
  const [keyboard, setKeyboard] = useState(initialMode === 'keyboard')
  const [draft, setDraft] = useState(() => (value === undefined ? '' : String(value)))
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const stopRef = useRef<number | null>(null)
  const readyRef = useRef(false)
  // 挂载时该滚到哪一格。用 ref 存住，免得把它写进 effect 依赖里
  // ——那会让用户每滑一格就被拽回原位。
  const mountIdxRef = useRef(idx)

  // 把列表滚到当前值。这是「把 React 状态写进 DOM」，不是 setState，放 effect 里正合适。
  useEffect(() => {
    readyRef.current = false
    const el = listRef.current
    if (el) el.scrollTop = mountIdxRef.current * ITEM_H
    // 程序化滚动也会触发 scroll 事件，先让它们消化掉再开始监听
    const t = window.setTimeout(() => {
      readyRef.current = true
    }, 90)
    return () => {
      window.clearTimeout(t)
      if (stopRef.current) window.clearTimeout(stopRef.current)
    }
  }, [keyboard])

  // 滚动停止（110ms 无新事件）后再更新中选值，避免滚动过程中疯狂重渲染
  const onScroll = () => {
    if (!readyRef.current) return
    if (stopRef.current) window.clearTimeout(stopRef.current)
    stopRef.current = window.setTimeout(() => {
      const el = listRef.current
      if (!el) return
      const next = Math.min(values.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)))
      mountIdxRef.current = next
      setIdx(next)
    }, 110)
  }

  const scrollTo = (i: number) => {
    mountIdxRef.current = i
    setIdx(i)
    listRef.current?.scrollTo({ top: i * ITEM_H, behavior: 'smooth' })
  }

  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const confirm = () => {
    if (keyboard) {
      const raw = draft.trim()
      if (!raw) {
        onConfirm(clearable ? undefined : values[0])
        onClose()
        return
      }
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        setError('请输入有效数字。')
        return
      }
      onConfirm(clamp(Math.round(n * 100) / 100))
    } else {
      onConfirm(values[idx])
    }
    onClose()
  }

  const label = (v: number) => (format ? format(v) : String(v))

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end">
      <button
        type="button"
        aria-label="关闭选择器"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 animate-fade-in"
      />
      <div
        className="relative mx-auto w-full max-w-lg bg-surface-1 rounded-t-3xl border-t border-border shadow-raised animate-sheet-up"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="pt-2.5 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-surface-3" />
        </div>

        <div className="flex items-center justify-between px-4 h-12">
          <button type="button" onClick={onClose} className="text-secondary text-sm tap min-h-11 min-w-11 px-2 py-1 -ml-2 rounded-lg">
            取消
          </button>
          <span className="text-primary font-semibold text-sm">{title}</span>
          <button
            type="button"
            onClick={confirm}
            className="text-accent-light text-sm font-semibold tap min-h-11 min-w-11 px-2 py-1 -mr-2 rounded-lg"
          >
            完成
          </button>
        </div>

        {keyboard ? (
          <div className="h-[220px] flex flex-col items-center justify-center px-8">
            <input
              autoFocus
              aria-label={`${title}数值`}
              type="number"
              inputMode="decimal"
              step="any"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm() } }}
              placeholder="—"
              className="number-entry-input w-full text-center text-4xl font-mono bg-transparent text-primary outline-none border-b-2 border-accent/35 pb-2 placeholder:text-muted/50"
            />
            {unit && <span className="text-muted text-xs mt-2">{unit}</span>}
            {error && <p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
          </div>
        ) : (
          <div className="relative h-[220px] overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-surface-1 to-transparent z-10" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-surface-1 to-transparent z-10" />
            <div className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 h-11 rounded-xl bg-accent/[0.07] border-y border-accent/25 z-10" />
            <div ref={listRef} onScroll={onScroll} className="h-full overflow-y-auto no-scrollbar snap-y snap-mandatory">
              {/* 上下留白，让首尾项也能滚到中选位 */}
              <div className="snap-none" style={{ height: ITEM_H * 2 }} />
              {values.map((v, i) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => scrollTo(i)}
                  className="snap-center w-full flex items-center justify-center transition-all duration-150"
                  style={{ height: ITEM_H }}
                >
                  {/* 用 tabular-nums 而不是 font-mono：RestField 传的 format 是 formatRest，
                      返回「2分30秒」含中文，而 mono 字体栈里没有 CJK 字形——数字和汉字会落成
                      两种字体，一行里很突兀。等宽数字的效果靠 tabular-nums 保住，不损失什么。 */}
                  <span
                    className={
                      i === idx
                        ? 'text-primary text-2xl font-bold tabular-nums'
                        : 'text-muted text-lg tabular-nums'
                    }
                  >
                    {label(v)}
                  </span>
                  {unit && i === idx && <span className="text-muted text-xs ml-1.5">{unit}</span>}
                </button>
              ))}
              <div className="snap-none" style={{ height: ITEM_H * 2 }} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 pt-1">
          <button
            type="button"
            onClick={() => {
              if (!keyboard) setDraft(String(values[idx]))
              else if (draft.trim() && Number.isFinite(Number(draft))) {
                const next = nearestIndex(clamp(Number(draft)), values)
                mountIdxRef.current = next
                setIdx(next)
              }
              setKeyboard(k => !k)
              setError('')
            }}
            className="flex items-center gap-1.5 text-secondary text-xs tap min-h-11 px-2.5 py-1.5 rounded-lg"
          >
            {keyboard ? <Gauge size={13} /> : <KeyboardIcon size={13} />}
            {keyboard ? '滚轮' : '键盘'}
          </button>
          {clearable && (
            <button
              type="button"
              onClick={() => {
                onConfirm(undefined)
                onClose()
              }}
              className="text-muted text-xs tap min-h-11 px-2.5 py-1.5 rounded-lg"
            >
              {clearLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
