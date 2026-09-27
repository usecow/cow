import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

const testRoot = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(testRoot)
const fixtures = join(testRoot, 'fixtures', 'site')
const adapterFixtures = join(testRoot, 'fixtures', 'adapter')
let temporaryProject
let temporaryRoot
let app
let baseUrl

async function waitFor(predicate, timeout = 2_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for test condition')
}

before(async () => {
  temporaryProject = await mkdtemp(join(tmpdir(), 'cow-test-'))
  temporaryRoot = join(temporaryProject, 'src')
  await cp(fixtures, temporaryRoot, { recursive: true })

  const installedCow = join(temporaryProject, 'node_modules', '@cowlang/cow')
  await mkdir(join(installedCow, 'lib'), { recursive: true })
  await cp(join(projectRoot, 'package.json'), join(installedCow, 'package.json'))
  await cp(join(projectRoot, 'lib', 'resource.mjs'), join(installedCow, 'lib', 'resource.mjs'))
  await cp(join(projectRoot, 'lib', 'sqlite.mjs'), join(installedCow, 'lib', 'sqlite.mjs'))
  await cp(adapterFixtures, join(temporaryProject, 'node_modules', '@cowlang', 'test-resource'), {
    recursive: true
  })
  app = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    // Long enough for a cold adapter page on a loaded CI machine; the stuck
    // script test only needs some finite limit.
    timeout: 3_000,
    logger: { error() {} }
  })
  baseUrl = (await app.start()).url
})

after(async () => {
  await app?.close()
  if (temporaryProject) await rm(temporaryProject, { recursive: true, force: true })
})

test('renders JSP pages with local imports and query parameters', async () => {
  const response = await fetch(`${baseUrl}/?name=Cow`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^text\/html/)
  assert.match(await response.text(), /<h1>Hello, Cow!<\/h1>/)
})

test('runtime failures point to original JSP, TSP and included template lines', async () => {
  // Use distinct routes because an extensionless route cannot select both types.
  await writeFile(join(temporaryRoot, 'location-types.tsp'), await readFile(join(temporaryRoot, 'locations.tsp')))
  for (const [route, location] of [['locations', 'locations.jsp:6:9'], ['location-types', 'location-types.tsp:6:9'], ['location-include', '_location-child.tsp:4:7']]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`${baseUrl}/${route}`)
      assert.equal(response.status, 500)
      const body = await response.text()
      assert.ok(body.includes(location), body)
      assert.doesNotMatch(body, /\?cow=[^\s<]*:\d+:\d+/)
    }
  }
})

test('renders extensionless TSP routes and strips types', async () => {
  const response = await fetch(`${baseUrl}/types`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.deepEqual(await response.json(), { answer: 42 })
})

test('provides request bodies and response status APIs', async () => {
  const response = await fetch(`${baseUrl}/api?key=value`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sent: true })
  })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    method: 'POST',
    query: 'value',
    body: { sent: true }
  })
})

test('supports explicit response commit and finish states', async () => {
  const response = await fetch(`${baseUrl}/lifecycle`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-before-commit'), 'yes')
  assert.equal(
    await response.text(),
    'before:buffering:false;after:committed:true;error:COW_HEADERS_COMMITTED'
  )
})

test('keeps header-only res.json() compatibility', async () => {
  const response = await fetch(`${baseUrl}/json-header`)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.deepEqual(await response.json(), { compatible: true })
})

test('supports binary template responses', async () => {
  const response = await fetch(`${baseUrl}/binary`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/octet-stream')
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2, 255])
})

test('links Node built-ins and dynamic local imports', async () => {
  const builtin = await fetch(`${baseUrl}/node`)
  assert.equal(await builtin.text(), 'two.txt')

  const dynamic = await fetch(`${baseUrl}/dynamic`)
  assert.equal(await dynamic.text(), 'dynamic import works')
})

test('exposes one request ID to both HTTP and the template', async () => {
  const response = await fetch(`${baseUrl}/request-id`, {
    headers: { 'x-request-id': 'test-request-id' }
  })
  assert.equal(response.headers.get('x-request-id'), 'test-request-id')
  assert.deepEqual(await response.json(), { id: 'test-request-id' })
})

test('serves static files and directory index pages', async () => {
  const staticResponse = await fetch(`${baseUrl}/static.txt`)
  assert.equal(staticResponse.status, 200)
  assert.equal(await staticResponse.text(), 'static file\n')

  const nested = await fetch(`${baseUrl}/nested/`)
  assert.equal(nested.status, 200)
  assert.equal(await nested.text(), 'Nested route\n')
})

test('static files carry validators and answer unchanged re-checks with 304', async () => {
  const file = join(temporaryRoot, 'cache.css')
  await writeFile(file, 'a { color: green }\n')
  const first = await fetch(`${baseUrl}/cache.css`)
  assert.equal(first.status, 200)
  assert.equal(first.headers.get('cache-control'), 'no-cache')
  const etag = first.headers.get('etag'), lastModified = first.headers.get('last-modified')
  assert.match(etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/)
  assert.ok(Number.isFinite(Date.parse(lastModified)))
  await first.text()

  for (const headers of [{ 'if-none-match': etag }, { 'if-none-match': `"other", ${etag.slice(2)}` }, { 'if-modified-since': lastModified }]) {
    const again = await fetch(`${baseUrl}/cache.css`, { headers })
    assert.equal(again.status, 304, JSON.stringify(headers))
    assert.equal(again.headers.get('etag'), etag)
    assert.equal(await again.text(), '')
  }
  const head = await fetch(`${baseUrl}/cache.css`, { method: 'HEAD', headers: { 'if-none-match': etag } })
  assert.equal(head.status, 304)
  // If-None-Match wins over If-Modified-Since, as HTTP requires.
  const mismatch = await fetch(`${baseUrl}/cache.css`, { headers: { 'if-none-match': '"stale"', 'if-modified-since': lastModified } })
  assert.equal(mismatch.status, 200)
  assert.equal(await mismatch.text(), 'a { color: green }\n')

  await writeFile(file, 'a { color: darkgreen }\n')
  const edited = await fetch(`${baseUrl}/cache.css`, { headers: { 'if-none-match': etag } })
  assert.equal(edited.status, 200)
  assert.notEqual(edited.headers.get('etag'), etag)
  assert.equal(await edited.text(), 'a { color: darkgreen }\n')
})

test('handles HEAD without sending a response body', async () => {
  const response = await fetch(`${baseUrl}/?name=Cow`, { method: 'HEAD' })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), '')
})

test('hides template extensions and underscore-prefixed resources', async () => {
  assert.equal((await fetch(`${baseUrl}/index.jsp`)).status, 404)
  assert.equal((await fetch(`${baseUrl}/_secret.txt`)).status, 404)
  assert.equal((await fetch(`${baseUrl}/missing`)).status, 404)
})

test('rejects traversal and language mismatches', async () => {
  assert.notEqual((await fetch(`${baseUrl}/%2e%2e%2fpackage.json`)).status, 200)

  const mismatch = await fetch(`${baseUrl}/bad`)
  assert.equal(mismatch.status, 500)
  assert.match(await mismatch.text(), /cannot be used in a JS template/)
})

test('reflects edits to imported modules on the next request', async () => {
  const modulePath = join(temporaryRoot, '_message.mjs')
  const original = await readFile(modulePath, 'utf8')
  await writeFile(modulePath, original.replace('Hello', 'Updated'))

  const response = await fetch(`${baseUrl}/`)
  assert.match(await response.text(), /<h1>Updated, world!<\/h1>/)
})

test('gives imported application modules fresh request state', async () => {
  assert.equal(await (await fetch(`${baseUrl}/state`)).text(), '1')
  assert.equal(await (await fetch(`${baseUrl}/state`)).text(), '1')
})

test('reuses adapter-owned resources while returning a fresh request facade', async () => {
  const marker = join(temporaryProject, 'resource-reuse.txt')
  const requestUrl = `${baseUrl}/resource?marker=${encodeURIComponent(marker)}&key=reuse`

  const firstResponse = await fetch(requestUrl)
  const first = await firstResponse.json()
  const secondResponse = await fetch(requestUrl)
  const second = await secondResponse.json()

  assert.equal(first.use, 1)
  assert.equal(second.use, 2)
  assert.equal(first.requestId, firstResponse.headers.get('x-request-id'))
  assert.equal(second.requestId, secondResponse.headers.get('x-request-id'))
  assert.notEqual(first.requestId, second.requestId)
  assert.deepEqual((await readFile(marker, 'utf8')).trim().split(/\r?\n/), [
    'open',
    'acquire:1',
    'release:ok:1',
    'acquire:2',
    'release:ok:2'
  ])
})

test('memoizes one resource acquisition within a request', async () => {
  const marker = join(temporaryProject, 'resource-memoized.txt')
  const response = await fetch(
    `${baseUrl}/resource-twice?marker=${encodeURIComponent(marker)}&key=memoized`
  )

  assert.deepEqual(await response.json(), { same: true, use: 1 })
  assert.deepEqual((await readFile(marker, 'utf8')).trim().split(/\r?\n/), [
    'open',
    'acquire:1',
    'release:ok:1'
  ])
})

test('reports active resource leases while a request is running', async () => {
  const marker = join(temporaryProject, 'resource-active.txt')
  const pending = fetch(
    `${baseUrl}/resource-delay?marker=${encodeURIComponent(marker)}&key=active`
  )

  await waitFor(() => app.runtime.status().resources.workers[0].activeLeases === 1)
  assert.equal(app.runtime.status().resources.workers[0].adapters['test-resource'].activeLeases, 1)
  assert.equal(app.runtime.status().resources.adapters['test-resource'].activeLeases, 1)
  assert.equal((await pending).status, 200)
  assert.equal(app.runtime.status().resources.workers[0].activeLeases, 0)
})

test('releases persistent resources when a template fails', async () => {
  const marker = join(temporaryProject, 'resource-error.txt')
  const response = await fetch(
    `${baseUrl}/resource-error?marker=${encodeURIComponent(marker)}&key=error`
  )

  assert.equal(response.status, 500)
  assert.match(await response.text(), /Failure after resource acquisition/)
  assert.match(await readFile(marker, 'utf8'), /release:error:1/)
})

test('releases persistent leases before running request cleanup hooks', async () => {
  const marker = join(temporaryProject, 'resource-cleanup-order.txt')
  const response = await fetch(
    `${baseUrl}/resource-order?marker=${encodeURIComponent(marker)}`
  )

  assert.equal(await response.text(), 'done')
  assert.deepEqual((await readFile(marker, 'utf8')).trim().split(/\r?\n/), [
    'open',
    'acquire:1',
    'release:ok:1',
    'cleanup'
  ])
})

test('reports resource open and release failures without exposing resource keys', async () => {
  const openMarker = join(temporaryProject, 'resource-open-error.txt')
  const openResponse = await fetch(
    `${baseUrl}/resource?marker=${encodeURIComponent(openMarker)}&key=open-error&failOpen=true`
  )
  assert.equal(openResponse.status, 503)
  assert.match(await openResponse.text(), /COW_RESOURCE_OPEN_FAILED/)
  const recoveredResponse = await fetch(
    `${baseUrl}/resource?marker=${encodeURIComponent(openMarker)}&key=open-error`
  )
  assert.equal(recoveredResponse.status, 200)
  assert.equal((await recoveredResponse.json()).use, 1)

  const acquireMarker = join(temporaryProject, 'resource-acquire-error.txt')
  const acquireResponse = await fetch(
    `${baseUrl}/resource?marker=${encodeURIComponent(acquireMarker)}&key=acquire-error&failAcquire=true`
  )
  assert.equal(acquireResponse.status, 503)
  assert.match(await acquireResponse.text(), /COW_RESOURCE_ACQUIRE_FAILED/)
  const recoveredAcquire = await fetch(
    `${baseUrl}/resource?marker=${encodeURIComponent(acquireMarker)}&key=acquire-error`
  )
  assert.equal(recoveredAcquire.status, 200)

  const releaseMarker = join(temporaryProject, 'resource-release-error.txt')
  const releaseResponse = await fetch(
    `${baseUrl}/resource?marker=${encodeURIComponent(releaseMarker)}&key=release-error&failRelease=true`
  )
  assert.equal(releaseResponse.status, 500)
  assert.match(await releaseResponse.text(), /COW_RESOURCE_RELEASE_FAILED/)
  assert.match(await readFile(releaseMarker, 'utf8'), /release:ok:1/)

  const status = app.runtime.status().resources
  assert.ok(status.metrics.opens >= 4)
  assert.equal(status.metrics.openFailures, 1)
  assert.equal(status.metrics.acquireFailures, 1)
  assert.equal(status.metrics.releaseFailures, 1)
  assert.equal(status.adapters['test-resource'].state, 'degraded')
  assert.equal(status.adapters['test-resource'].openFailures, 1)
  assert.equal(status.adapters['test-resource'].acquireFailures, 1)
  assert.equal(status.adapters['test-resource'].releaseFailures, 1)
  assert.equal(JSON.stringify(status).includes(openMarker), false)
  assert.equal(JSON.stringify(status).includes(releaseMarker), false)
})

test('rejects resource options that could retain a request VM', async () => {
  const marker = join(temporaryProject, 'resource-invalid-options.txt')
  const response = await fetch(
    `${baseUrl}/resource-invalid?marker=${encodeURIComponent(marker)}`
  )

  assert.equal(response.status, 500)
  assert.match(await response.text(), /COW_RESOURCE_OPTIONS_INVALID/)
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
})

test('cleans up timers left behind by completed requests', async () => {
  const marker = join(temporaryRoot, 'timer-leak.txt')
  const response = await fetch(`${baseUrl}/cleanup?marker=${encodeURIComponent(marker)}`)
  assert.equal(await response.text(), 'scheduled')
  await new Promise((resolve) => setTimeout(resolve, 75))
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
})

test('runs explicit request cleanup hooks before releasing a worker', async () => {
  const marker = join(temporaryRoot, 'cleanup-hook.txt')
  const response = await fetch(`${baseUrl}/cleanup-hook?marker=${encodeURIComponent(marker)}`)
  assert.equal(await response.text(), 'finishing')
  assert.equal(await readFile(marker, 'utf8'), 'cleaned')
})

test('fails a request when its explicit cleanup cannot complete', async () => {
  const response = await fetch(`${baseUrl}/cleanup-error`)
  assert.equal(response.status, 500)
  assert.match(await response.text(), /COW_CLEANUP_FAILED/)
})

test('supports transport-independent template execution', async () => {
  const result = await app.execute({
    id: 'direct-request',
    url: '/types',
    method: 'GET',
    headers: {},
    body: Buffer.alloc(0)
  })
  assert.equal(result.kind, 'response')
  assert.equal(result.response.status, 200)
  assert.equal(result.response.lifecycle.phase, 'finished')
  assert.deepEqual(JSON.parse(Buffer.from(result.response.body).toString()), { answer: 42 })
})

test('supports persistent adapters without the HTTP transport', async () => {
  const marker = join(temporaryProject, 'resource-direct.txt')
  const result = await app.execute({
    id: 'direct-resource-request',
    url: `/resource?marker=${encodeURIComponent(marker)}&key=direct`,
    method: 'GET'
  })

  assert.equal(result.response.status, 200)
  assert.deepEqual(JSON.parse(Buffer.from(result.response.body).toString()), {
    requestId: 'direct-resource-request',
    use: 1
  })
  assert.match(await readFile(marker, 'utf8'), /release:ok:1/)
})

test('persists SQLite data across requests and rolls back unfinished work', async () => {
  const filename = join(temporaryProject, 'integration.sqlite')
  const database = encodeURIComponent(filename)

  const inserted = await fetch(`${baseUrl}/sqlite?database=${database}&action=insert&value=first`)
  assert.equal(inserted.status, 200)
  assert.deepEqual(await inserted.json(), [{ value: 'first' }])

  const named = await fetch(`${baseUrl}/sqlite?database=${database}&action=named&value=second`)
  assert.deepEqual(await named.json(), [{ value: 'first' }, { value: 'second' }])

  const transaction = await fetch(
    `${baseUrl}/sqlite?database=${database}&action=transaction&value=third`
  )
  assert.deepEqual(await transaction.json(), [
    { value: 'first' },
    { value: 'second' },
    { value: 'third' }
  ])

  const rolledBack = await fetch(`${baseUrl}/sqlite?database=${database}&action=rollback`)
  assert.deepEqual(await rolledBack.json(), [
    { value: 'first' },
    { value: 'second' },
    { value: 'third' }
  ])

  const leaked = await fetch(`${baseUrl}/sqlite?database=${database}&action=leak`)
  assert.equal(leaked.status, 500)
  assert.match(await leaked.text(), /Finish the SQLite transaction/)

  const nextRequest = await fetch(`${baseUrl}/sqlite?database=${database}`)
  assert.deepEqual(await nextRequest.json(), [
    { value: 'first' },
    { value: 'second' },
    { value: 'third' }
  ])
  assert.equal(app.runtime.status().resources.adapters.sqlite.instances, 1)
})

test('accepts file URLs from request-local database modules', async () => {
  const inserted = await fetch(`${baseUrl}/sqlite-url?value=from-url`)
  assert.equal(inserted.status, 200)
  assert.deepEqual(await inserted.json(), [{ value: 'from-url' }])

  const loaded = await fetch(`${baseUrl}/sqlite-url`)
  assert.deepEqual(await loaded.json(), [{ value: 'from-url' }])
})

test('returns SQLite failures as request errors without poisoning the next request', async () => {
  const filename = join(temporaryProject, 'integration-error.sqlite')
  const database = encodeURIComponent(filename)

  const failed = await fetch(`${baseUrl}/sqlite?database=${database}&action=error`)
  assert.equal(failed.status, 500)
  assert.match(await failed.text(), /a_table_that_does_not_exist/)

  const healthy = await fetch(`${baseUrl}/sqlite?database=${database}`)
  assert.equal(healthy.status, 200)
  assert.deepEqual(await healthy.json(), [])
})

test('can execute templates without opening an HTTP listener', async () => {
  const standalone = new CowApp({ rootDir: temporaryRoot, workers: 1 })
  try {
    await standalone.initialize()
    assert.equal(standalone.address(), null)
    assert.equal(standalone.status().state, 'initialized')
    const result = await standalone.execute({ url: '/state' })
    assert.equal(Buffer.from(result.response.body).toString(), '1')
  } finally {
    await standalone.close()
  }
})

test('reports health and operational status', async () => {
  const health = await fetch(`${baseUrl}/_cow/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).status, 'ok')

  const status = await (await fetch(`${baseUrl}/_cow/status`)).json()
  assert.equal(status.state, 'listening')
  assert.equal(status.application.runtime.state, 'running')
  assert.equal(status.application.runtime.readyWorkers, 1)
  assert.ok(status.application.runtime.requestsCompleted > 0)
})

test('hides exception details in production while retaining structured logs', async () => {
  const logged = []
  const production = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    mode: 'production',
    logger: { error(value) { logged.push(value) } }
  })

  try {
    const url = (await production.start()).url
    const response = await fetch(`${url}/error`)
    const body = await response.text()
    assert.equal(response.status, 500)
    assert.doesNotMatch(body, /intentional test error/)
    assert.match(body, /Internal Server Error/)
    assert.equal(logged.length, 1)
    assert.match(logged[0].message, /intentional test error/)
    assert.equal(logged[0].requestId, response.headers.get('x-request-id'))
  } finally {
    await production.close()
  }
})

test('recycles workers after their configured request limit', async () => {
  const recycling = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    maxRequestsPerWorker: 1,
    logger: { error() {} }
  })

  try {
    await recycling.start()
    const result = await recycling.execute({ url: '/types' })
    assert.equal(result.response.status, 200)
    // A respawned worker loads TypeScript before reporting ready; under a
    // fully loaded suite run that takes seconds, not the default 2s budget.
    await waitFor(() => recycling.runtime.status().readyWorkers === 1, 30_000)
    const status = recycling.runtime.status()
    assert.equal(status.workersRecycled, 1)
    assert.ok(status.workersSpawned >= 2)
  } finally {
    await recycling.close()
  }
})

test('closes persistent resources before recycling their worker', async () => {
  const marker = join(temporaryProject, 'resource-recycle.txt')
  const recycling = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    maxRequestsPerWorker: 1,
    logger: { error() {} }
  })

  try {
    const url = (await recycling.start()).url
    const response = await fetch(`${url}/resource?marker=${encodeURIComponent(marker)}&key=recycle`)
    assert.equal(response.status, 200)
    await waitFor(async () => {
      const contents = await readFile(marker, 'utf8').catch(() => '')
      return contents.includes('close') && recycling.runtime.status().readyWorkers === 1
    }, 30_000)
    assert.match(await readFile(marker, 'utf8'), /release:ok:1\r?\nclose/)
    assert.equal(recycling.runtime.status().resources.metrics.closes, 1)
  } finally {
    await recycling.close()
  }
})

test('keeps SQLite files persistent when their worker is recycled', async () => {
  const filename = join(temporaryProject, 'sqlite-recycle.sqlite')
  const database = encodeURIComponent(filename)
  const recycling = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    maxRequestsPerWorker: 1,
    logger: { error() {} }
  })

  try {
    const url = (await recycling.start()).url
    const inserted = await fetch(
      `${url}/sqlite?database=${database}&action=insert&value=survives-recycle`
    )
    assert.equal(inserted.status, 200)
    await waitFor(() => {
      const status = recycling.runtime.status()
      return status.workersRecycled >= 1 && status.readyWorkers === 1
    }, 30_000)

    const loaded = await fetch(`${url}/sqlite?database=${database}`)
    assert.deepEqual(await loaded.json(), [{ value: 'survives-recycle' }])
    await waitFor(() => recycling.runtime.status().resources.metrics.closes >= 2, 30_000)
    assert.ok(recycling.runtime.status().resources.adapters.sqlite.opens >= 2)
  } finally {
    await recycling.close()
  }
})

test('owns one persistent resource instance per worker', async () => {
  const marker = join(temporaryProject, 'resource-per-worker.txt')
  const parallel = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 2,
    logger: { error() {} }
  })
  try {
    const url = (await parallel.start()).url
    const requestUrl = `${url}/resource-delay?marker=${encodeURIComponent(marker)}&key=per-worker`
    const responses = await Promise.all([fetch(requestUrl), fetch(requestUrl)])
    const values = await Promise.all(responses.map((response) => response.json()))
    assert.deepEqual(values.map((value) => value.use), [1, 1])

    const resources = parallel.runtime.status().resources
    assert.equal(resources.metrics.opens, 2)
    assert.equal(resources.adapters['test-resource'].instances, 2)
    assert.equal(resources.adapters['test-resource'].workers, 2)
    assert.equal(resources.workers.reduce((sum, worker) => sum + worker.instances, 0), 2)
  } finally {
    await parallel.close()
  }

  const events = (await readFile(marker, 'utf8')).trim().split(/\r?\n/)
  assert.equal(events.filter((event) => event === 'open').length, 2)
  assert.equal(events.filter((event) => event === 'close').length, 2)
})

test('owns one SQLite connection per worker for the same database file', async () => {
  const filename = join(temporaryProject, 'sqlite-per-worker.sqlite')
  const database = encodeURIComponent(filename)
  const parallel = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 2,
    logger: { error() {} }
  })
  let runtime

  try {
    const url = (await parallel.start()).url
    runtime = parallel.runtime
    assert.equal((await fetch(`${url}/sqlite?database=${database}`)).status, 200)

    const requestUrl = `${url}/sqlite?database=${database}&action=hold`
    const pending = [fetch(requestUrl), fetch(requestUrl)]
    await waitFor(() => {
      const sqliteStatus = parallel.runtime.status().resources.adapters.sqlite
      return sqliteStatus?.activeLeases === 2
    })

    const status = parallel.runtime.status().resources.adapters.sqlite
    assert.equal(status.instances, 2)
    assert.equal(status.workers, 2)
    assert.deepEqual(
      await Promise.all(pending.map(async (request) => (await request).json())),
      [[], []]
    )
  } finally {
    await parallel.close()
  }

  const status = runtime.status().resources.adapters.sqlite
  assert.equal(status.closes, 2)
})

test('closes persistent resources during graceful application shutdown', async () => {
  const marker = join(temporaryProject, 'resource-shutdown.txt')
  const closing = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    logger: { error() {} }
  })

  const url = (await closing.start()).url
  const pending = fetch(
    `${url}/resource-delay?marker=${encodeURIComponent(marker)}&key=shutdown`
  )
  await waitFor(() => closing.runtime.status().resources.workers[0].activeLeases === 1)
  const shutdown = closing.close()
  assert.equal((await pending).status, 200)
  await shutdown
  assert.match(await readFile(marker, 'utf8'), /release:ok:1\r?\nclose/)
  assert.equal(closing.status().state, 'stopped')
})

test('reports persistent resource close failures while still stopping', async () => {
  const marker = join(temporaryProject, 'resource-close-error.txt')
  const closing = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    logger: { error() {} }
  })

  const url = (await closing.start()).url
  assert.equal(
    (await fetch(
      `${url}/resource?marker=${encodeURIComponent(marker)}&key=close-error&failClose=true`
    )).status,
    200
  )
  await assert.rejects(closing.close(), { code: 'COW_RUNTIME_CLOSE_FAILED' })
  assert.match(await readFile(marker, 'utf8'), /close/)
  assert.equal(closing.status().state, 'stopped')
})

test('bounds persistent resource shutdown time', async () => {
  const marker = join(temporaryProject, 'resource-close-timeout.txt')
  const closing = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    shutdownTimeout: 100,
    logger: { error() {} }
  })

  const url = (await closing.start()).url
  assert.equal(
    (await fetch(
      `${url}/resource?marker=${encodeURIComponent(marker)}&key=close-timeout&hangClose=true`
    )).status,
    200
  )
  await assert.rejects(closing.close(), { code: 'COW_RUNTIME_CLOSE_FAILED' })
  assert.match(await readFile(marker, 'utf8'), /close/)
  assert.equal(closing.status().state, 'stopped')
})

test('gracefully drains an active HTTP request before closing workers', async () => {
  const draining = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    logger: { error() {} }
  })

  const url = (await draining.start()).url
  const pending = fetch(`${url}/delay`)
  await waitFor(() => draining.runtime.status().busyWorkers === 1)
  const closing = draining.close()
  const response = await pending
  assert.equal(await response.text(), 'completed before shutdown')
  await closing
  assert.equal(draining.status().state, 'stopped')
})

test('rejects work beyond the bounded runtime queue', async () => {
  const bounded = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    // The two hanging requests must still hold the worker and the queue when
    // the third arrives, even on a slow CI machine.
    timeout: 1_500,
    maxQueue: 1,
    logger: { error() {} }
  })

  try {
    const url = (await bounded.start()).url
    const first = fetch(`${url}/hang`)
    await waitFor(() => bounded.runtime.status().busyWorkers === 1)
    const second = fetch(`${url}/hang`)
    await waitFor(() => bounded.runtime.status().queuedRequests === 1)
    const rejected = await fetch(`${url}/types`)
    assert.equal(rejected.status, 503)
    assert.match(await rejected.text(), /COW_ADMISSION_FULL/)
    assert.equal(bounded.dispatcher.compiler.cache.size, 1, 'Overload must be rejected before compiling /types')
    await Promise.all([first, second])
    assert.equal(bounded.dispatcher.status().admissionRejections, 1)
  } finally {
    await bounded.close()
  }
})

test('counts an unexpected worker exit and restores capacity', async () => {
  const crashing = new CowApp({
    rootDir: temporaryRoot,
    host: '127.0.0.1',
    port: 0,
    workers: 1,
    logger: { error() {} }
  })

  try {
    const url = (await crashing.start()).url
    const response = await fetch(`${url}/crash`)
    assert.equal(response.status, 500)
    await waitFor(() => crashing.runtime.status().readyWorkers === 1)
    const status = crashing.runtime.status()
    assert.equal(status.workersCrashed, 1)
    assert.ok(status.workersSpawned >= 2)
    assert.equal((await fetch(`${url}/types`)).status, 200)
  } finally {
    await crashing.close()
  }
})

test('terminates stuck scripts and replaces their worker', async () => {
  const timeout = await fetch(`${baseUrl}/hang`)
  assert.equal(timeout.status, 504)

  const healthy = await fetch(`${baseUrl}/types`)
  assert.equal(healthy.status, 200)
  assert.deepEqual(await healthy.json(), { answer: 42 })
})
