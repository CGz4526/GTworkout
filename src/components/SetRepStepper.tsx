import { Minus, Plus } from 'lucide-react'
import type { CountField } from '../lib/template'

export function CountStepper({ value, label, minimum, maximum, onStep }: {
  value: number; label: string; minimum: number; maximum: number; onStep: (delta: number) => void
}) {
  return <div className="count-field">
    <span className="count-label">{label}</span>
    <div className="count-control">
      <button type="button" disabled={value <= minimum} onClick={() => onStep(-1)} aria-label={`减少${label}`}><Minus size={16} /></button>
      <span className="tabular-nums">{value}</span>
      <button type="button" disabled={value >= maximum} onClick={() => onStep(1)} aria-label={`增加${label}`}><Plus size={16} /></button>
    </div>
  </div>
}

export interface SetRepStepperProps {
  sets: number
  reps: number
  onStep: (field: CountField, delta: number) => void
  className?: string
}

export default function SetRepStepper({ sets, reps, onStep, className = '' }: SetRepStepperProps) {
  return <div className={`set-rep-fields ${className}`}>
    <CountStepper value={sets} label="工作组" minimum={1} maximum={20} onStep={d => onStep('defaultSets', d)} />
    <CountStepper value={reps} label="次数" minimum={1} maximum={100} onStep={d => onStep('defaultReps', d)} />
  </div>
}
