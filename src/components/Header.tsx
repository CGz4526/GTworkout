import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import ThemeToggle from './ThemeToggle'

interface HeaderProps {
  title: string
  showBack?: boolean
  rightAction?: React.ReactNode
}

export default function Header({ title, showBack, rightAction }: HeaderProps) {
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-30 bg-surface-0/90 backdrop-blur-xl border-b border-border">
      {/* 页头沿用当前页面壳宽度，层级低于选择面板。 */}
      <div className="mx-auto flex h-16 w-full items-center gap-2 px-4">
        <div className="flex items-center gap-1 shrink-0 min-w-9">
          {showBack && (
            <button onClick={() => navigate(-1)} aria-label="返回" className="p-1 -ml-1 rounded-lg active:bg-surface-2 transition-colors tap">
              <ArrowLeft size={22} className="text-secondary" />
            </button>
          )}
        </div>
        <h1 className="flex-1 min-w-0 text-center text-base font-semibold text-primary tracking-wide truncate">{title}</h1>
        <div className="flex items-center gap-1 shrink-0 justify-end whitespace-nowrap">
          {rightAction}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
