import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'

// Compile the real helper, with real Dexie transactions over isolated in-memory IDB.
// No browser connection/profile or production database is opened.
const code = ts.transpileModule(readFileSync(new URL('../../src/lib/applyAgentPlan.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }
  vm.runInNewContext(output, { module: loaded, exports: loaded.exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`)
    return dependencies[name]
  } }, { filename: path })
  return loaded.exports
}
const types = load('src/types/index.ts')
const rest = load('src/lib/rest.ts', { '../types': types })
const template = load('src/lib/template.ts', { './rest': rest })
vm.runInNewContext(code, { module, exports: module.exports, require: name => {
  if (name !== './template') throw new Error(`Unexpected import ${name}`)
  return template
} }, { filename: 'applyAgentPlan.ts' })
const { applyAgentPlan } = module.exports
const db = new Dexie(`agent-plan-test-${crypto.randomUUID()}`)
db.version(1).stores({ templates: 'id', exercises: 'id' })
const id = crypto.randomUUID()
const item = { exerciseId: 'squat', exerciseName: '深蹲', defaultSets: 3, defaultReps: 10, restSeconds: 90 }
const draft = { id, version: 2, status: 'CONFIRMED', payload: { schemaVersion: 1, templates: [0, 1].map(i => ({ id: `ai-plan-${id}-${i}`, name: `训练${i}`, items: [item] })) } }
try {
  await db.exercises.add({ id: 'squat', name: '深蹲', bodyPart: '腿' })
  await db.templates.add({ id: 'existing', name: '原模板', items: [] })
  const results = await Promise.all([applyAgentPlan(db, draft), applyAgentPlan(db, draft)])
  assert.equal(results.reduce((a, b) => a + b), 2)
  assert.equal(await db.templates.count(), 3)
  await db.templates.update(draft.payload.templates[0].id, { name: '用户后续编辑' })
  assert.equal(await applyAgentPlan(db, draft), 0)
  assert.equal((await db.templates.get(draft.payload.templates[0].id)).name, '用户后续编辑')
  assert.equal((await db.templates.get('existing')).name, '原模板')
  assert.equal(await db.exercises.count(), 1)
  console.log('PASS: concurrent/repeated applications preserve existing templates and edits')

  const badId = crypto.randomUUID()
  const missing = { ...draft, id: badId, payload: { ...draft.payload, templates: [0, 1].map(i => ({ id: `ai-plan-${badId}-${i}`, name: '新计划', items: [{ ...item, exerciseId: i ? 'missing' : 'squat' }] })) } }
  await assert.rejects(applyAgentPlan(db, missing), /缺少计划中的动作/)
  assert.equal(await db.templates.count(), 3)
  console.log('PASS: missing exercise aborts the entire transaction without partial application')
  await assert.rejects(applyAgentPlan(db, { ...draft, status: 'DRAFT', version: 1 }), /尚未确认/)
  const malformed = structuredClone(draft)
  malformed.payload.templates[0].items[0].defaultSets = 100
  await assert.rejects(applyAgentPlan(db, malformed), /格式不正确/)
  assert.equal(await db.templates.count(), 3)
  console.log('PASS: unconfirmed and malformed payloads never write templates')
} finally {
  // Only this randomly named, in-memory test database.
  await db.delete()
}
