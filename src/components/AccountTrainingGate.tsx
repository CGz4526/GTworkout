import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { currentUser } from '../api/cloud'
import { cloudSessionTicket, isCloudSessionCurrent, subscribeCloudSession } from '../api/cloudSession'
import { accountDatabase } from '../data/accountTraining'
import { watchTrainingSync } from '../sync/trainingSync'
import Header from './Header'
import { getServiceStatus } from '../api/status'

const LAST_ACCOUNT = 'workout-account-training-id'
export default function AccountTrainingGate({ accountId, children }: { accountId?: string; children: (account: string) => ReactNode }) {
  const [account, setAccount] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<string | null>(null)
  const [message, setMessage] = useState('正在确认训练账号…')
  const [warning, setWarning] = useState('')
  useEffect(() => {
    let disposed = false
    const ticket = cloudSessionTicket()
    const check = async () => {
      try {
        const user = await currentUser({ allowAnonymous: true })
        if (disposed || !isCloudSessionCurrent(ticket)) return
        if (!user) {
          const cached = accountId ?? localStorage.getItem(LAST_ACCOUNT)
          if (cached && (await accountDatabase(cached).meta.get('enabled'))?.value === 'true') {
            if (!disposed && isCloudSessionCurrent(ticket)) { setAccount(cached); setWarning('登录已过期，可继续本地记录；重新登录同一账号后才能同步。') }
          } else setMessage('请先登录对应云账号，再进入账号训练。')
          return
        }
        if (accountId && user.id !== accountId) { setMessage('请先登录对应云账号，再进入账号训练。'); return }
        const status = await getServiceStatus(AbortSignal.timeout(5000))
        if (disposed || !isCloudSessionCurrent(ticket)) return
        if (!status.capabilities.trainingWrites) { setMessage('此服务尚未启用账号训练，请使用原本机训练。现有记录保持原样。'); return }
        const database = accountDatabase(user.id)
        const enabled = await database.meta.get('enabled')
        if (disposed || !isCloudSessionCurrent(ticket)) return
        if (enabled?.value === 'true') { setAccount(user.id); localStorage.setItem(LAST_ACCOUNT, user.id) }
        else { setCandidate(user.id); setMessage(`当前账号：${user.username}。启用后新训练自动保存到账号，旧本机记录保持原样。`) }
      } catch {
        const cached = accountId ?? localStorage.getItem(LAST_ACCOUNT)
        if (!disposed && isCloudSessionCurrent(ticket) && cached) {
          try {
            if ((await accountDatabase(cached).meta.get('enabled'))?.value === 'true') { if (!disposed) { setAccount(cached); setWarning('云端暂不可达，可继续本地记录；应用保持打开并联网后自动补传。') } return }
          } catch { /* Invalid or unavailable local account cache. */ }
        }
        if (!disposed) setMessage('暂时无法确认账号，请联网登录后重试。')
      }
    }
    void check()
    const unsubscribe = subscribeCloudSession(reason => {
      if (reason !== 'AUTHENTICATION_REQUIRED') {
        disposed = true; setAccount(null); setCandidate(null); setMessage('账号已退出或切换，请重新进入账号训练。')
        const cached = accountId ?? localStorage.getItem(LAST_ACCOUNT)
        localStorage.removeItem(LAST_ACCOUNT)
        if (cached) void accountDatabase(cached).meta.put({ key: 'enabled', value: 'false' })
      } else {
        setWarning('登录已失效，本地记录仍保留；请重新登录同一账号后同步。')
      }
    })
    return () => { disposed = true; unsubscribe() }
  }, [accountId])
  useEffect(() => account ? watchTrainingSync(account) : undefined, [account])
  async function enable() {
    if (!candidate) return
    const ticket = cloudSessionTicket()
    try {
      const user = await currentUser()
      if (!isCloudSessionCurrent(ticket) || user?.id !== candidate) throw new Error('账号已变化，请重新进入')
      await accountDatabase(candidate).meta.put({ key: 'enabled', value: 'true' })
      localStorage.setItem(LAST_ACCOUNT, candidate); setAccount(candidate)
    } catch { setMessage('启用失败，请联网并重新确认账号。') }
  }
  if (account) return <>{warning && <p role="status" className="bg-surface-1 p-3 text-xs text-secondary">{warning} <Link className="text-accent" to="/cloud">前往登录</Link></p>}{children(account)}</>
  return <div className="pb-24"><Header title="账号训练" showBack /><div className="space-y-4 p-4 text-sm text-secondary">
    <p>{message}</p>
    <p>首版支持训练记录自动保存、断网补传和跨设备查看；同一次训练限原设备编辑。模板、体重和照片仍使用原本机功能，暂不随训练恢复。</p>
    {candidate && <button className="w-full rounded-xl bg-accent p-3 text-white" onClick={() => void enable()}>启用此账号训练</button>}
    <Link className="block text-accent" to="/cloud">前往云账号登录</Link><Link className="block text-accent" to="/">返回本机训练</Link>
  </div></div>
}
