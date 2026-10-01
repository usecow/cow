import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import dns from 'node:dns'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { CowApp, CowServer, WorkerPool } from '../lib/app.mjs'
import { isBrowserPort } from '../lib/http-policy.mjs'

const stalledStartupWorker = new URL('./fixtures/stalled-startup-worker.mjs', import.meta.url)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cow-embedding-'))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, logger: { error() {} } })
  // Capture every generation, including overwritten references in a regression.
  const pools = new Set(), servers = new Set()
  const poolStart = WorkerPool.prototype.start, serverStart = CowServer.prototype.start
  WorkerPool.prototype.start = function(...args) { pools.add(this); return poolStart.apply(this, args) }
  CowServer.prototype.start = function(...args) { servers.add(this); return serverStart.apply(this, args) }
  t.after(async () => {
    WorkerPool.prototype.start = poolStart
    CowServer.prototype.start = serverStart
    await app.close().catch(() => {})
    await Promise.allSettled([...servers, ...pools].map(item => item.close()))
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(join(root, 'index.jsp'), 'okay')
  return { app, pools, servers }
}

async function waitFor(check) {
  for (let n = 0; n < 400; n++) { if (check()) return; await delay(5) }
  assert.fail('Condition did not settle')
}

test('concurrent initialize/start creates exactly one pair of pools and one listener; restart is fresh', async t => {
  const { app, pools, servers } = await fixture(t)
  const results = await Promise.all([app.start(), app.start(), app.initialize(), app.start()])
  assert.deepEqual(results[0], results[1])
  assert.deepEqual(results[0], results[3])
  assert.equal(pools.size, 2)
  assert.equal(servers.size, 1)
  await Promise.all([app.close(), app.close()])
  for (const pool of pools) assert.equal(pool.workers.length, 0)
  for (const server of servers) assert.equal(server.address(), null)
  const address = await app.start()
  assert.equal(await (await fetch(address.url)).text(), 'okay')
  assert.equal(pools.size, 4)
  assert.equal(servers.size, 2)
})

test('close wins before filesystem initialization and cannot resurrect after restart', async t => {
  const { app, pools } = await fixture(t)
  const pending = Promise.allSettled([app.initialize(), app.start()])
  await app.close()
  const address = await app.start()
  const results = await pending
  assert.ok(results.every(result => result.status === 'rejected'))
  assert.ok(results.every(result => result.reason.code === 'COW_APP_CLOSING'))
  assert.equal(pools.size, 2)
  assert.equal(app.address().url, address.url)
  assert.equal(await (await fetch(address.url)).text(), 'okay')
})

test('close during worker startup rejects new work and drains all startup workers', async t => {
  const { app, pools } = await fixture(t)
  // The first pair of pools never finishes starting, however fast the host,
  // so close always lands during startup; the restart uses real workers.
  const start = WorkerPool.prototype.start
  WorkerPool.prototype.start = function(...args) {
    if (pools.size < 2) this.workerURL = stalledStartupWorker
    return start.apply(this, args)
  }
  const pending = Promise.allSettled([app.start(), app.initialize()])
  await waitFor(() => pools.size === 2)
  const closed = app.close()
  await assert.rejects(app.start(), { code: 'COW_APP_CLOSING' })
  await assert.rejects(app.initialize(), { code: 'COW_APP_CLOSING' })
  assert.throws(() => app.execute({ url: '/' }), { code: 'COW_APP_CLOSING' })
  await closed
  assert.ok((await pending).every(result => result.status === 'rejected' && result.reason.code === 'COW_APP_CLOSING'))
  for (const pool of pools) assert.equal(pool.workers.length, 0)
  assert.equal(app.status().state, 'stopped')
  await app.start()
  assert.equal(Buffer.from((await app.execute({ url: '/' })).response.body).toString(), 'okay')
})

test('closing a pool during worker startup stops the workers instead of awaiting a shutdown reply', async t => {
  // A starting worker has run no page and holds nothing to close. Waiting for
  // it to load and acknowledge shutdown failed close on a busy host.
  const pool = new WorkerPool({ size: 2 })
  pool.workerURL = stalledStartupWorker
  t.after(() => pool.close())
  const started = assert.rejects(pool.start(), { code: 'COW_RUNTIME_CLOSING' })
  const exits = pool.workers.map(slot => new Promise(resolve => slot.worker.once('exit', resolve)))
  await pool.close()
  await started
  await Promise.all(exits)
  assert.equal(pool.workers.length, 0)
  assert.equal(pool.status().state, 'stopped')
})

test('failed listen releases both pools and allows a later start', async t => {
  const { app, pools } = await fixture(t)
  const occupied = createServer()
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => occupied.close(() => resolve())))
  app.options.port = occupied.address().port
  await assert.rejects(app.start(), { code: 'EADDRINUSE' })
  for (const pool of pools) assert.equal(pool.workers.length, 0)
  app.options.port = 0
  await app.start()
  assert.equal(app.status().state, 'listening')
})

test('low-level pool rejects start during close and can restart without orphan workers', async t => {
  const pool = new WorkerPool({ size: 1 })
  t.after(() => pool.close())
  await pool.start()
  const old = pool.workers.map(slot => slot.worker)
  const exits = old.map(worker => new Promise(resolve => worker.once('exit', resolve)))
  const closing = pool.close()
  await assert.rejects(pool.start(), { code: 'COW_RUNTIME_CLOSING' })
  await closing
  await Promise.all(exits)
  assert.equal(pool.workers.length, 0)
  await Promise.all([pool.start(), pool.start()])
  assert.equal(pool.workers.length, 1)
})

test('closing a listener during pending DNS prevents late listen and supports restart', async t => {
  const original = dns.lookup
  let release
  dns.lookup = function(host, ...args) {
    if (host === 'cow-lifecycle.invalid') release = () => args.at(-1)(null, [{ address: '127.0.0.1', family: 4 }])
    else return original.call(this, host, ...args)
  }
  const server = new CowServer({ host: 'cow-lifecycle.invalid', port: 0, dispatcher: {} })
  t.after(async () => { dns.lookup = original; await server.close() })
  const pending = Promise.allSettled([server.start(), server.start()])
  await waitFor(() => release)
  const native = server.httpServer
  await server.close()
  release()
  await delay(20)
  assert.ok((await pending).every(result => result.status === 'rejected'))
  assert.equal(native.listening, false)
  assert.equal(server.address(), null)
  server.host = '127.0.0.1'
  const addresses = await Promise.all([server.start(), server.start()])
  assert.deepEqual(addresses[0], addresses[1])
  assert.ok(addresses[0].port)
})

test('auto-port retries are browser-safe and bounded; explicit ports are never changed', async () => {
  assert.equal(isBrowserPort(6667), false)
  assert.equal(isBrowserPort(10080), false)
  assert.equal(isBrowserPort(8000), true)
  class FakeServer extends EventEmitter {
    constructor(ports) { super(); this.ports = ports; this.attempts = 0; this.listening = false }
    listen() { this.attempts++; this.listening = true; queueMicrotask(() => this.emit('listening')) }
    address() { return this.listening ? { port: this.ports[Math.min(this.attempts - 1, this.ports.length - 1)], address: '127.0.0.1' } : null }
    close(callback) { this.listening = false; queueMicrotask(() => callback()); return this }
    closeAllConnections() {}
  }
  for (const [port, ports, expected] of [[0, [6667, 10080, 8000], 3], [6667, [6667], 1], [0, [6667], 16]]) {
    const native = new FakeServer(ports)
    const server = new CowServer({ port, dispatcher: {} }, { createHTTPServer: () => native })
    if (expected === 16) await assert.rejects(server.start(), { code: 'COW_PORT_SELECTION_FAILED' })
    else assert.equal((await server.start()).port, ports.at(-1))
    assert.equal(native.attempts, expected)
    await server.close()
    assert.equal(native.listening, false)
  }
})
