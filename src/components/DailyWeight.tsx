import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { Scale } from 'lucide-react'
import { db } from '../db'
import { localNoonOf, toLocalDateKey } from '../lib/date'
import { setDayWeight } from '../lib/weight'

export default function DailyWeight() {
  const today = toLocalDateKey(new Date())
  const weights = useLiveQuery(() => db.weights.orderBy('date').reverse().toArray())
  const todayWeight = weights?.find(w => w.date === today)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState(today)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const open = () => {
    setDate(today)
    setValue(todayWeight ? String(todayWeight.weight) : '')
    setError('')
    setEditing(true)
  }
  const changeDate = (key: string) => {
    setDate(key)
    const existing = weights?.find(w => w.date === key)
    setValue(existing ? String(existing.weight) : '')
  }
  const close = () => {
    const original = weights?.find(w => w.date === date)
    if (value !== (original ? String(original.weight) : '') && !window.confirm('体重还未保存，放弃这次修改？')) return
    setEditing(false)
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    const kg = Number(value)
    if (!date || date > today || toLocalDateKey(localNoonOf(date)) !== date || !value.trim() || !Number.isFinite(kg) || kg <= 0 || kg > 500) {
      setError('请选择有效日期，并填写大于0、不超过500的体重。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await setDayWeight(localNoonOf(date).toISOString(), kg)
      setEditing(false)
      setMessage(`${date === today ? '今日' : date}体重已保存到本机`)
    } catch {
      setError('保存失败，输入已保留，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="ui-panel" aria-label="每日体重">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm text-secondary"><Scale size={17} />今日体重 <span className="text-xs">· 本机</span></h2>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {todayWeight ? <>{todayWeight.weight}<span className="ml-1 text-sm font-normal text-secondary">kg</span></> : <span className="text-base font-normal text-secondary">今天还没记录</span>}
          </p>
          {!todayWeight && weights?.[0] && <p className="mt-1 text-xs text-secondary">上次 {weights[0].date} · {weights[0].weight} kg</p>}
        </div>
        {!editing && <button className="ui-secondary" onClick={open} disabled={!weights}>{todayWeight ? '修改体重' : '记体重'}</button>}
      </div>
      {editing && <form onSubmit={save} className="mt-4 space-y-3">
        <label className="block text-sm text-secondary">记录日期
          <input aria-label="体重日期" type="date" value={date} max={today} onInput={e => changeDate(e.currentTarget.value)} onChange={e => changeDate(e.target.value)} disabled={busy} className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-primary" />
        </label>
        <label className="flex items-center gap-2"><span className="sr-only">体重</span>
          <input autoFocus aria-label="体重公斤" type="number" inputMode="decimal" min="0.1" max="500" step="any" value={value} onChange={e => setValue(e.target.value)} disabled={busy} className="min-h-12 w-full min-w-0 rounded-lg border border-border bg-surface-2 px-3 tabular-nums" placeholder="输入体重" />kg
        </label>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2"><button type="submit" className="ui-primary" disabled={busy}>{busy ? '保存中…' : '保存体重'}</button><button type="button" className="ui-secondary" onClick={close} disabled={busy}>取消</button></div>
      </form>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
        <span role="status">{message || '不训练的日子也可以记录'}</span>
        <Link to="/stats#weight" className="inline-flex min-h-11 items-center text-accent-light">查看体重趋势 →</Link>
      </div>
    </section>
  )
}
