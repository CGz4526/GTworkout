type SessionReason = 'SIGNED_OUT' | 'ACCOUNT_CHANGED' | 'AUTHENTICATION_REQUIRED'
let generation = 0
const listeners = new Set<(reason: SessionReason) => void>()
const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('workout-cloud-session') : null

export function cloudSessionTicket(): number { return generation }
export function isCloudSessionCurrent(ticket: number): boolean { return generation === ticket }
export function invalidateCloudSession(reason: SessionReason, broadcast = true): void {
  generation++
  listeners.forEach(listener => listener(reason))
  if (broadcast) channel?.postMessage('changed')
}
export function subscribeCloudSession(listener: (reason: SessionReason) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
if (channel) channel.onmessage = event => {
  if (event.data === 'changed') invalidateCloudSession('ACCOUNT_CHANGED', false)
}
