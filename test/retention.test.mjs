import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { Compiler } from '../lib/compiler.mjs'
import { __createResourceRuntime } from '../lib/resource.mjs'
import { CowApp } from '../lib/app.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-retention-'))
  const app = new CowApp({ rootDir: root, workers: 1, port: 0, logger: { error() {} }, ...options })
  t.after(async () => {
    await app.close().catch(() => {})
    assert.equal(dirname(root), tmpdir())
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  return { root, app, write: (name, content) => writeFile(join(root, name), content) }
}

const run = (runtime, callback) => runtime.runWithRequest({ request: { id: 'retention' }, signal: new AbortController().signal }, callback)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('compiled pages use LRU entry/estimated-byte limits and preserve retained results', async t => {
  const f = await fixture(t)
  const compiler = new Compiler({ maxCacheEntries: 2, maxCacheBytes: 8000 })
  for (const name of ['a', 'b', 'c']) await f.write(`${name}.jsp`, `hello ${name}`)
  const a = await compiler.compile(join(f.root, 'a.jsp'))
  await compiler.compile(join(f.root, 'b.jsp'))
  assert.equal(await compiler.compile(join(f.root, 'a.jsp')), a)
  await compiler.compile(join(f.root, 'c.jsp'))
  assert.equal(compiler.cache.size, 2)
  assert.equal(compiler.cache.has(join(f.root, 'b.jsp')), false)
  assert.match(a.code, /hello a/)
  for (let n = 0; n < 50; n++) {
    await f.write(`${n}.jsp`, `page ${n}`)
    await compiler.compile(join(f.root, `${n}.jsp`))
    assert.ok(compiler.status().estimatedBytes <= 8000)
    assert.ok(compiler.cache.size <= 2)
  }
  assert.ok(compiler.status().evictions > 40)
  compiler.clear()
  assert.equal(compiler.status().estimatedBytes, 0)
})

test('an oversized entry renders without caching and clear prevents in-flight repopulation', async t => {
  const f = await fixture(t)
  await f.write('index.jsp', 'hello')
  const tiny = new Compiler({ maxCacheBytes: 1 })
  assert.match((await tiny.compile(join(f.root, 'index.jsp'))).code, /hello/)
  assert.equal(tiny.cache.size, 0)
  const entered = deferred(), resume = deferred()
  const compiler = new Compiler({ transform: async () => { entered.resolve(); await resume.promise; return { code: 'export default () => {}' } } })
  const pending = compiler.compile(join(f.root, 'index.jsp'))
  await entered.promise
  compiler.clear()
  resume.resolve()
  await pending
  assert.equal(compiler.cache.size, 0)
  assert.equal(compiler.status().pending, 0)
})

test('resource cardinality remains bounded and only idle LRU entries are closed', async () => {
  const runtime = __createResourceRuntime({ maxResources: 2 })
  const closed = []
  const acquire = runtime.defineResource({ name: 'lru', key: o => o.key,
    open: o => ({ key: o.key }), close: resource => closed.push(resource.key) })
  try {
    await run(runtime, async () => {
      const leased = await acquire({ key: 'held' })
      for (let n = 0; n < 50; n++) {
        await run(runtime, () => acquire({ key: String(n) }))
        assert.equal(closed.includes('held'), false)
        assert.equal(leased.key, 'held')
        assert.ok(runtime.status().instances <= 2)
      }
    })
    assert.equal(runtime.status().activeLeases, 0)
    assert.equal(runtime.status().evictions, 49)
  } finally { await runtime.closeAll() }
  assert.equal(closed.length, 51)
})

test('pending acquisition reservations cannot be evicted or overbooked', async () => {
  const runtime = __createResourceRuntime({ maxResources: 1 })
  const entered = deferred(), resume = deferred()
  let closes = 0
  const acquire = runtime.defineResource({ name: 'pending', key: o => o.key,
    async open() { entered.resolve(); await resume.promise; return {} }, close() { closes++ } })
  const pending = run(runtime, () => acquire({ key: 'a' }))
  await entered.promise
  await assert.rejects(run(runtime, () => acquire({ key: 'b' })), { code: 'COW_RESOURCE_LIMIT' })
  assert.equal(closes, 0)
  assert.equal(runtime.status().instances, 1)
  resume.resolve()
  await pending
  await runtime.closeAll()
  assert.equal(closes, 1)
})

test('failed release discards the resource and preserves primary and cleanup errors', async () => {
  const runtime = __createResourceRuntime()
  let opens = 0, closes = 0
  const primary = new Error('primary write failed'), cleanup = new Error('rollback failed')
  const acquire = runtime.defineResource({ name: 'poison', key: () => 'one',
    open: () => ({ id: ++opens }), release(value) { if (value.id === 1) throw cleanup }, close() { closes++ } })
  await assert.rejects(run(runtime, async () => { await acquire(); throw primary }), error => {
    assert.equal(error.cause, primary)
    assert.deepEqual(error.errors, [primary, cleanup])
    return error.code === 'COW_RESOURCE_RELEASE_FAILED'
  })
  assert.equal(closes, 1)
  assert.equal(runtime.status().instances, 0)
  assert.equal(await run(runtime, async () => (await acquire()).id), 2)
  await runtime.closeAll()
  assert.equal(closes, 2)
})

test('failed close quarantines capacity, never retries close/open, and requests replacement', async () => {
  const runtime = __createResourceRuntime({ maxResources: 1 })
  let opens = 0, closes = 0
  const acquire = runtime.defineResource({ name: 'quarantine', key: o => o.key,
    open() { opens++; return {} }, release() { throw new Error('release failure') },
    close() { closes++; throw new Error('close failure') } })
  await assert.rejects(run(runtime, () => acquire({ key: 'a' })), error => {
    assert.equal(error.errors.length, 2)
    return error.code === 'COW_RESOURCE_RELEASE_FAILED'
  })
  await assert.rejects(run(runtime, () => acquire({ key: 'b' })), { code: 'COW_RESOURCE_UNAVAILABLE' })
  assert.equal(runtime.status().instances, 1)
  assert.equal(runtime.status().recycleRequired, true)
  await assert.rejects(runtime.closeAll(), { code: 'COW_RESOURCE_CLOSE_FAILED' })
  assert.deepEqual([opens, closes], [1, 1])
})

test('acquisition failure poisons a resource but waits for other active leases before closing', async () => {
  const runtime = __createResourceRuntime()
  let closes = 0
  const acquire = runtime.defineResource({ name: 'acquire-failure', key: () => 'one', open: () => ({}),
    acquire(value, { options }) { if (options.fail) throw new Error('reset failed'); return value }, close() { closes++ } })
  await run(runtime, async () => {
    await acquire()
    await assert.rejects(run(runtime, () => acquire({ fail: true })), { code: 'COW_RESOURCE_ACQUIRE_FAILED' })
    assert.equal(closes, 0)
    await assert.rejects(run(runtime, () => acquire()), { code: 'COW_RESOURCE_POISONED' })
  })
  assert.equal(closes, 1)
  assert.equal(runtime.status().instances, 0)
})

test('adapter registrations are bounded independently of resource instances', () => {
  const runtime = __createResourceRuntime({ maxAdapters: 1 })
  runtime.defineResource({ name: 'one', key: () => 'one', open() {}, close() {} })
  assert.throws(() => runtime.defineResource({ name: 'two', key: () => 'two', open() {}, close() {} }), { code: 'COW_ADAPTER_LIMIT' })
  assert.equal(runtime.status().registeredAdapters, 1)
  assert.equal(runtime.status().recycleRequired, true)
})

async function driver(f) {
  const directory = join(f.root, 'node_modules', 'retention-driver')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'retention-driver', type: 'module', exports: './index.mjs', cow: { native: ['./index.mjs'] } }))
  await writeFile(join(directory, 'index.mjs'), `
    import { defineResource } from ${JSON.stringify(new URL('../lib/resource.mjs', import.meta.url).href)};
    import { threadId } from 'node:worker_threads';
    let opens = 0;
    export const acquire = defineResource({name:'retention-driver', key:o=>o.key || 'one',
      open:o=>({id:++opens,worker:threadId,badClose:o.badClose}),
      release(value,{options}) { if(options.fail) throw new Error('release failure'); },
      close(value) { if(value.badClose) throw new Error('close failure'); }
    });
  `)
}

test('error transport preserves rendering, resource-release and cleanup-hook failures', async t => {
  const f = await fixture(t)
  await driver(f)
  await f.write('bad.jsp', `<?js
    import { acquire } from 'retention-driver'; await acquire({fail:true});
    cow.onCleanup(() => { throw new Error('hook failure'); });
    throw new Error('primary failure');
  ?>`)
  await f.write('index.jsp', `<?js import { acquire } from 'retention-driver'; res.json(await acquire()); ?>`)
  await f.app.initialize()
  await assert.rejects(f.app.execute({ url: '/bad' }), error => {
    assert.equal(error.code, 'COW_CLEANUP_FAILED')
    assert.equal(error.cause.code, 'COW_RESOURCE_RELEASE_FAILED')
    assert.equal(error.cause.cause.message, 'primary failure')
    assert.equal(error.cause.errors[1].message, 'release failure')
    assert.equal(error.errors[1].message, 'hook failure')
    return true
  })
  const next = await f.app.execute({ url: '/' })
  assert.equal(JSON.parse(Buffer.from(next.response.body)).id, 2)
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('a failed native close triggers worker replacement before another request', async t => {
  const f = await fixture(t)
  await driver(f)
  await f.write('bad.jsp', `<?js import { acquire } from 'retention-driver'; await acquire({fail:true,badClose:true}); ?>`)
  await f.write('index.jsp', `<?js import { acquire } from 'retention-driver'; res.json(await acquire()); ?>`)
  await f.app.initialize()
  await assert.rejects(f.app.execute({ url: '/bad' }), { code: 'COW_RESOURCE_RELEASE_FAILED' })
  const next = await f.app.execute({ url: '/' })
  assert.equal(JSON.parse(Buffer.from(next.response.body)).id, 1)
  assert.equal(f.app.runtime.status().workersSpawned, 2)
  assert.equal(f.app.runtime.status().resources.metrics.closeFailures, 1)
})

test('include-cache limits and package-root limits reach reused execution workers', async t => {
  const f = await fixture(t, { cacheEntries: 2, namespaceLimit: 3, maxRequestsPerWorker: 0 })
  for (let n = 0; n < 5; n++) await f.write(`_${n}.jsp`, `${n}`)
  await f.write('index.jsp', `<?js for(let n=0;n<5;n++) await include('./_'+n+'.jsp'); ?>`)
  await f.write('packages.jsp', `<?js await Promise.all([import('node:os'),import('node:path'),import('node:util')]); echo('ok'); ?>`)
  await f.write('over.jsp', `<?js await Promise.all([import('node:os'),import('node:path'),import('node:util'),import('node:crypto')]); ?>`)
  await f.app.initialize()
  const response = await f.app.execute({ url: '/' })
  assert.equal(Buffer.from(response.response.body).toString(), '01234')
  assert.equal(f.app.runtime.status().workerCaches[0].includeCache.entries, 2)
  assert.equal(f.app.runtime.status().workerCaches[0].includeCache.evictions, 3)
  await f.app.execute({ url: '/packages' })
  await assert.rejects(f.app.execute({ url: '/over' }), { code: 'COW_MODULE_LIMIT' })
  assert.equal(f.app.runtime.status().workersSpawned, 2)
  await f.app.execute({ url: '/' })
  assert.equal(f.app.runtime.status().workersSpawned, 3)
})

test('resource limits from CowApp are enforced without closing an active facade', async t => {
  const f = await fixture(t, { resourceLimit: 1 })
  await driver(f)
  await f.write('index.jsp', `<?js
    import { acquire } from 'retention-driver';
    const first = await acquire({key:'a'});
    let code; try { await acquire({key:'b'}); } catch(error) { code=error.code; }
    res.json({code,id:first.id});
  ?>`)
  await f.app.initialize()
  const response = await f.app.execute({ url: '/' })
  assert.deepEqual(JSON.parse(Buffer.from(response.response.body)), { code: 'COW_RESOURCE_LIMIT', id: 1 })
})

test('failed idle eviction never opens a replacement alongside an unclosed handle', async () => {
  const runtime = __createResourceRuntime({ maxResources: 1 })
  let opens = 0, closes = 0
  const acquire = runtime.defineResource({ name: 'idle-failure', key: o => o.key,
    open() { opens++; return {} }, close() { closes++; throw new Error('cannot close') } })
  await run(runtime, () => acquire({ key: 'a' }))
  await assert.rejects(run(runtime, () => acquire({ key: 'b' })), { code: 'COW_RESOURCE_CLOSE_FAILED' })
  assert.deepEqual([opens, closes], [1, 1])
  assert.equal(runtime.status().recycleRequired, true)
  await assert.rejects(runtime.closeAll())
  assert.equal(closes, 1)
})

test('a discarded SQLite connection rolls back pending work and preserves committed data on reopen', async t => {
  const f = await fixture(t)
  const runtime = __createResourceRuntime()
  let opens = 0, closes = 0, failRelease = true
  const acquire = runtime.defineResource({ name: 'sqlite-discard', key: () => 'one',
    open() {
      opens++
      const database = new DatabaseSync(join(f.root, 'private.sqlite'))
      database.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO items VALUES (1);')
      return database
    },
    release(database) {
      if (database.isTransaction) database.exec('ROLLBACK')
      if (failRelease) { failRelease = false; throw new Error('connection reset failed') }
    },
    close(database) { closes++; database.close() }
  })
  await assert.rejects(run(runtime, async () => {
    (await acquire()).exec('BEGIN; INSERT INTO items VALUES (2);')
  }), { code: 'COW_RESOURCE_RELEASE_FAILED' })
  const ids = await run(runtime, async () => (await acquire()).prepare('SELECT id FROM items ORDER BY id').all().map(row => row.id))
  assert.deepEqual(ids, [1])
  assert.equal(opens, 2)
  await runtime.closeAll()
  assert.equal(closes, 2)
})
