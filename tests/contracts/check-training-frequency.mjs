import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

if (!process.argv[2]) {
  for (const zone of ['Asia/Shanghai', 'America/New_York']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), zone], { env: { ...process.env, TZ: zone }, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status || 1)
  }
  process.exit(0)
}
function load(path, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL(`../../src/lib/${path}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, require: name => {
    assert.ok(name in dependencies, `Unexpected import ${name}`)
    return dependencies[name]
  } })
  return module.exports
}
const { trainingFrequency } = load('trainingFrequency', { './date': load('date') })
const at = text => new Date(text).toISOString()
const session = (date, other = {}) => ({ date: at(date), finished: true, exercises: [{ exerciseId: 'synthetic', sets: [] }], ...other })
const now = new Date('2026-10-21T18:00:00')
const records = [
  session('2026-10-19T00:01:00'), session('2026-10-19T18:00:00'),
  session('2026-10-19T19:00:00', { aerobic: true }),
  session('2026-10-20T12:00:00', { aerobic: true }),
  session('2026-10-21T12:00:00', { exercises: [], startTime: 123 }),
  session('2026-10-21T13:00:00', { exercises: [] }),
  session('2026-10-21T14:00:00', { finished: false }),
  session('2026-10-21T19:00:00'), session('2026-10-22T12:00:00'),
  session('2026-10-18T23:59:59'), session('2026-09-13T12:00:00'),
  { date: 'invalid', finished: true, exercises: [] },
]
const before = JSON.stringify(records)
const result = trainingFrequency(records, now)
assert.equal(result.weeks.length, 6)
assert.equal(result.weeks[0].from, '2026-09-14')
assert.equal(result.current.from, '2026-10-19')
assert.equal(result.current.to, '2026-10-21')
assert.equal(result.current.total, 3)
assert.equal(result.current.both, 1)
assert.equal(result.current.strengthOnly, 1)
assert.equal(result.current.aerobicOnly, 1)
assert.equal(result.current.strengthDays, 2)
assert.equal(result.current.aerobicDays, 2)
assert.equal(result.weeks[4].total, 1)
assert.equal(result.average, .2)
assert.equal(result.elapsedDays, 3)
assert.equal(JSON.stringify(records), before)
const full = Array.from({ length: 7 }, (_, i) => session(`2026-10-${12 + i}T12:00:00`))
const complete = trainingFrequency([...full, ...full], now)
assert.equal(complete.weeks[4].total, 7)
assert.equal(complete.average, 7)
assert.equal(complete.completedWeeks, 1)
assert.equal(trainingFrequency(records.slice(0, 3), now).average, null)
const sunday = trainingFrequency(full, new Date('2026-10-18T23:59:59'))
assert.equal(sunday.current.from, '2026-10-12')
assert.equal(sunday.current.total, 7)
assert.equal(sunday.elapsedDays, 7)
const year = trainingFrequency([], new Date('2027-01-01T12:00:00'))
assert.equal(year.current.from, '2026-12-28')
assert.equal(year.current.to, '2027-01-01')
assert.equal(year.average, null)
// A DST week is still seven local days; no millisecond-based week arithmetic.
const dst = trainingFrequency([
  session('2026-11-01T00:30:00'), session('2026-11-01T02:30:00'),
  session('2026-11-02T00:01:00'),
], new Date('2026-11-04T12:00:00'))
assert.equal(dst.weeks[4].total, 1)
assert.equal(dst.current.total, 1)
console.log(`PASS ${process.argv[2]}: day deduplication, mixed days, rest/unfinished/future exclusion, exact week edges, complete-week average, year and DST boundaries; input unchanged`)
