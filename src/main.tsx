import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initDB } from './db'
import { ensureAutoRestDay } from './lib/restDay'
import { observeTrainingSession } from './sync/trainingSession'

observeTrainingSession()

initDB()
  .catch((err) => {
    console.error('数据库初始化失败，应用将以空数据启动', err)
  })
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })

// 打开 App 时补一次「昨天的休息日」。放在 render 之后，不占首屏时间；
// 失败只影响这条补录，绝不能拖垮启动（Dexie 会自动等库打开后再执行）。
ensureAutoRestDay().catch((err) => {
  console.error('自动补休息日失败', err)
})
