import { useLocation, useNavigate } from 'react-router-dom'
import { Home, UserRound, History, BarChart3 } from 'lucide-react'

const navItems = [
  { path: '/', icon: Home, label: '训练' },
  { path: '/stats', icon: BarChart3, label: '趋势' },
  { path: '/history', icon: History, label: '历史' },
  { path: '/settings', icon: UserRound, label: '我的' },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  // z-40 而不是 z-50：全屏浮层（动作选择、照片预览、首页底部选择层）都是 z-50。
  // 两边都写 z-50 时，DOM 里靠后的 BottomNav 会盖在浮层之上，把浮层最下面
  // 一行内容挡住。导航栏应当永远在弹层之下。
  return (
    <nav aria-label="主导航" className="app-nav">
      <span className="nav-brand">Workout<span>训练日志</span></span>
      {navItems.map(({ path, icon: Icon, label }) => {
        const route = location.pathname
        const group = route.startsWith('/template/') || route === '/pre-workout' ? '/'
          : route.startsWith('/session-detail/') || route === '/add-session' ? '/history'
          : ['/templates', '/exercises', '/cloud', '/account-training'].includes(route) || route.startsWith('/account-add-session/') ? '/settings'
          : route
        const active = group === path
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            aria-current={active ? 'page' : undefined}
            className={`nav-item ${
              active ? 'text-accent-dark dark:text-accent-light' : 'text-muted active:text-secondary'
            }`}
          >
            {/* 选中态用一枚淡色药丸托住图标，比原来的小圆点更容易一眼定位 */}
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200 ${active ? 'bg-accent-soft' : ''}`}>
              <Icon size={19} strokeWidth={active ? 2.3 : 1.8} />
            </span>
            <span className={`text-[10px] leading-none ${active ? 'font-semibold' : ''}`}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
