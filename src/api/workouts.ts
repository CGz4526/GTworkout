import { cloudRequest, readCloudJson, CloudError } from './cloud'

export interface LiveSet { id: string; weightKg?: number; reps?: number; completed: boolean; warmup: boolean; rpe?: number }
export interface LiveExercise { id: string; exerciseId: string; exerciseName: string; restSeconds: number; sets: LiveSet[] }
export interface LiveSession {
  id: string; type: 'STRENGTH' | 'AEROBIC' | 'REST'; status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  occurredAt: string; localDate: string; utcOffsetMinutes: number; durationSeconds: number
  startedAt?: string; templateName?: string; notes?: string; distanceKm?: number
  diet?: 'low' | 'mid' | 'high' | 'cheat'; exercises: LiveExercise[]
}
export interface LiveView { session: LiveSession; version: number; editorDeviceId: string; updatedAt: string }
export interface LivePage { items: LiveView[]; nextCursor: string | null }

export async function liveRead<T>(path: string, account: string): Promise<T> {
  return readCloudJson<T>(await cloudRequest(path, { headers: { 'X-Expected-User': account } }))
}
export async function liveWrite<T>(path: string, method: 'POST' | 'PUT', payload: string, account: string): Promise<T> {
  const csrf = await readCloudJson<{ token: string; headerName: string }>(await cloudRequest('/auth/csrf'))
  if (csrf.headerName !== 'X-CSRF-TOKEN' || typeof csrf.token !== 'string') throw new CloudError(403, 'ACCESS_DENIED')
  return readCloudJson<T>(await cloudRequest(path, { method, body: payload, headers: {
    'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf.token, 'X-Expected-User': account,
  } }))
}
