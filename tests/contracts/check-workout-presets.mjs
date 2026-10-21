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
  vm.runInNewContext(code, { module, exports: module.exports, crypto, Date,
    require: name => { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name] },
  }, { filename: path })
  return module.exports
}

// 独立内存库，永远不连接WorkoutDB或浏览器数据。
const db = new Dexie(`preset-contract-${crypto.randomUUID()}`)
db.version(1).stores({ exercises: 'id', templates: 'id', sessions: 'id' })
const types = load('src/types/index.ts', {})
const rest = load('src/lib/rest.ts', { '../types': types })
const template = load('src/lib/template.ts', { '../types': types, './rest': rest })
const presets = load('src/lib/workoutPresets.ts', { '../db': { db }, './template': template })
await db.templates.add({ id: 'user-existing', name: '用户原模板', items: [] })
assert.equal(await db.exercises.count(), 0)
assert.equal(await db.templates.count(), 1)
console.log('PASS: importing preset definitions never seeds data')

const [first, second] = await Promise.all([presets.materializePreset('chest'), presets.materializePreset('chest')])
assert.equal(first.id, second.id)
assert.equal(await db.templates.count(), 2)
assert.equal(await db.exercises.count(), 3)
assert.equal(await db.sessions.count(), 0)
console.log('PASS: concurrent explicit initialization is atomic and does not start sessions')

await db.templates.update(first.id, { name: '我的修改', items: [{ ...first.items[0], defaultSets: 4, defaultReps: 8 }] })
const edited = await presets.materializePreset('chest')
assert.equal(edited.name, '我的修改')
assert.equal(edited.items.length, 1)
assert.equal(edited.items[0].defaultSets, 4)
assert.equal(await db.exercises.count(), 3)
assert.equal((await db.templates.get('user-existing')).name, '用户原模板')
console.log('PASS: subsequent use preserves user edits and unrelated templates')

for (const p of presets.WORKOUT_PRESETS) await presets.materializePreset(p.key)
assert.equal(await db.templates.count(), 7)
const arm = await presets.materializePreset('arms')
assert.deepEqual(await Promise.all(arm.items.map(async i => (await db.exercises.get(i.exerciseId)).bodyPart)), ['二头', '二头', '三头'])
assert.ok((await presets.materializePreset('core')).items.every(i => !i.exerciseName.includes('平板支撑')))
console.log('PASS: all six presets retain body parts and use repetition-based core movements')

await assert.rejects(presets.materializePreset('unknown'))
assert.equal(await db.templates.count(), 7)
db.close()
console.log('Workout presets: 5 checks passed')
