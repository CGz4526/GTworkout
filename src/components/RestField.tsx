import { useState } from 'react'
import { ChevronRight, Timer } from 'lucide-react'
import NumberWheel from './NumberWheel'
import { formatRest, MAX_REST_SECONDS, MIN_REST_SECONDS } from '../lib/rest'

// 组间歇的步长。15 秒一档：30→600 共 39 档，滚轮上大概三屏，够用又不啰嗦。
const REST_STEP = 15

export interface RestFieldProps {
  /** 当前**生效**的组间歇（已解析：模板覆盖 > 动作库 > 默认）。 */
  value: number
  /** 是否由本层显式覆盖。false 时值来自动作库/默认，行内会提示「跟随动作库」。 */
  overridden: boolean
  onChange: (seconds: number) => void
  /** 传了才显示「恢复默认」（清掉本层的覆盖）。动作库自己是源头，不传。 */
  onReset?: () => void
  className?: string
}

/**
 * 组间歇的展示 + 编辑入口。
 *
 * 以前是「组间歇 [-] 2分30秒 [+]」这种紧凑步进器，塞在动作行下面一行里，
 * 又挤又难按。现在换成 iOS 设置项那种整行可点：点开弹出滚轮（和训练页
 * 重量/次数用同一个 NumberWheel），滑动选择为主。
 */
export default function RestField({ value, overridden, onChange, onReset, className = '' }: RestFieldProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`组间歇，当前 ${formatRest(value)}`}
        className={`rest-field w-full flex items-center gap-2.5 text-left ${className}`}
      >
        <Timer size={13} className="text-muted shrink-0" />
        <span className="text-sm text-secondary shrink-0">组间歇</span>
        {!overridden && <span className="text-[10px] text-muted/70 truncate">跟随动作库</span>}
        <span className="ml-auto text-primary text-sm tabular-nums shrink-0">{formatRest(value)}</span>
        <ChevronRight size={14} className="text-muted shrink-0 -mr-0.5" />
      </button>

      {open && (
        <NumberWheel
          title="组间歇"
          value={value}
          min={MIN_REST_SECONDS}
          max={MAX_REST_SECONDS}
          step={REST_STEP}
          format={formatRest}
          clearable={!!onReset}
          clearLabel="恢复默认"
          onClose={() => setOpen(false)}
          onConfirm={(v) => {
            // 滚轮的「恢复默认」传 undefined；其余情况 v 一定是 [30,600] 内的数
            if (v === undefined) onReset?.()
            else onChange(v)
          }}
        />
      )}
    </>
  )
}
