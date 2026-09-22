import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { Compiler } from '../lib/compiler.mjs'
import { CowApp } from '../lib/app.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-compiler-'))
  const app = new CowApp({ rootDir: root, workers: 1, port: 0, logger: { error() {} }, ...options })
  t.after(async () => {
    await app.close().catch(() => {})
    assert.equal(dirname(root), tmpdir())
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  return { root, app, write: (name, content) => writeFile(join(root, name), content) }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    if (predicate()) return
    await delay(5)
  }
  assert.fail('Timed out waiting for compiler state')
}

for (const phase of ['before opening', 'during reading']) {
  test(`source cancellation ${phase} returns Cow cancellation and releases admission`, async t => {
    const f = await fixture(t)
    await f.write('index.cow', 'x'.repeat(200_000))
    await f.write('_error.cow', '<?js throw new Error("must not execute"); ?>')
    await f.app.initialize()
    const controller = new AbortController()
    const reason = new Error('cancel source read')
    const original = fs.createReadStream
    const target = join(f.root, 'index.cow')
    let source, closed
    fs.createReadStream = function(path, options) {
      if (path !== target) return original.call(this, path, options)
      if (phase === 'before opening') controller.abort(reason)
      source = original.call(this, path, options)
      closed = new Promise(resolve => source.once('close', resolve))
      if (phase === 'during reading') source.once('data', () => controller.abort(reason))
      return source
    }
    syncBuiltinESMExports()
    t.after(() => { fs.createReadStream = original; syncBuiltinESMExports() })
    await assert.rejects(f.app.execute({ url: '/' }, { signal: controller.signal }), error => {
      assert.equal(error.code, 'COW_REQUEST_CANCELLED')
      assert.equal(error.status, 499)
      assert.equal(error.cause.code, 'ABORT_ERR')
      assert.equal(error.cause.cause, reason)
      return true
    })
    await closed
    assert.ok(source.destroyed)
    assert.equal(f.app.dispatcher.compiler.pending, 0)
    assert.equal(f.app.dispatcher.compiler.cache.size, 0)
    assert.equal(f.app.dispatcher.status().admittedRequests, 0)
    assert.equal(f.app.dispatcher.status().bufferedBytes, 0)
    assert.equal(f.app.dispatcher.status().compiledBytes, 0)
    assert.equal(f.app.compilerRuntime.status().requestsAccepted, 0)
    assert.equal(f.app.runtime.status().requestsAccepted, 0)
    fs.createReadStream = original
    syncBuiltinESMExports()
    assert.equal((await f.app.execute({ url: '/' })).response.body.toString(), 'x'.repeat(200_000))
  })
}

test('compiler failures without signal cancellation retain their original identity', async t => {
  const f = await fixture(t)
  await f.write('index.cow', 'healthy')
  await f.app.initialize()
  const failure = Object.assign(new Error('adapter aborted its own operation'), { name: 'AbortError', code: 'ABORT_ERR' })
  f.app.dispatcher.compiler.transform = async () => { throw failure }
  await assert.rejects(f.app.execute({ url: '/' }, { signal: new AbortController().signal }), error => error === failure)
  assert.equal(f.app.dispatcher.compiler.pending, 0)
  assert.equal(f.app.dispatcher.status().admittedRequests, 0)
})

test('source and cold-compilation admission limits apply before transformation', async t => {
  const f = await fixture(t)
  await f.write('a.jsp', 'hello')
  await f.write('large.jsp', 'x'.repeat(20))
  let entered, resume
  const entry = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { resume = resolve })
  const compiler = new Compiler({ sourceLimit: 10, maxPending: 1,
    transform: async () => { entered(); await gate; return { code: 'export default () => {}' } } })
  await assert.rejects(compiler.compile(join(f.root, 'large.jsp')), { code: 'COW_SOURCE_TOO_LARGE' })
  const controller = new AbortController()
  const first = compiler.compile(join(f.root, 'a.jsp'), { signal: controller.signal })
  await entry
  await assert.rejects(compiler.compile(join(f.root, 'a.jsp')), { code: 'COW_COMPILE_BUSY' })
  const rejected = assert.rejects(first, { name: 'AbortError' })
  controller.abort()
  resume()
  await rejected
  assert.equal(compiler.pending, 0)
  assert.equal(compiler.cache.size, 0)
})

test('a stalled cold compilation cannot starve cached pages, static files or health', async t => {
  const f = await fixture(t, { compileTimeout: 800, compileMaxPending: 1 })
  await f.write('index.jsp', 'healthy')
  await f.write('static.txt', 'static')
  await f.write('slow.jsp', '<?js echo("slow"); ?>')
  await f.write('cold.jsp', 'cold')
  await f.app.initialize()
  // Keep the actual compiler/transport for ordinary pages, but stop depending
  // on a fixed-size page taking longer than 800 ms on every machine/compiler.
  await f.app.compilerRuntime.close()
  f.app.compilerRuntime.workerURL = new URL('./fixtures/stalled-compiler-worker.mjs', import.meta.url)
  await f.app.compilerRuntime.start()
  const spawned = f.app.compilerRuntime.status().workersSpawned
  const url = (await f.app.start()).url
  assert.equal(await (await fetch(url)).text(), 'healthy')
  const slow = fetch(url + '/slow')
  await waitFor(() => f.app.compilerRuntime.status().busyWorkers === 1)
  const started = performance.now()
  const results = await Promise.all([fetch(url), fetch(url + '/static.txt'), fetch(url + '/_cow/health'), fetch(url + '/cold')])
  assert.deepEqual(results.map(result => result.status), [200, 200, 200, 503])
  assert.ok(performance.now() - started < 600, 'HTTP waited for cold compilation')
  assert.match(await results[3].text(), /COW_COMPILE_BUSY/)
  const failed = await slow
  assert.equal(failed.status, 504)
  assert.match(await failed.text(), /COW_COMPILE_TIMEOUT/)
  assert.equal(await (await fetch(url + '/cold')).text(), 'cold')
  assert.equal(f.app.compilerRuntime.status().workersSpawned, spawned + 1)
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('cancelled cold compilation never enters the execution queue and restores compiler capacity', async t => {
  const f = await fixture(t, { compileTimeout: 5000 })
  await f.write('slow.jsp', '<?js echo("slow"); ?>')
  await f.write('index.jsp', 'healthy')
  await f.app.initialize()
  await f.app.compilerRuntime.close()
  f.app.compilerRuntime.workerURL = new URL('./fixtures/stalled-compiler-worker.mjs', import.meta.url)
  await f.app.compilerRuntime.start()
  const spawned = f.app.compilerRuntime.status().workersSpawned
  const controller = new AbortController()
  const pending = f.app.execute({ url: '/slow' }, { signal: controller.signal })
  const rejected = assert.rejects(pending, { code: 'COW_REQUEST_CANCELLED' })
  await waitFor(() => f.app.compilerRuntime.status().busyWorkers === 1)
  controller.abort()
  await rejected
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
  const result = await f.app.execute({ url: '/' })
  assert.equal(Buffer.from(result.response.body).toString(), 'healthy')
  assert.equal(f.app.compilerRuntime.status().workersSpawned, spawned + 1)
})

test('main and included templates enforce source limits and retain compile error locations', async t => {
  const f = await fixture(t, { sourceLimit: 128 })
  await f.write('index.jsp', 'healthy')
  await f.write('large.jsp', 'x'.repeat(129))
  await f.write('_large.jsp', 'x'.repeat(129))
  await f.write('include.jsp', '<?js await include("./_large.jsp"); ?>')
  await f.write('bad.tsp', '<h1>Title</h1>\r\n<?ts const x: = 3; ?>')
  await f.app.initialize()
  for (const url of ['/large', '/include']) await assert.rejects(f.app.execute({ url }), { code: 'COW_SOURCE_TOO_LARGE' })
  await assert.rejects(f.app.execute({ url: '/bad' }), error => error.name === 'CowCompileError' && error.line === 2 && error.column > 1)
  assert.equal(f.app.compilerRuntime.status().workersCrashed, 0)
})

test('shutdown bounds active compilation and stops both worker pools', async t => {
  const f = await fixture(t, { compileTimeout: 30_000 })
  await f.write('slow.jsp', '<?js echo("slow"); ?>')
  await f.app.initialize()
  const pool = f.app.compilerRuntime, runtime = f.app.runtime
  await pool.close()
  pool.workerURL = new URL('./fixtures/stalled-compiler-worker.mjs', import.meta.url)
  await pool.start()
  const pending = f.app.execute({ url: '/slow' }).catch(error => error)
  await waitFor(() => pool.status().busyWorkers === 1)
  await runtime.close()
  f.app.options.shutdownTimeout = 100
  const started = performance.now()
  await assert.rejects(f.app.close(), { code: 'COW_RUNTIME_CLOSE_FAILED' })
  assert.ok(performance.now() - started < 1500)
  assert.equal(pool.status().workers, 0)
  assert.equal(runtime.status().workers, 0)
  assert.ok(await pending instanceof Error)
})

test('simultaneous compilation and execution shutdown timeouts preserve both pool failures', async t => {
  const f = await fixture(t, { timeout: 30_000, compileTimeout: 30_000 })
  await f.write('running.jsp', '<?js while(true) {} ?>')
  await f.write('slow.jsp', '<?js echo("slow"); ?>')
  await f.app.initialize()
  const pool = f.app.compilerRuntime, runtime = f.app.runtime
  await pool.close()
  pool.workerURL = new URL('./fixtures/stalled-compiler-worker.mjs', import.meta.url)
  await pool.start()
  const running = f.app.execute({ url: '/running' }).catch(error => error)
  await waitFor(() => runtime.status().busyWorkers === 1)
  const compiling = f.app.execute({ url: '/slow' }).catch(error => error)
  await waitFor(() => pool.status().busyWorkers === 1)
  f.app.options.shutdownTimeout = 100
  const started = performance.now()
  const results = await Promise.allSettled([f.app.close(), f.app.close()])
  assert.ok(performance.now() - started < 1500)
  assert.deepEqual(results.map(result => result.status), ['rejected', 'rejected'])
  const error = results[0].reason
  assert.equal(results[1].reason, error)
  assert.ok(error instanceof AggregateError)
  assert.equal(error.code, 'COW_CLOSE_FAILED')
  assert.equal(error.errors.length, 2)
  for (const failure of error.errors) {
    assert.ok(failure instanceof AggregateError)
    assert.equal(failure.code, 'COW_RUNTIME_CLOSE_FAILED')
    assert.equal(failure.errors.length, 1)
    assert.equal(failure.errors[0].code, 'COW_WORKER_SHUTDOWN_TIMEOUT')
  }
  assert.equal(pool.status().workers, 0)
  assert.equal(runtime.status().workers, 0)
  assert.equal(f.app.status().state, 'stopped')
  assert.ok(await running instanceof Error)
  assert.ok(await compiling instanceof Error)
})

test('evicted compiled templates retained by requests have a separate byte budget', async t => {
  const f = await fixture(t, { cacheEntries: 0 })
  await f.write('slow.jsp', '<?js await new Promise(r=>setTimeout(r,200)); echo("ok"); ?>')
  await f.app.initialize()
  const template = await f.app.dispatcher.compiler.compile(join(f.root, 'slow.jsp'))
  f.app.dispatcher.compiledBufferLimit = template.estimatedBytes
  const first = f.app.execute({ url: '/slow' })
  await waitFor(() => f.app.runtime.status().busyWorkers === 1)
  await assert.rejects(f.app.execute({ url: '/slow' }), { code: 'COW_COMPILED_BUFFER_FULL' })
  assert.equal(f.app.runtime.status().queuedRequests, 0)
  assert.equal(f.app.dispatcher.compiler.cache.size, 0)
  assert.equal(f.app.dispatcher.compiledBytes, template.estimatedBytes)
  await first
  assert.equal(f.app.dispatcher.compiledBytes, 0)
  await f.app.execute({ url: '/slow' })
})
