import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, crypto, Date, Array,
    require: name => { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name] },
  }, { filename: path })
  return module.exports
}
const db = new Dexie(`template-workout-${crypto.randomUUID()}`)
db.version(1).stores({ templates: 'id', sessions: 'id', exercises: 'id' })
const types = load('src/types/index.ts', {})
const rest = load('src/lib/rest.ts', { '../types': types })
const normalization = load('src/lib/template.ts', { '../types': types, './rest': rest })
const rules = load('src/lib/set.ts', { '../types': types })
const api = load('src/lib/templateWorkout.ts', { '../db': { db }, './template': normalization, './rest': rest })
const item = { exerciseId: 'bench', exerciseName: '合成卧推', defaultSets: 2, defaultReps: 8, warmupSets: 1, restSeconds: 90 }
await db.exercises.add({ id: 'bench', name: '合成卧推', bodyPart: '胸' })
await db.templates.add({ id: 'test', name: '合成模板', items: [item] })
assert.equal(await db.sessions.count(), 0, 'preview/read never starts a workout')
const records = api.recordsFromTemplate([item, null, [], 42])
assert.equal(records.length, 1)
assert.equal(records[0].sets.length, 3)
assert.equal(records[0].sets[0].warmup, true)
assert.equal(records[0].sets[1].warmup, undefined)
for (const set of records[0].sets) Object.assign(set, { completed: true, weight: 20 })
assert.equal(rules.countedSets(records), 2)
assert.equal(rules.sessionVolume(records), 320)
assert.equal(api.recordsFromTemplate([{ ...item, warmupSets: Infinity }])[0].sets.length, 2)
assert.equal(api.recordsFromTemplate([{ ...item, warmupSets: 10000, defaultSets: 10000 }])[0].sets.length, 30)
assert.equal(api.recordsFromTemplate([{ ...item, warmupSets: undefined }])[0].sets.length, 3)
assert.equal(api.recordsFromTemplate([{ ...item, warmupSets: 0 }])[0].sets.length, 2)
assert.equal(api.recordsFromTemplate([{ ...item, restSeconds: undefined }])[0].restSeconds, undefined)
assert.equal(api.recordsFromTemplate([{ ...item, restSeconds: undefined }], [{ id: 'bench', restSeconds: 60 }])[0].restSeconds, 60)
console.log('PASS: warmup expansion, hostile counts and legacy templates preserve effective-set rules')

const [a, b] = await Promise.all([api.startTemplateSession('test', [item]), api.startTemplateSession('test', [item])])
assert.equal(a, b)
assert.equal(await db.sessions.count(), 1)
const active = await db.sessions.get(a)
assert.equal(active.exercises[0].sets.length, 3)
assert.equal(active.exercises[0].restSeconds, 90)
console.log('PASS: concurrent starts create one workout with warmup and rest snapshots')

await db.sessions.add({ id: 'history', finished: true, exercises: records, duration: 100 })
const before = JSON.stringify(await db.sessions.toArray())
await api.resetTemplateSetCounts()
const reset = await db.templates.get('test')
assert.equal(reset.items[0].defaultSets, 1)
assert.equal(reset.items[0].warmupSets, 1)
assert.equal(reset.items[0].restSeconds, 90)
assert.equal(JSON.stringify(await db.sessions.toArray()), before)
console.log('PASS: explicit bulk configuration edit leaves history and active workouts unchanged')

await db.sessions.update(a, { finished: true })
const rejectInsert = () => { throw new Error('synthetic insert failure') }
db.sessions.hook('creating', rejectInsert)
await assert.rejects(api.startTemplateSession('test', [{ ...item, defaultSets: 4 }]))
assert.equal((await db.templates.get('test')).items[0].defaultSets, 1)
db.sessions.hook('creating').unsubscribe(rejectInsert)
await db.templates.update('test', { items: [] })
assert.equal((await db.templates.get('test')).items.length, 0)
await assert.rejects(api.startTemplateSession('test', []))
console.log('PASS: failed start rolls back configuration, and empty-template deletion remains persistent')
db.close()
console.log('Template workout: 4 contract groups passed')
