import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Pure API/lifetime tests. fetch and BroadcastChannel are in-memory fixtures;
// no browser, localhost connection, profile or real credentials are accessed.
function deferred() {
  let resolve
  const promise = new Promise(complete => { resolve = complete })
  return { promise, resolve }
}
const reply = (body, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function client(bus = []) {
  const messages = []
  class Channel {
    constructor(name) { this.name = name; bus.push(this) }
    postMessage(data) {
      messages.push(data)
      for (const peer of bus) if (peer !== this && peer.name === this.name) peer.onmessage?.({ data })
    }
  }
  const state = { fetch: () => { throw new Error('Unexpected mock request') }, anchors: 0 }
  const window = { setTimeout, clearTimeout, BroadcastChannel: Channel }
  function load(path, dependencies = {}) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/'))
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, window, BroadcastChannel: Channel,
      fetch: (...args) => state.fetch(...args), AbortController, URL, URLSearchParams, FormData,
      document: { createElement: () => { state.anchors++; throw new Error('Stale download must not create an anchor') } },
      require: name => { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name] },
    }, { filename: path })
    return module.exports
  }
  const session = load('src/api/cloudSession.ts')
  const cloud = load('src/api/cloud.ts', { './cloudSession': session })
  const agent = load('src/api/assistant.ts', { './cloud': cloud })
  return { session, cloud, agent, state, messages }
}
const stale = error => error.code === 'STALE_CLOUD_REQUEST'
const csrf = () => reply({ token: 'synthetic-csrf', headerName: 'X-CSRF-TOKEN' })
const cases = [
  ['late response after logout is discarded', async () => {
    const c = client(); const response = deferred(); c.state.fetch = () => response.promise
    const pending = c.cloud.listBackups()
    c.session.invalidateCloudSession('SIGNED_OUT')
    response.resolve(reply({ items: [{ id: 'old-private-backup' }], nextCursor: null }))
    await assert.rejects(pending, stale)
  }],
  ['late JSON body after account change is discarded', async () => {
    const c = client(); const started = deferred(); const body = deferred()
    c.state.fetch = async () => ({ ok: true, json: () => { started.resolve(); return body.promise } })
    const pending = c.cloud.listBackups(); await started.promise
    c.session.invalidateCloudSession('ACCOUNT_CHANGED'); body.resolve({ items: [{ id: 'old-account' }] })
    await assert.rejects(pending, stale)
  }],
  ['old 401 cannot invalidate a newer session again', async () => {
    const c = client(); const response = deferred(); const events = []
    c.session.subscribeCloudSession(reason => events.push(reason)); c.state.fetch = () => response.promise
    const pending = c.cloud.listBackups(); c.session.invalidateCloudSession('ACCOUNT_CHANGED')
    response.resolve(reply({ code: 'AUTHENTICATION_REQUIRED' }, 401))
    await assert.rejects(pending, stale); assert.deepEqual(events, ['ACCOUNT_CHANGED'])
  }],
  ['current 401 emits one invalidation', async () => {
    const c = client(); const events = []; c.session.subscribeCloudSession(reason => events.push(reason))
    c.state.fetch = async () => reply({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    await assert.rejects(c.agent.getRun('synthetic-run'), error => error.status === 401)
    assert.deepEqual(events, ['AUTHENTICATION_REQUIRED'])
  }],
  ['anonymous initial identity probe does not report a changed session', async () => {
    const c = client(); const events = []; c.session.subscribeCloudSession(reason => events.push(reason))
    const ticket = c.session.cloudSessionTicket()
    c.state.fetch = async () => reply({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    assert.equal(await c.cloud.currentUser({ allowAnonymous: true }), null)
    assert.equal(c.session.cloudSessionTicket(), ticket); assert.deepEqual(events, [])
  }],
  ['normal identity recheck still invalidates an expired session', async () => {
    const c = client(); const events = []; c.session.subscribeCloudSession(reason => events.push(reason))
    c.state.fetch = async () => reply({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    assert.equal(await c.cloud.currentUser(), null)
    assert.deepEqual(events, ['AUTHENTICATION_REQUIRED'])
  }],
  ['anonymous probe context cannot suppress protected resource invalidation', async () => {
    const c = client(); const events = []; c.session.subscribeCloudSession(reason => events.push(reason))
    c.state.fetch = async () => reply({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    await assert.rejects(c.cloud.cloudRequest('/backups', {}, { allowAnonymous: true }), error => error.status === 401)
    assert.deepEqual(events, ['AUTHENTICATION_REQUIRED'])
  }],
  ['server account mismatch invalidates current cloud state', async () => {
    const c = client(); const events = []; c.session.subscribeCloudSession(reason => events.push(reason))
    c.state.fetch = async () => reply({ code: 'ACCOUNT_CHANGED' }, 409)
    await assert.rejects(c.cloud.listBackups(), error => error.code === 'ACCOUNT_CHANGED')
    assert.deepEqual(events, ['ACCOUNT_CHANGED'])
  }],
  ['wrong password is not a session invalidation', async () => {
    const c = client(); const events = []; c.session.subscribeCloudSession(reason => events.push(reason))
    c.state.fetch = async path => path.endsWith('/auth/csrf') ? csrf() : reply({ code: 'INVALID_CREDENTIALS' }, 401)
    await assert.rejects(c.cloud.login('synthetic', 'wrong-password'), error => error.code === 'INVALID_CREDENTIALS')
    assert.deepEqual(events, [])
  }],
  ['successful login notifies other tabs without identity data', async () => {
    const bus = []; const a = client(bus); const b = client(bus); const events = []
    b.session.subscribeCloudSession(reason => events.push(reason))
    a.state.fetch = async path => path.endsWith('/auth/csrf') ? csrf() : path.endsWith('/auth/me') ? reply({ id: 'new-owner', username: 'new-name' }) : reply({ authenticated: true })
    assert.equal((await a.cloud.login('synthetic', 'synthetic-password')).id, 'new-owner')
    assert.deepEqual(events, ['ACCOUNT_CHANGED']); assert.deepEqual(a.messages, ['changed'])
  }],
  ['explicit logout notifies both local and remote subscribers', async () => {
    const bus = []; const a = client(bus); const b = client(bus); const local = []; const remote = []
    a.session.subscribeCloudSession(reason => local.push(reason)); b.session.subscribeCloudSession(reason => remote.push(reason))
    a.state.fetch = async path => path.endsWith('/auth/csrf') ? csrf() : reply(null, 204)
    await a.cloud.logout(); assert.deepEqual(local, ['SIGNED_OUT']); assert.deepEqual(remote, ['ACCOUNT_CHANGED'])
  }],
  ['unsubscribe stops UI notifications', async () => {
    const c = client(); let count = 0; const stop = c.session.subscribeCloudSession(() => count++)
    stop(); c.session.invalidateCloudSession('SIGNED_OUT'); assert.equal(count, 0)
  }],
  ['network failure is not forged into success', async () => {
    const c = client(); c.state.fetch = async () => { throw new Error('synthetic network failure') }
    await assert.rejects(c.cloud.listBackups(), /network failure/)
  }],
  ['invalidated CSRF response cannot proceed to a write', async () => {
    const c = client(); const started = deferred(); const body = deferred(); let writes = 0
    c.state.fetch = async path => {
      if (!path.endsWith('/auth/csrf')) { writes++; return reply({}) }
      return { ok: true, json: () => { started.resolve(); return body.promise } }
    }
    const pending = c.cloud.register('synthetic', 'synthetic-password'); await started.promise
    c.session.invalidateCloudSession('ACCOUNT_CHANGED'); body.resolve({ token: 'old-token', headerName: 'X-CSRF-TOKEN' })
    await assert.rejects(pending, stale); assert.equal(writes, 0)
  }],
  ['stale binary download never creates a file link', async () => {
    const c = client(); const started = deferred(); const body = deferred()
    c.state.fetch = async () => ({ ok: true, blob: () => { started.resolve(); return body.promise } })
    const pending = c.cloud.downloadBackup('synthetic-backup'); await started.promise
    c.session.invalidateCloudSession('SIGNED_OUT'); body.resolve(new Blob(['synthetic']))
    await assert.rejects(pending, stale); assert.equal(c.state.anchors, 0)
  }],
]
for (const [name, execute] of cases) { await execute(); console.log(`PASS: ${name}`) }
console.log(`PASS: ${cases.length} cloud session lifetime scenarios; zero real network requests`)
