import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useLayoutEffect, useRef } from 'react'
import Home from './pages/Home'
import Exercises from './pages/Exercises'
import Templates from './pages/Templates'
import TemplateDetail from './pages/TemplateDetail'
import PreWorkout from './pages/PreWorkout'
import ActiveWorkout from './pages/ActiveWorkout'
import SessionDetail from './pages/SessionDetail'
import AddSession from './pages/AddSession'
import History from './pages/History'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Cloud from './pages/Cloud'
import AccountTraining, { AccountSessionRoute, AccountAddSessionRoute } from './pages/AccountTraining'
import BottomNav from './components/BottomNav'

function AppLayout() {
  const location = useLocation()
  const positions = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const key = location.pathname + location.search
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
    else window.scrollTo(0, positions.current.get(key) ?? 0)
    const remember = () => positions.current.set(key, window.scrollY)
    window.addEventListener('scroll', remember, { passive: true })
    return () => window.removeEventListener('scroll', remember)
  }, [location.pathname, location.search, location.hash])
  const isWorkout = location.pathname.startsWith('/session/') || location.pathname.startsWith('/account-session/')

  return (
    <div className={`min-h-screen bg-surface-0 app-shell ${isWorkout ? 'workout-shell' : ''}`}>
      {/* 趋势与历史使用宽屏布局；训练输入保持独立窄列。 */}
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/exercises" element={<Exercises />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/template/:templateId" element={<TemplateDetail />} />
          <Route path="/pre-workout" element={<PreWorkout />} />
          <Route path="/session/:sessionId" element={<ActiveWorkout />} />
          <Route path="/session-detail/:sessionId" element={<SessionDetail />} />
          <Route path="/add-session" element={<AddSession />} />
          <Route path="/history" element={<History />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/cloud" element={<Cloud />} />
          <Route path="/account-training" element={<AccountTraining />} />
          <Route path="/account-session/:accountId/:sessionId" element={<AccountSessionRoute />} />
          <Route path="/account-add-session/:accountId" element={<AccountAddSessionRoute />} />
        </Routes>
      </main>
      {!isWorkout && <BottomNav />}
    </div>
  )
}

export default function App() {
  // Keep the router in sync with the deployment base path
  // (e.g. "/workout/" on a GitHub Pages project site, "/" in dev).
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'
  return (
    <BrowserRouter basename={basename}>
      <AppLayout />
    </BrowserRouter>
  )
}
