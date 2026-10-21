import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'

const fixture = JSON.parse(readFileSync(new URL('../../server/src/test/resources/contracts/training-cases.json', import.meta.url), 'utf8'))
if (!process.argv[2]) {
  for (const zone of new Set(fixture.cases.map(item => item.timezone))) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), zone], { env: { ...process.env, TZ: zone }, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status || 1)
  }
  console.log('PASS: actual TypeScript date/set rules match all shared fixtures')
  process.exit(0)
}
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, { module, exports: module.exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`)
    return dependencies[name]
  }, Date, Number }, { filename: path })
  return module.exports
}
const set = load('src/lib/set.ts', { '../types': load('src/types/index.ts') })
const date = load('src/lib/date.ts')
for (const item of fixture.cases.filter(item => item.timezone === process.argv[2])) {
  const sessions = item.backup.sessions
  const kind = session => session.aerobic === true ? 'AEROBIC' : !(session.exercises?.length) && !session.startTime ? 'REST' : 'STRENGTH'
  const finished = sessions.filter(session => session.finished === true)
  const training = finished.filter(session => kind(session) !== 'REST')
  const summary = {
    trainingSessions: training.length,
    trainingDays: new Set(training.map(session => date.localDateKeyOf(session.date))).size,
    strengthSessions: finished.filter(session => kind(session) === 'STRENGTH').length,
    aerobicSessions: finished.filter(session => kind(session) === 'AEROBIC').length,
    restDays: new Set(finished.filter(session => kind(session) === 'REST').map(session => date.localDateKeyOf(session.date))).size,
    countedSets: finished.reduce((sum, session) => sum + set.countedSets(session.exercises || []), 0),
    volume: finished.reduce((sum, session) => sum + set.sessionVolume(session.exercises || []), 0),
    aerobicDistance: finished.filter(session => kind(session) === 'AEROBIC').reduce((sum, session) => sum + (session.distance || 0), 0),
    aerobicDuration: finished.filter(session => kind(session) === 'AEROBIC').reduce((sum, session) => sum + session.duration, 0),
  }
  assert.deepEqual(summary, item.expected.summary, item.name)
  const partDays = new Map()
  for (const session of finished.filter(session => kind(session) === 'STRENGTH')) {
    for (const exercise of session.exercises || []) {
      const part = item.backup.exercises.find(definition => definition.id === exercise.exerciseId)?.bodyPart || '未知'
      if (!partDays.has(part)) partDays.set(part, new Set())
      partDays.get(part).add(date.localDateKeyOf(session.date))
    }
  }
  assert.deepEqual(Object.fromEntries([...partDays].map(([part, days]) => [part, days.size])), item.expected.bodyParts, item.name)
  assert.deepEqual(sessions.map(session => date.localDateKeyOf(session.date)), item.expected.localDates, item.name)
  const weights = new Map()
  for (const session of [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (typeof session.weight === 'number' && session.weight > 0) {
      const localDate = date.localDateKeyOf(session.date)
      weights.set(localDate, { localDate, weight: session.weight, source: 'SESSION' })
    }
  }
  for (const weight of item.backup.weights || []) weights.set(weight.date, { localDate: weight.date, weight: weight.weight, source: 'EXPLICIT' })
  assert.deepEqual([...weights.values()].sort((a, b) => a.localDate.localeCompare(b.localDate)), item.expected.weights, item.name)
  console.log(`PASS: ${item.name}`)
}
