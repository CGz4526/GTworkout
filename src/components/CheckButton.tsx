import { Check } from 'lucide-react'

interface CheckButtonProps {
  checked: boolean
  onClick: () => void
  label?: string
  disabled?: boolean
}

export default function CheckButton({ checked, onClick, label, disabled }: CheckButtonProps) {
  return (
    <button
      onClick={onClick}
      type="button"
      aria-label={label ?? (checked ? '标为未完成' : '标为已完成')}
      aria-pressed={checked}
      disabled={disabled}
      className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors duration-150 ${
        checked
          ? 'bg-accent text-white animate-check-pop'
          : 'bg-surface-2 text-muted border border-surface-3 active:border-secondary'
      }`}
    >
      {checked && <Check size={18} strokeWidth={3} />}
    </button>
  )
}
