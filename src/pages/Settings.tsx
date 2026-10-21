import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { Download, Upload } from 'lucide-react'
import { db } from '../db'
import Header from '../components/Header'

const toLocalDate = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const downloadJSON = (filename: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  // Attach to the DOM so the click reliably triggers a download across browsers
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke later — revoking synchronously can cancel an in-flight download
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export default function Settings() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const buildBackup = async () => {
    const [exercises, templates, sessions, weights] = await Promise.all([
      db.exercises.toArray(),
      db.templates.toArray(),
      db.sessions.toArray(),
      db.weights.toArray(),
    ])
    return {
      version: 3,
      exportDate: new Date().toISOString(),
      counts: {
        exercises: exercises.length,
        templates: templates.length,
        sessions: sessions.length,
        weights: weights.length,
      },
      exercises,
      templates,
      sessions,
      weights,
    }
  }

  const handleExport = async () => {
    try {
      const data = await buildBackup()
      downloadJSON(`workout-backup-${toLocalDate(new Date())}.json`, data)
      alert(
        `导出成功\n动作 ${data.counts.exercises} · 模板 ${data.counts.templates} · 训练记录 ${data.counts.sessions} · 体重 ${data.counts.weights}\n请确认浏览器已开始下载该 JSON 文件。`
      )
    } catch (err) {
      console.error('导出失败', err)
      alert('导出失败，请重试或更换浏览器')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)

      const validExercises = Array.isArray(data.exercises)
      const validTemplates =
        data.templates === undefined || Array.isArray(data.templates)
      const validSessions = Array.isArray(data.sessions)
      // weights 是可选的：version 1/2 的旧备份没有这个字段，导入时保留现有体重记录
      const validWeights = data.weights === undefined || Array.isArray(data.weights)

      if (!data.version || !validExercises || !validTemplates || !validSessions || !validWeights) {
        alert('无效的备份文件')
        return
      }

      if (!confirm('导入会覆盖当前数据，确定继续？\n（导入前会自动下载一份当前数据的备份）')) {
        return
      }

      // Safety net: snapshot current data and auto-download it first, so a
      // wrong or corrupted import can never cause an unrecoverable loss.
      const safety = await buildBackup()
      downloadJSON(`workout-backup-before-import-${toLocalDate(new Date())}.json`, safety)

      // Write inside a transaction: if any step fails, Dexie rolls everything
      // back and the existing data is left untouched.
      await db.transaction('rw', db.exercises, db.templates, db.sessions, db.weights, async () => {
        await db.exercises.clear()
        await db.templates.clear()
        await db.sessions.clear()

        if (data.exercises.length > 0) await db.exercises.bulkAdd(data.exercises)
        if (Array.isArray(data.templates) && data.templates.length > 0) {
          await db.templates.bulkAdd(data.templates)
        }
        if (data.sessions.length > 0) await db.sessions.bulkAdd(data.sessions)
        // 旧备份（version 1/2）没有 weights：不动它，别把用户按天记的体重清掉。
        // restSeconds / rpe / warmup / notes 是 version 3 才有的字段，旧备份里
        // 根本没有——缺字段的模板条目走 sanitizeItem 回落，缺 rpe 的组走
        // normalizeSession 回落，不需要在这里特判。
        if (Array.isArray(data.weights)) {
          await db.weights.clear()
          if (data.weights.length > 0) await db.weights.bulkAdd(data.weights)
        }
      })

      alert('导入成功')
      window.location.reload()
    } catch (err) {
      console.error('导入失败', err)
      alert('导入失败，已保留原有数据')
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="ui-page">
      <Header title="我的" />

      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 space-y-3">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-1 divide-y divide-border">
          <Link to="/account-training" className="block p-4 text-primary"><span className="block font-semibold">账号训练 →</span><span className="mt-1 block text-xs text-secondary">账号记录、离线补传与登录状态</span></Link>
          <Link to="/cloud" className="block p-4 text-primary"><span className="block font-semibold">AI教练与云备份 →</span><span className="mt-1 block text-xs text-secondary">选择云备份快照，分析训练并生成计划</span></Link>
          <Link to="/exercises" className="block p-4 text-primary">动作库 →</Link>
          <Link to="/templates" className="block p-4 text-primary">管理模板 →</Link>
        </div>
        <h2 className="pt-4 text-sm font-semibold text-secondary">本机数据备份</h2>
        {/* Export */}
        <button
          onClick={handleExport}
          className="w-full flex items-center gap-4 p-4 bg-surface-1 rounded-2xl border border-border shadow-card active:bg-surface-2 transition-colors tap-soft animate-rise-in"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-soft flex items-center justify-center">
            <Download size={20} className="text-accent" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-primary font-semibold text-sm">导出数据</p>
            <p className="text-muted text-xs mt-0.5">将所有数据导出为 JSON 文件</p>
          </div>
        </button>

        {/* Import */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center gap-4 p-4 bg-surface-1 rounded-2xl border border-border shadow-card active:bg-surface-2 transition-colors tap-soft animate-rise-in"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Upload size={20} className="text-blue-500 dark:text-blue-400" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-primary font-semibold text-sm">导入数据</p>
            <p className="text-muted text-xs mt-0.5">从备份文件恢复（导入前会自动备份当前数据）</p>
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />

        <p className="text-muted text-xs leading-relaxed px-1 pt-2">
          这里导出的是本机数据；账号训练在独立空间管理。模板、每日体重与照片仍在本机，换设备或清缓存前请导出备份。
        </p>
      </div>
    </div>
  )
}
