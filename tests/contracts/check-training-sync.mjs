import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute real repository and synchronizer over isolated in-memory IndexedDB.
// No browser, project database, network or model requests.
function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, crypto, TextEncoder, Date, console,
    navigator: { onLine: true }, require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`)
      return dependencies[name]
    } }, { filename: path })
  return module.exports
}
const types = load('src/types/index.ts', {})
const rest = load('src/lib/rest.ts', { '../types': types })
const dates = load('src/lib/date.ts', {})
const data = load('src/data/accountTraining.ts', { dexie: { __esModule: true, default: Dexie }, '../lib/date': dates, '../lib/rest': rest })
const a = crypto.randomUUID(), b = crypto.randomUUID()
const dbA = data.accountDatabase(a), dbB = data.accountDatabase(b)
let peerDatabase
const makeSession = (id = crypto.randomUUID()) => ({ id, date: '2026-10-16T02:00:00.000Z', duration: 0, startTime: Date.now(),
  finished: false, templateName: '合成训练', exercises: [] })
const ack = (intent, version) => ({ session: JSON.parse(intent.body).session, version, editorDeviceId: JSON.parse(intent.body).deviceId, updatedAt: new Date().toISOString() })
let checks = 0
function pass(label) { checks++; console.log(`PASS ${checks}: ${label}`) }
try {
  const s = makeSession()
  await data.createAccountSession(a, s)
  const frozen = await dbA.outbox.toCollection().first()
  assert.equal(JSON.parse(frozen.body).expectedVersion, 0)
  await data.patchAccountSession(a, s.id, { notes: '发送中追加的备注' })
  assert.equal((await dbA.outbox.get(frozen.id)).body, frozen.body)
  pass('local document and frozen intent persist; editing never changes an in-flight body')
  await data.acknowledge(a, frozen, ack(frozen, 1))
  const next = await dbA.outbox.toCollection().first()
  assert.equal(JSON.parse(next.body).expectedVersion, 1)
  assert.equal(JSON.parse(next.body).session.notes, '发送中追加的备注')
  assert.equal((await dbA.sessions.get(s.id)).state, 'PENDING')
  pass('late acknowledgement preserves newer local input and queues the next version')
  await data.cacheLive(a, ack(frozen, 1))
  assert.equal((await dbA.sessions.get(s.id)).session.notes, '发送中追加的备注')
  pass('cloud refresh cannot overwrite pending input')
  await data.acknowledge(a, next, ack(next, 2))
  assert.equal((await dbA.sessions.get(s.id)).state, 'SYNCED')
  assert.equal(await dbA.outbox.count(), 0)
  await data.patchAccountSession(a, s.id, { finished: true, duration: 120 })
  const finished = await dbA.outbox.toCollection().first()
  assert.equal(JSON.parse(finished.body).session.status, 'COMPLETED')
  await data.acknowledge(a, finished, ack(finished, 3))
  await assert.rejects(data.patchAccountSession(a, s.id, { notes: '不能改已完成训练' }), /只读/)
  pass('completion is durable; first version forbids editing a terminal session')
  assert.equal(await dbB.sessions.count(), 0)
  assert.notEqual(await data.deviceId(dbA), await data.deviceId(dbB))
  pass('accounts have independent caches and device identities')
  const ex = { exerciseId: crypto.randomUUID(), exerciseName: '深蹲', sets: [{ completed: false }] }
  const identified = data.ensureRecordIds([ex])
  const repeated = data.ensureRecordIds(identified)
  assert.equal(identified[0].id, repeated[0].id)
  assert.equal(identified[0].sets[0].id, repeated[0].sets[0].id)
  pass('exercise record and set IDs remain stable through edits')
  const cancelled = makeSession()
  await data.createAccountSession(b, cancelled)
  const creation = await dbB.outbox.toCollection().first()
  await data.patchAccountSession(b, cancelled.id, {}, true)
  assert.equal(JSON.parse(creation.body).session.status, 'ACTIVE')
  await data.acknowledge(b, creation, ack(creation, 1))
  const cancellation = await dbB.outbox.toCollection().first()
  assert.equal(JSON.parse(cancellation.body).session.status, 'CANCELLED')
  assert.equal(JSON.parse(cancellation.body).expectedVersion, 1)
  await data.acknowledge(b, cancellation, ack(cancellation, 2))
  pass('cancellation resolves creation before sending a versioned cancellation')

  class CloudError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code } }
  let generation = 0, loggedIn = a, failOnce = true, calls = 0
  const seen = new Map()
  const api = {
    liveWrite: async (path, method, body, account) => {
      assert.equal(account, a)
      const parsed = JSON.parse(body)
      if (path === '/exercises') return { id: parsed.id }
      calls++
      let result = seen.get(parsed.mutationId)
      if (!result) { result = { session: parsed.session, version: parsed.expectedVersion + 1, editorDeviceId: parsed.deviceId, updatedAt: new Date().toISOString() }; seen.set(parsed.mutationId, result) }
      if (failOnce) { failOnce = false; throw new Error('synthetic lost response after server commit') }
      return result
    }, liveRead: async () => ({ items: [], nextCursor: null }),
  }
  const sync = load('src/sync/trainingSync.ts', {
    '../api/cloud': { CloudError, currentUser: async () => loggedIn ? { id: loggedIn } : null },
    '../api/cloudSession': { cloudSessionTicket: () => generation, isCloudSessionCurrent: ticket => generation === ticket, invalidateCloudSession: () => { generation++ } },
    '../api/workouts': api, '../data/accountTraining': data,
  })
  const lost = makeSession()
  await data.createAccountSession(a, lost)
  await sync.syncTraining(a)
  assert.equal((await dbA.sessions.get(lost.id)).state, 'PENDING')
  await sync.retryTraining(a)
  assert.equal((await dbA.sessions.get(lost.id)).state, 'SYNCED')
  assert.equal(seen.size, 1); assert.equal(calls, 2)
  pass('actual synchronizer retries the same mutation after a lost response')
  const blocked = makeSession()
  await data.patchAccountSession(a, lost.id, { finished: true, duration: 60 })
  await sync.syncTraining(a)
  await data.createAccountSession(a, blocked)
  loggedIn = b; generation++
  const before = calls
  await sync.syncTraining(a)
  assert.equal(calls, before)
  assert.equal((await dbA.sessions.get(blocked.id)).state, 'PENDING')
  pass('switching server identity never uploads account A records under account B')
  const otherDevice = { ...ack((await dbA.outbox.toCollection().first()), 1), editorDeviceId: crypto.randomUUID() }
  await data.cacheLive(b, otherDevice)
  await assert.rejects(data.patchAccountSession(b, blocked.id, { notes: 'other device' }), /原设备/)
  pass('remote active sessions are viewable but cannot be edited on another device')
  await data.cacheLive(b, { ...otherDevice, version: 2, session: { ...otherDevice.session, status: 'CANCELLED' } })
  assert.equal((await dbB.sessions.get(blocked.id)).cancelled, true)
  assert.equal((await data.accountStorage(b).sessions.toArray()).some(s => s.id === blocked.id), false)
  pass('remote cancellation hides cached active history instead of leaving a ghost workout')
  const beforeInvalid = await dbB.sessions.count()
  await assert.rejects(data.createAccountSession(b, { ...makeSession(), finished: true, exercises: [{ exerciseId: crypto.randomUUID(), exerciseName: '合成动作', sets: [{ weight: -1, reps: 10, completed: true }] }] }), /重量/)
  assert.equal(await dbB.sessions.count(), beforeInvalid)
  pass('invalid completed entry rolls back local data and intent atomically, leaving the form editable')
  const peerData = load('src/data/accountTraining.ts', { dexie: { __esModule: true, default: Dexie }, '../lib/date': dates, '../lib/rest': rest })
  peerDatabase = peerData.accountDatabase(a)
  assert.equal(await data.claimLocalEditor(a, blocked.id), true)
  assert.equal(await peerData.claimLocalEditor(a, blocked.id), false)
  await data.releaseLocalEditor(a, blocked.id)
  assert.equal(await peerData.claimLocalEditor(a, blocked.id), true)
  await peerData.patchAccountSession(a, blocked.id, { notes: '新标签页修改' })
  await peerData.releaseLocalEditor(a, blocked.id)
  await assert.rejects(data.patchAccountSession(a, blocked.id, { notes: '旧标签页过期内容' }), /其他标签页/)
  assert.equal((await dbA.sessions.get(blocked.id)).session.notes, '新标签页修改')
  pass('local editor lease fences suspended tabs even after the new editor releases its lease')
  console.log(`Training sync: ${checks} checks passed`)
} finally {
  peerDatabase?.close()
  await dbA.delete(); await dbB.delete()
}
