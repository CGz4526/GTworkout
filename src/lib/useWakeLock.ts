import { useEffect } from 'react'

type WakeLockSentinelLike = {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

/**
 * 训练期间保持屏幕常亮。
 *
 * 注意两个浏览器行为：
 * - 切到后台或锁屏时浏览器会**自动释放**锁，回到前台必须重新申请，所以监听
 *   visibilitychange 而不是只申请一次。
 * - 申请会被拒绝（电量低、省电模式、用户设置），因此必须允许失败。
 *
 * 不支持（Firefox、Safari < 16.4）或被拒时静默降级，不影响训练本身。
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const nav = navigator as NavigatorWithWakeLock
    if (!nav.wakeLock) return

    let cancelled = false
    let sentinel: WakeLockSentinelLike | null = null

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== 'visible') return
      try {
        const s = await nav.wakeLock!.request('screen')
        // 申请是异步的，期间可能已经卸载或失活
        if (cancelled) {
          void s.release().catch(() => {})
          return
        }
        sentinel = s
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null
        })
      } catch {
        // 用户拒绝 / 电量低 / 不支持 screen 类型
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      const s = sentinel
      sentinel = null
      if (s && !s.released) void s.release().catch(() => {})
    }
  }, [enabled])
}
