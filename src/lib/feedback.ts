// 训练中的提示反馈：震动 + 提示音 + 系统通知。
// 三者相互独立，任何一项不被支持都静默跳过——绝不能因为某个 API 缺失让训练页报错。

let audioCtx: AudioContext | null = null

type AudioContextCtor = typeof AudioContext

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!Ctor) return null
  try {
    audioCtx = new Ctor()
  } catch {
    return null
  }
  return audioCtx
}

// iOS/Safari 的 AudioContext 必须在用户手势中创建或 resume，否则会一直停在
// suspended，之后任何 playBeep 都不会出声。在点击「完成一组」时调用一次即可。
export function primeAudio() {
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
}

// 三声短促的「滴」。比单音更容易在健身房嘈杂环境里被注意到。
export function playBeep() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})

  const start = ctx.currentTime
  ;[0, 0.22, 0.44].forEach((offset, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    // 最后一声升到高八度，听感上更像「结束」
    osc.frequency.value = i === 2 ? 1046.5 : 880
    gain.gain.setValueAtTime(0, start + offset)
    gain.gain.linearRampToValueAtTime(0.3, start + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start + offset)
    osc.stop(start + offset + 0.2)
  })
}

// iOS Safari 至今不支持 navigator.vibrate，所以它只是「锦上添花」的那一项。
export function vibrate(pattern: number | number[]) {
  if (typeof navigator === 'undefined') return
  if (typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    // 部分浏览器在无用户手势时调用会抛错，忽略即可
  }
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

function notify(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    // silent: 提示音由 playBeep 负责，避免系统通知音和它叠在一起
    new Notification(title, { body, tag: 'rest-done', silent: true })
  } catch {
    // 某些移动端浏览器不允许直接构造 Notification，忽略
  }
}

// 休息结束的统一入口：一次调用触发全部可用通道。
export function alertRestDone() {
  vibrate([220, 120, 220, 120, 320])
  playBeep()
  notify('休息结束', '可以开始下一组了')
}
