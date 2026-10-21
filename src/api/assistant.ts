import { cloudRequest, cloudWrite, readCloudJson, type Statistics } from './cloud'
import type { WorkoutTemplate } from '../types'

export interface AvailableExercise { id: string; name: string; bodyPart: string }
export interface CoachRequest { backupId: string; from: string; to: string; days: number; minutes: number; allowedExerciseIds: string[]; consent: boolean }
export interface CoachRun {
  id: string; backupId: string; status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; errorCode: string | null
  model: string; usage: { modelCalls: number; toolCalls: number; totalTokens: number }
  result: { draftId: string; evidence: { recent: { from: string; to: string; summary: Statistics['summary'] }; previous: { from: string; to: string; summary: Statistics['summary'] } } } | null
}
export interface PlanDraft {
  id: string; status: 'DRAFT' | 'CONFIRMED'; version: number
  payload: { schemaVersion: number; templates: WorkoutTemplate[]; estimatedMinutes: number[]; estimateAssumptions: string }
}
export async function availableExercises(backupId: string): Promise<AvailableExercise[]> {
  return readCloudJson(await cloudRequest(`/backups/${encodeURIComponent(backupId)}/available-exercises`))
}
export async function createRun(request: CoachRequest, key: string): Promise<CoachRun> {
  return readCloudJson(await cloudWrite('/assistant/runs', JSON.stringify(request), 'application/json', { 'Idempotency-Key': key }))
}
export async function getRun(id: string): Promise<CoachRun> { return readCloudJson(await cloudRequest(`/assistant/runs/${encodeURIComponent(id)}`)) }
export async function getDraft(id: string): Promise<PlanDraft> { return readCloudJson(await cloudRequest(`/plan-drafts/${encodeURIComponent(id)}`)) }
export async function confirmDraft(id: string): Promise<PlanDraft> { return readCloudJson(await cloudWrite(`/plan-drafts/${encodeURIComponent(id)}/confirm`, JSON.stringify({ version: 1 }), 'application/json')) }
