import { useState } from 'react'
import { listBackups, uploadBackup, type BackupMetadata } from '../api/cloud'
import { liveRead, liveWrite } from '../api/workouts'

interface Preview {
  backupId: string; sha256: string; timezone: string; completedSessions: number; unfinishedSkipped: number
  duplicateSessions: number; conflictSessions: number; invalidSessions: number
  templatesNotImported: number; weightsNotImported: number; photosNotImported: number; errors: string[]
}
export default function TrainingImportPanel({ account, onImported }: { account: string; onImported: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [backups, setBackups] = useState<BackupMetadata[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '导入操作失败，原始备份保持不变') }
    finally { setBusy(false) }
  }
  async function load(next?: string) {
    const page = await listBackups(next)
    setBackups(old => next ? [...old, ...page.items] : page.items); setCursor(page.nextCursor)
  }
  return <section className="ui-panel space-y-3 text-sm">
    <button className="font-semibold text-accent-light" onClick={() => { setOpen(!open); if (!open) void run(() => load()) }}>导入旧训练记录</button>
    {open && <>
      <p className="text-secondary">从自己的云备份选择来源，先预览后确认。只导入已完成训练；模板库、每日体重、照片暂不导入，原文件和本机记录保留。单批最多 1000 条原始训练。</p>
      <label className="block text-secondary">也可上传已导出的 JSON 备份<input aria-label="导入训练备份文件" type="file" accept=".json,application/json" disabled={busy} className="mt-2 block w-full text-xs" onChange={event => {
        const file = event.target.files?.[0]; if (!file) return
        void run(async () => {
          if (file.size > 20 * 1024 * 1024) throw new Error('文件不能超过 20 MiB')
          const result = await uploadBackup(file, Intl.DateTimeFormat().resolvedOptions().timeZone, crypto.randomUUID(), account)
          setSelected(result.id); setPreview(null); setConfirmed(false); await load()
          setMessage('原始备份已保存到云端，请先预览并核对日期和未导入字段。')
        })
      }} /></label>
      <select aria-label="训练导入来源" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setPreview(null); setConfirmed(false) }} className="w-full rounded-xl border border-border bg-surface-0 p-3 text-primary">
        <option value="">选择自己的备份版本</option>
        {backups.map(backup => <option key={backup.id} value={backup.id}>{new Date(backup.createdAt).toLocaleString()} · {backup.sessionCount} 条训练 · {backup.timezone}</option>)}
      </select>
      {cursor && <button disabled={busy} className="text-accent-light" onClick={() => void run(() => load(cursor))}>更多备份版本</button>}
      <button className="text-accent-light" disabled={busy || !selected} onClick={() => void run(async () => {
        setConfirmed(false); setPreview(await liveRead<Preview>(`/training-imports/${selected}/preview`, account))
      })}>预览迁移内容</button>
      {preview && <div className="space-y-2 text-secondary">
        <p>日期时区：{preview.timezone}。可识别已完成训练 {preview.completedSessions} 条，其中已有相同记录 {preview.duplicateSessions} 条。</p>
        <p>未结束跳过 {preview.unfinishedSkipped} 条；冲突 {preview.conflictSessions} 条；不支持或非法记录 {preview.invalidSessions} 条。</p>
        <p>本批不导入模板 {preview.templatesNotImported} 个、每日体重 {preview.weightsNotImported} 条、照片 {preview.photosNotImported} 张；训练上的兼容体重字段也不会迁入体重库。</p>
        {(preview.invalidSessions > 0 || preview.conflictSessions > 0) && <p className="text-red-500">请先处理冲突或不支持的内容；本批不会自动覆盖或静默跳过这些记录。</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对当前账号、时区和数量，接受只导入上述训练字段，并保留原备份。</label>
        <button disabled={busy || !confirmed || preview.invalidSessions > 0 || preview.conflictSessions > 0} className="w-full rounded-xl bg-accent p-3 text-white disabled:opacity-50" onClick={() => void run(async () => {
          const result = await liveWrite<{ imported: number; alreadyPresent: number; failed: number }>(`/training-imports/${preview.backupId}/commit`, 'POST', JSON.stringify({ confirmedSha256: preview.sha256, acceptPartialFields: true }), account)
          setMessage(`导入 ${result.imported} 条，已有 ${result.alreadyPresent} 条，失败 ${result.failed} 条。${result.failed ? '部分失败，可重试；成功记录不会重复新增。' : '原始数据保持不变。'}`)
          setConfirmed(false); await onImported()
        })}>确认导入当前账号</button>
      </div>}
      {message && <p role="status" className="break-words text-secondary">{message}</p>}
    </>}
  </section>
}
