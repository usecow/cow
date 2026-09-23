import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createServer, get } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

async function fixture(t, options = {}) {
  // Cow opens real paths; Windows temp folders can be 8.3 short names.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cow-hardening-')))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, logger: { error() {} }, ...options })
  t.after(async () => {
    await app.close().catch(() => {})
    assert.equal(dirname(root), await realpath(tmpdir()))
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  return {
    root, app,
    async write(name, content) { await writeFile(join(root, name), content) },
    async start() { return (await app.start()).url },
    async json(path = '/') {
      const response = await fetch(app.address().url + path)
      const text = await response.text()
      assert.equal(response.status, 200, text)
      return JSON.parse(text)
    }
  }
}

async function waitFor(predicate) {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return
    await delay(10)
  }
  assert.fail('Condition did not settle within 2 seconds')
}

test('concurrent imports share one instance, including diamond dependencies and cycles', async (t) => {
  const f = await fixture(t)
  await f.write('_state.mjs', 'let count=0; export const next=()=>++count;')
  await f.write('_left.mjs', 'export { next } from "./_state.mjs";')
  await f.write('_right.mjs', 'export { next } from "./_state.mjs";')
  await f.write('_a.mjs', 'import { b } from "./_b.mjs"; export const a=()=>b();')
  await f.write('_b.mjs', 'export { a } from "./_a.mjs"; export const b=()=>"cycle works";')
  await f.write('index.jsp', `<?js
    const [a,b,left,right,cycle]=await Promise.all([
      import('./_state.mjs'),import('./_state.mjs'),import('./_left.mjs'),import('./_right.mjs'),import('./_a.mjs')
    ]);
    res.json({same:a===b, shared:a.next===left.next && left.next===right.next,
      counts:[a.next(),b.next(),left.next(),right.next()],cycle:cycle.a()});
  ?>`)
  await f.start()
  for (let n = 0; n < 3; n++) {
    assert.deepEqual(await f.json(), { same: true, shared: true, counts: [1, 2, 3, 4], cycle: 'cycle works' })
  }
})

test('concurrent dynamic imports await evaluation and retain failed evaluation identity', async (t) => {
  const f = await fixture(t)
  await f.write('_slow.mjs', 'globalThis.loads=(globalThis.loads||0)+1; await new Promise(r=>setTimeout(r,40)); export const value="ready";')
  await f.write('_failure.mjs', 'globalThis.failures=(globalThis.failures||0)+1; await new Promise(r=>setTimeout(r,20)); throw new Error("expected failure");')
  await f.write('_left.mjs', 'export { value } from "./_slow.mjs";')
  await f.write('_right.mjs', 'export { value } from "./_slow.mjs";')
  await f.write('index.jsp', `<?js
    const [a,b,c,d]=await Promise.all([import('./_slow.mjs'),import('./_slow.mjs'),import('./_left.mjs'),import('./_right.mjs')]);
    const failures=await Promise.allSettled([import('./_failure.mjs'),import('./_failure.mjs')]);
    let repeated; try { await import('./_failure.mjs'); } catch(error) { repeated=error; }
    const missing=await Promise.allSettled([import('./_missing.mjs'),import('./_missing.mjs')]);
    res.json({same:a===b, values:[a.value,b.value,c.value,d.value],loads:globalThis.loads,
      failures:globalThis.failures, rejected:failures.every(x=>x.status==='rejected'),
      sameError:failures[0].reason===failures[1].reason && repeated===failures[0].reason,
      missing:missing.every(x=>x.status==='rejected')});
  ?>`)
  await f.start()
  assert.deepEqual(await f.json(), { same: true, values: ['ready', 'ready', 'ready', 'ready'], loads: 1, failures: 1, rejected: true, sameError: true, missing: true })
})

test('fetch preserves Request cancellation and explicit signal precedence', async (t) => {
  let hits = 0
  const origin = createServer((req, res) => { hits++; res.end('ok') })
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => origin.close(resolve)))
  const url = `http://127.0.0.1:${origin.address().port}`
  const f = await fixture(t)
  await f.write('index.jsp', `<?js
    const target=${JSON.stringify(url)};
    const request=new Request(target,{signal:AbortSignal.abort()});
    const results=[];
    for(const init of [undefined, {signal:undefined}, {signal:new AbortController().signal}, {signal:null}]) {
      try { results.push(await (await fetch(request,init)).text()); } catch(error) { results.push(error.name); }
    }
    res.json(results);
  ?>`)
  await f.start()
  assert.deepEqual(await f.json(), ['AbortError', 'AbortError', 'ok', 'ok'])
  assert.equal(hits, 2)
})

test('query helpers agree and getAll retains duplicates without prototype surprises', async (t) => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js
    const params=req.params(); const all=req.getAll('id'); all.push('local mutation');
    res.json({get:req.get('id'),param:params.id,all:req.getAll('id'),empty:req.get('empty'),
      proto:params['__proto__'],constructor:params.constructor,missing:req.getAll('missing'),frozen:Object.isFrozen(params)});
  ?>`)
  await f.start()
  assert.deepEqual(await f.json('/?id=first&id=last&empty=&__proto__=safe&constructor=value'), {
    get: 'first', param: 'first', all: ['first', 'last'], empty: '', proto: 'safe', constructor: 'value', missing: [], frozen: true
  })
})

test('error responses retain policy headers but discard body metadata and redirects', async (t) => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js
    res.setHeader('allow','GET, HEAD'); res.setHeader('retry-after','30');
    res.setHeader('content-security-policy',"default-src 'none'");
    res.setHeader('set-cookie',['a=one; HttpOnly','b=two; HttpOnly']);
    res.setHeader('content-type','application/json'); res.setHeader('content-encoding','gzip');
    res.setHeader('content-length','9999'); res.setHeader('location','/success');
    res.setHeader('etag','"old-success"'); res.setHeader('cache-control','public, max-age=999');
    const error=new Error('Unsupported method'); error.status=405; throw error;
  ?>`)
  const url = await f.start()
  const response = await fetch(url, { method: 'PUT', redirect: 'manual' })
  const body = await response.text()
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, HEAD')
  assert.equal(response.headers.get('retry-after'), '30')
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'")
  assert.deepEqual(response.headers.getSetCookie(), ['a=one; HttpOnly', 'b=two; HttpOnly'])
  for (const name of ['location', 'content-encoding', 'etag']) assert.equal(response.headers.get(name), null)
  assert.match(response.headers.get('content-type'), /^text\/html/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body))
})

test('invalid error status and a failing logger cannot terminate the HTTP process', async (t) => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js const e=new Error('bad application status'); e.status=Number(req.get('status')); throw e; ?>`)
  await f.write('ok.jsp', 'healthy')
  const appUrl = new URL('../lib/app.mjs', import.meta.url).href
  const script = `import { CowApp } from ${JSON.stringify(appUrl)};
    const app=new CowApp({rootDir:${JSON.stringify(f.root)},port:0,workers:1,logger:{error(){throw new Error('broken logger')}}});
    try { const {url}=await app.start(); const statuses=[];
      for(const status of [0,-1,99,200,302,1000]) { const r=await fetch(url+'/?status='+status); await r.text(); statuses.push(r.status); }
      const r=await fetch(url+'/ok'); console.log(JSON.stringify({statuses,next:await r.text()}));
    } finally {await app.close();}`
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { errors += chunk })
  const timer = setTimeout(() => child.kill(), 15_000)
  t.after(() => { clearTimeout(timer); if (child.exitCode === null) child.kill() })
  const [code] = await once(child, 'close')
  clearTimeout(timer)
  assert.equal(code, 0, errors)
  assert.deepEqual(JSON.parse(output.trim()), { statuses: [500, 500, 500, 500, 500, 500], next: 'healthy' })
})

test('no-cache reaches nested JSP/TSP includes with unchanged timestamps and sizes', async (t) => {
  const f = await fixture(t, { cache: false })
  await f.write('index.jsp', '<?js await include("./_outer.jsp"); ?>')
  await f.write('_outer.jsp', '<?js await include("./_inner.tsp"); ?>')
  await f.write('_inner.tsp', '<?ts const text: string="one"; echo(text); ?>')
  const child = join(f.root, '_inner.tsp'), stamp = new Date('2020-01-01T00:00:00Z')
  await utimes(child, stamp, stamp)
  const before = await stat(child)
  const url = await f.start()
  assert.equal(await (await fetch(url)).text(), 'one')
  await f.write('_inner.tsp', '<?ts const text: string="two"; echo(text); ?>')
  await utimes(child, stamp, stamp)
  assert.equal((await stat(child)).mtimeMs, before.mtimeMs)
  assert.equal((await stat(child)).size, before.size)
  assert.equal(await (await fetch(url)).text(), 'two')
})

test('cancelled static downloads close their stream and settle request accounting', async (t) => {
  const f = await fixture(t)
  await f.write('large.txt', Buffer.alloc(8 * 1024 * 1024, 120))
  const original = fs.createReadStream
  let stream
  fs.createReadStream = (...args) => { stream = original(...args); return stream }
  syncBuiltinESMExports()
  t.after(() => { stream?.destroy(); fs.createReadStream = original; syncBuiltinESMExports() })
  const url = await f.start()
  await new Promise((resolve, reject) => {
    get(url + '/large.txt', res => res.once('data', () => { res.destroy(); resolve() })).on('error', reject)
  })
  await waitFor(() => stream?.closed && f.app.server.activeRequests === 0)
  assert.equal(stream.fd, null)
  assert.equal(stream.destroyed, true)
})

test('a partial body cannot block application shutdown beyond its shared deadline', async (t) => {
  const f = await fixture(t, { shutdownTimeout: 100 })
  await f.write('index.jsp', 'ok')
  await f.start()
  const socket = connect(f.app.address().port, '127.0.0.1')
  socket.on('error', () => {})
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\nx')
  await waitFor(() => f.app.server.activeRequests === 1)
  const safety = setTimeout(() => socket.destroy(), 1500)
  const started = performance.now()
  try {
    await assert.rejects(f.app.close(), error => ['COW_HTTP_DRAIN_TIMEOUT', 'COW_CLOSE_FAILED'].includes(error.code))
    assert.ok(performance.now() - started < 1200, 'HTTP drain used the emergency test cleanup instead of its own deadline')
    assert.equal(f.app.status().state, 'stopped')
  } finally { clearTimeout(safety); socket.destroy() }
})

test('stuck worker execution shares the application shutdown deadline', async (t) => {
  const f = await fixture(t, { timeout: 10_000 })
  await f.write('index.jsp', '<?js while(true) {} ?>')
  await f.app.initialize()
  await f.app.dispatcher.compiler.compile(join(f.root, 'index.jsp'))
  // Isolate one forced pool failure. Idle-worker exit latency must not decide
  // whether the application reports a single failure or an aggregate.
  await f.app.compilerRuntime.close()
  f.app.options.shutdownTimeout = 100
  const runtime = f.app.runtime
  const pending = f.app.execute({ url: '/' }).catch(error => error)
  await waitFor(() => f.app.runtime.status().busyWorkers === 1)
  const started = performance.now()
  await assert.rejects(f.app.close(), { code: 'COW_RUNTIME_CLOSE_FAILED' })
  assert.ok(performance.now() - started < 1500)
  assert.ok((await pending) instanceof Error)
  assert.equal(runtime.status().workers, 0)
  assert.equal(f.app.status().state, 'stopped')
})

test('stalled static readers are disconnected and all close callers see the timeout', async (t) => {
  const f = await fixture(t, { shutdownTimeout: 100 })
  await f.write('large.txt', Buffer.alloc(16 * 1024 * 1024, 120))
  await f.start()
  const server = f.app.server
  const socket = connect(f.app.address().port, '127.0.0.1')
  socket.on('error', () => {})
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  const reading = once(socket, 'data')
  socket.write('GET /large.txt HTTP/1.1\r\nHost: localhost\r\n\r\n')
  await reading
  socket.pause()
  const safety = setTimeout(() => socket.destroy(), 1500)
  const started = performance.now()
  try {
    const closes = await Promise.allSettled([server.close(), server.close()])
    for (const result of closes) {
      assert.equal(result.status, 'rejected')
      assert.equal(result.reason.code, 'COW_HTTP_DRAIN_TIMEOUT')
    }
    assert.ok(performance.now() - started < 1200)
    await waitFor(() => server.activeRequests === 0)
  } finally { clearTimeout(safety); socket.destroy() }
})

test('invalid header values fail a request and the next request remains healthy', async (t) => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js res.setHeader('x-invalid','bad\\nheader'); echo('must not succeed'); ?>`)
  await f.write('ok.jsp', 'healthy')
  const url = await f.start()
  const response = await fetch(url)
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('x-invalid'), null)
  assert.match(await response.text(), /ERR_INVALID_CHAR/)
  assert.equal(await (await fetch(url + '/ok')).text(), 'healthy')
})

test('concurrent built-in imports share one synthetic namespace', async (t) => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js const [a,b]=await Promise.all([import('node:os'),import('node:os')]); res.json({same:a===b}); ?>`)
  await f.start()
  assert.deepEqual(await f.json(), { same: true })
})

test('teardown still cancels an unconsumed fetch response body', async (t) => {
  let closed = false, opened
  const entered = new Promise(resolve => { opened = resolve })
  const origin = createServer((req, res) => {
    res.writeHead(200)
    res.write('partial')
    res.on('close', () => { closed = true })
    opened()
  })
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve))
  t.after(async () => { origin.closeAllConnections(); await new Promise(resolve => origin.close(resolve)) })
  const f = await fixture(t)
  const url = `http://127.0.0.1:${origin.address().port}`
  await f.write('index.jsp', `<?js await fetch(new Request(${JSON.stringify(url)})); echo('done'); ?>`)
  const address = await f.start()
  assert.equal(await (await fetch(address)).text(), 'done')
  await entered
  await waitFor(() => closed)
})
