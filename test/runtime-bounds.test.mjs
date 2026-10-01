import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { request } from 'node:http'
import { Worker } from 'node:worker_threads'
import { CowApp } from '../lib/app.mjs'
import { WorkerPool } from '../lib/worker-pool.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-bounds-'))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, logger: { error() {} }, ...options })
  t.after(async () => {
    await app.close().catch(() => {})
    assert.equal(dirname(root), tmpdir())
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  return {
    root, app,
    write: (name, source) => writeFile(join(root, name), source),
    read: (name) => readFile(join(root, name), 'utf8'),
    start: async () => (await app.start()).url
  }
}

async function waitFor(predicate) {
  for (let n = 0; n < 300; n++) {
    if (await predicate()) return
    await delay(10)
  }
  assert.fail('Condition did not settle within 3 seconds')
}

function slowPost(t, url, length, prefix = 'x') {
  let client
  const result = new Promise((resolve, reject) => {
    client = request(url, { method: 'POST', headers: { 'content-length': length }, agent: false }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }))
      response.on('error', reject)
    })
    client.on('error', reject)
    client.write(prefix)
  })
  result.catch(() => {})
  t.after(() => client.destroy())
  return { client, result }
}

test('failed Promise.all drains sibling dynamic imports before the next request', async (t) => {
  const f = await fixture(t)
  await f.write('_slow.mjs', `
    import { setTimeout } from 'node:timers/promises';
    import { writeFile } from 'node:fs/promises';
    await setTimeout(100);
    await writeFile(new URL('./_import-done', import.meta.url), 'done');
    globalThis.previousRequest = true;
    export const done = true;
  `)
  await f.write('fail.jsp', `<?js await Promise.all([import('./_slow.mjs'), Promise.reject(new Error('primary failure'))]); ?>`)
  await f.write('index.jsp', `<?js res.json({leaked:globalThis.previousRequest === true}); ?>`)
  const url = await f.start()
  const response = await fetch(url + '/fail')
  assert.equal(response.status, 500)
  assert.match(await response.text(), /primary failure/)
  assert.equal(await f.read('_import-done'), 'done')
  assert.deepEqual(await (await fetch(url)).json(), { leaked: false })
  assert.equal(f.app.runtime.status().workersCrashed, 0)
})

test('tracked native work settles after render failure', async (t) => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js
    import { setTimeout } from 'node:timers/promises';
    import { writeFile } from 'node:fs/promises';
    const work = cow.track(setTimeout(100).then(() => writeFile(__dirname + '/_tracked', 'done')));
    await Promise.all([work, Promise.reject(new Error('primary failure'))]);
  ?>`)
  const response = await fetch(await f.start())
  assert.equal(response.status, 500)
  assert.match(await response.text(), /primary failure/)
  assert.equal(await f.read('_tracked'), 'done')
})

test('a failing static import graph drains sibling top-level evaluation', async (t) => {
  const f = await fixture(t)
  await f.write('_slow.mjs', `
    import { setTimeout } from 'node:timers/promises';
    import { writeFile } from 'node:fs/promises';
    await setTimeout(150);
    await writeFile(new URL('./_static-done', import.meta.url), 'done');
    export const value = 'ready';
  `)
  await f.write('_fail.mjs', `await new Promise(r => setTimeout(r, 10)); throw new Error('static failure');`)
  await f.write('_root.mjs', `import './_slow.mjs'; import './_fail.mjs';`)
  await f.write('index.jsp', `<?js await import('./_root.mjs'); ?>`)
  const response = await fetch(await f.start())
  assert.equal(response.status, 500)
  assert.match(await response.text(), /static failure/)
  assert.equal(await f.read('_static-done'), 'done')
})

test('imported timer callbacks are cancelled before a subsequent request', async (t) => {
  const f = await fixture(t)
  await f.write('old.jsp', `<?js
    import { setTimeout as nativeTimeout } from 'node:timers';
    import { writeFileSync } from 'node:fs';
    nativeTimeout(async () => {
      try { cow.onCleanup(() => writeFileSync(__dirname + '/_wrong-cleanup', 'bad')); }
      catch (error) { writeFileSync(__dirname + '/_late-error', error.code); }
      try { await import('./_late.mjs'); }
      catch (error) { writeFileSync(__dirname + '/_late-import', error.code); }
    }, 200);
    echo('old');
  ?>`)
  await f.write('index.jsp', `<?js await new Promise(r => setTimeout(r, 400)); echo('new'); ?>`)
  await f.write('_late.mjs', 'globalThis.lateImport = true;')
  const url = await f.start()
  assert.equal(await (await fetch(url + '/old')).text(), 'old')
  assert.equal(await (await fetch(url)).text(), 'new')
  await assert.rejects(f.read('_late-error'), { code: 'ENOENT' })
  await assert.rejects(f.read('_late-import'), { code: 'ENOENT' })
  await assert.rejects(f.read('_wrong-cleanup'), { code: 'ENOENT' })
})

test('hung tracked work remains subject to the execution deadline', async (t) => {
  const f = await fixture(t, { timeout: 150 })
  await f.write('hang.jsp', `<?js cow.track(new Promise(() => {})); throw new Error('render failed'); ?>`)
  await f.write('index.jsp', 'recovered')
  const url = await f.start()
  assert.equal((await fetch(url + '/hang')).status, 504)
  assert.equal(await (await fetch(url)).text(), 'recovered')
})

test('output bytes, UTF-8 and swallowed quota errors stay bounded without killing the worker', async (t) => {
  const f = await fixture(t, { outputLimit: 100_000 })
  await f.write('index.jsp', `<?js for(let n=0;n<100000;n++) res.write('x'); ?>`)
  await f.write('empty.jsp', `<?js for(let n=0;n<100000;n++) res.write(''); echo('ok'); ?>`)
  await f.write('oversize.jsp', `<?js try { echo('é'.repeat(50001)); } catch {} echo('ignored'); ?>`)
  await f.write('replace.jsp', `<?js echo('x'.repeat(100000)); res.send('replaced'); ?>`)
  const url = await f.start()
  assert.equal((await (await fetch(url)).text()).length, 100_000)
  assert.equal(await (await fetch(url + '/empty')).text(), 'ok')
  const response = await fetch(url + '/oversize')
  assert.equal(response.status, 500)
  assert.match(await response.text(), /COW_RESPONSE_TOO_LARGE/)
  assert.equal(await (await fetch(url + '/replace')).text(), 'replaced')
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('slow senders exhaust admission before any compilation and expire on a body deadline', async (t) => {
  const f = await fixture(t, { maxQueue: 1, bodyTimeout: 600 })
  await f.write('index.jsp', 'healthy')
  const url = await f.start()
  const uploads = [slowPost(t, url, 100), slowPost(t, url, 100)]
  await waitFor(() => f.app.dispatcher.status().admittedRequests === 2)
  const rejected = await Promise.all(Array.from({ length: 8 }, () => fetch(url, { method: 'POST', body: 'x' })))
  for (const response of rejected) {
    assert.equal(response.status, 503)
    assert.match(await response.text(), /COW_ADMISSION_FULL/)
  }
  assert.equal(f.app.dispatcher.compiler.cache.size, 0)
  assert.equal((await fetch(url + '/_cow/health')).status, 200)
  for (const upload of uploads) {
    const result = await upload.result
    assert.equal(result.status, 408)
    assert.match(result.text, /COW_BODY_TIMEOUT/)
  }
  await waitFor(() => f.app.dispatcher.status().admittedRequests === 0)
  assert.equal(f.app.dispatcher.status().bufferedBytes, 0)
  assert.equal(await (await fetch(url)).text(), 'healthy')
})

test('aggregate input bytes and early Content-Length rejection release all reservations', async (t) => {
  const f = await fixture(t, { maxQueue: 4, bodyLimit: 10, bufferLimit: 8 })
  await f.write('index.jsp', '<?js res.status(204); res.end(); ?>')
  const url = await f.start()
  const first = slowPost(t, url, 4, 'aaa')
  const second = slowPost(t, url, 4, 'bbbb')
  // Completed uploads also return their reservations before the next batch.
  first.client.end('a')
  assert.equal((await first.result).status, 204)
  assert.equal((await second.result).status, 204)
  await waitFor(() => f.app.dispatcher.status().bufferedBytes === 0)
  const held = slowPost(t, url, 10, '12345678')
  await waitFor(() => f.app.dispatcher.status().bufferedBytes === 8)
  const overflow = await fetch(url, { method: 'POST', body: 'x' })
  assert.equal(overflow.status, 503)
  assert.match(await overflow.text(), /COW_BUFFER_FULL/)
  const large = slowPost(t, url, 11)
  assert.equal((await large.result).status, 413)
  held.client.destroy()
  await waitFor(() => f.app.dispatcher.status().admittedRequests === 0)
  assert.equal(f.app.dispatcher.status().bufferedBytes, 0)
  await f.write('fragmented.jsp', '<?js res.status(204); if(req.body().length !== 6) throw new Error("Missing body bytes"); ?>')
  const fragmented = count => new Promise((resolve, reject) => {
    const client = request(url + '/fragmented', { method: 'POST', agent: false }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    client.on('error', reject)
    for (let n = 0; n < count; n++) client.write('x')
    client.end()
  })
  assert.equal(await fragmented(6), 204)
  // More than the aggregate budget remains a 503 even without Content-Length.
  assert.equal(await fragmented(10), 503)
  await waitFor(() => f.app.dispatcher.status().bufferedBytes === 0)
})

test('pending HTTP output retains its byte reservation until disconnect', async (t) => {
  const bytes = 1024
  const f = await fixture(t, { outputLimit: bytes, bufferLimit: bytes, maxQueue: 2 })
  await f.write('large.jsp', `<?js res.send(Buffer.alloc(${bytes}, 120)); ?>`)
  await f.write('index.jsp', 'healthy')
  const url = await f.start()
  const server = f.app.server
  const handle = server.handle
  let retainedBody
  // Delay transport completion deterministically. Loopback send-buffer sizes
  // vary by OS: a paused client may still accept an entire response in-kernel.
  server.handle = function (req, res, ...args) {
    if (req.url === '/large') {
      res.end = body => { retainedBody = body; return res }
    }
    return handle.call(this, req, res, ...args)
  }
  const controller = new AbortController()
  t.after(() => controller.abort())
  const pending = fetch(url + '/large', { signal: controller.signal }).catch(error => error)
  await waitFor(() => f.app.dispatcher.status().bufferedBytes === bytes)
  assert.equal(retainedBody.length, bytes)
  const denied = await fetch(url)
  assert.equal(denied.status, 503)
  assert.match(await denied.text(), /COW_BUFFER_FULL/)
  assert.equal(f.app.dispatcher.status().admittedRequests, 1)
  controller.abort()
  await pending
  await waitFor(() => f.app.dispatcher.status().admittedRequests === 0)
  assert.equal(f.app.dispatcher.status().bufferedBytes, 0)
  assert.equal(await (await fetch(url)).text(), 'healthy')
})

test('queued requests expire without executing their writes', async (t) => {
  const f = await fixture(t, { queueTimeout: 80 })
  await f.write('slow.jsp', '<?js await new Promise(r => setTimeout(r, 350)); echo("done"); ?>')
  await f.write('write.jsp', `<?js import { writeFile } from 'node:fs/promises'; await writeFile(__dirname+'/_mutation','bad'); ?>`)
  const url = await f.start()
  const slow = fetch(url + '/slow')
  await waitFor(() => f.app.runtime.status().busyWorkers === 1)
  const queued = await fetch(url + '/write')
  assert.equal(queued.status, 503)
  assert.match(await queued.text(), /COW_QUEUE_TIMEOUT/)
  assert.equal(await (await slow).text(), 'done')
  await assert.rejects(f.read('_mutation'), { code: 'ENOENT' })
  assert.equal(f.app.runtime.status().queueTimeouts, 1)
})

test('disconnected queued requests are removed and never mutate data', async (t) => {
  const f = await fixture(t)
  await f.write('slow.jsp', '<?js await new Promise(r => setTimeout(r, 350)); echo("done"); ?>')
  await f.write('write.jsp', `<?js import { writeFile } from 'node:fs/promises'; await writeFile(__dirname+'/_mutation','bad'); ?>`)
  const url = await f.start()
  const slow = fetch(url + '/slow')
  await waitFor(() => f.app.runtime.status().busyWorkers === 1)
  const controller = new AbortController()
  const queued = fetch(url + '/write', { signal: controller.signal }).catch(error => error)
  await waitFor(() => f.app.runtime.status().queuedRequests === 1)
  controller.abort()
  await queued
  await waitFor(() => f.app.runtime.status().queuedRequests === 0)
  assert.equal(await (await slow).text(), 'done')
  await assert.rejects(f.read('_mutation'), { code: 'ENOENT' })
  assert.equal(f.app.runtime.status().requestsCancelled, 1)
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('client cancellation answers at once and lets the page finish once on the same worker', async (t) => {
  const f = await fixture(t)
  await f.write('slow.jsp', `<?js
    import { appendFile } from 'node:fs/promises';
    await new Promise(r => setTimeout(r, 500));
    await appendFile(__dirname+'/_mutation','done;');
  ?>`)
  await f.write('index.jsp', 'healthy')
  await f.start()
  const controller = new AbortController()
  const running = f.app.execute({ url: '/slow' }, { signal: controller.signal })
  const rejected = assert.rejects(running, { code: 'COW_REQUEST_CANCELLED' })
  await waitFor(() => f.app.runtime.status().busyWorkers === 1)
  controller.abort()
  await rejected
  // The page was partway through; it finishes its write exactly once.
  assert.equal(await (await fetch(f.app.address().url)).text(), 'healthy')
  await waitFor(() => f.read('_mutation').then(() => true, () => false))
  await delay(100)
  assert.equal(await f.read('_mutation'), 'done;')
  const status = f.app.runtime.status()
  assert.equal(status.workersSpawned, 1, 'the worker was not killed')
  assert.equal(status.requestsAbandoned, 1)
})

test('a page that follows cow.signal stops early after the client disconnects', async (t) => {
  const f = await fixture(t)
  await f.write('wait.jsp', `<?js
    import { writeFile } from 'node:fs/promises';
    await writeFile(__dirname+'/_started','yes');
    await new Promise((resolve, reject) => {
      if (cow.signal.aborted) return reject(cow.signal.reason);
      const timer = setTimeout(resolve, 5000);
      cow.signal.addEventListener('abort', () => { clearTimeout(timer); reject(cow.signal.reason) });
    });
    await writeFile(__dirname+'/_late','reached');
  ?>`)
  await f.write('index.jsp', 'healthy')
  await f.start()
  const controller = new AbortController()
  const running = f.app.execute({ url: '/wait' }, { signal: controller.signal })
  const rejected = assert.rejects(running, { code: 'COW_REQUEST_CANCELLED' })
  // Disconnect once the page runs, so the abort reaches it rather than its module loading.
  await waitFor(async () => (await f.read('_started').catch(() => '')) === 'yes')
  const cancelledAt = performance.now()
  controller.abort()
  await rejected
  await waitFor(() => f.app.runtime.status().busyWorkers === 0)
  assert.ok(performance.now() - cancelledAt < 2000, 'the worker was freed long before the page timer')
  await assert.rejects(f.read('_late'), { code: 'ENOENT' })
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('startup has a deadline and a failed start leaves no workers', async () => {
  const pool = new WorkerPool({ size: 1, startupTimeout: 80, shutdownTimeout: 80 }, {
    createWorker: () => new Worker('setInterval(() => {}, 1000)', { eval: true })
  })
  const started = performance.now()
  await assert.rejects(pool.start(), { code: 'COW_WORKER_START_TIMEOUT' })
  assert.ok(performance.now() - started < 1500)
  assert.equal(pool.status().workers, 0)
  assert.equal(pool.status().state, 'stopped')
})

test('startup failures during recovery back off and expose exhausted capacity', async (t) => {
  const spawns = []
  const pool = new WorkerPool({ size: 1, startupTimeout: 200, restartDelay: 40, restartLimit: 1, queueTimeout: 2000 }, {
    createWorker: () => {
      spawns.push(performance.now())
      return new Worker(spawns.length === 1 ? `
        const { parentPort } = require('node:worker_threads');
        parentPort.postMessage({type:'ready'});
        parentPort.on('message', () => process.exit(17));
      ` : 'setInterval(() => {}, 1000)', { eval: true })
    }
  })
  t.after(() => pool.close())
  await pool.start()
  await assert.rejects(pool.run({}, {}), /exited with code 17/)
  const queued = assert.rejects(pool.run({}, {}), { code: 'COW_RECOVERY_EXHAUSTED' })
  await queued
  assert.equal(spawns.length, 2)
  assert.ok(spawns[1] - spawns[0] >= 40)
  assert.equal(pool.status().state, 'failed')
  assert.equal(pool.status().recovery[0].lastError.code, 'COW_WORKER_START_TIMEOUT')
  assert.equal(pool.status().recovery[0].consecutiveFailures, 2)
  await assert.rejects(pool.run({}, {}), { code: 'COW_RUNTIME_UNAVAILABLE' })
  await delay(150)
  assert.equal(spawns.length, 2)
})

test('closing during backoff cancels replacement and rejects queued work', async (t) => {
  let spawns = 0
  const pool = new WorkerPool({ size: 1, restartDelay: 200 }, {
    createWorker: () => {
      spawns++
      return new Worker(`
        const { parentPort } = require('node:worker_threads');
        parentPort.postMessage({type:'ready'});
        parentPort.on('message', () => process.exit(17));
      `, { eval: true })
    }
  })
  t.after(() => pool.close())
  await pool.start()
  await assert.rejects(pool.run({}, {}))
  const queued = assert.rejects(pool.run({}, {}), { code: 'COW_RUNTIME_CLOSED' })
  await pool.close()
  await queued
  await delay(250)
  assert.equal(spawns, 1)
  assert.equal(pool.status().workers, 0)
})

test('a successful replacement serves queued work and clears the failure streak', async (t) => {
  const f = await fixture(t, { restartDelay: 80 })
  await f.write('crash.jsp', '<?js process.exit(17); ?>')
  await f.write('index.jsp', 'healthy')
  const url = await f.start()
  assert.equal((await fetch(url + '/crash')).status, 500)
  assert.equal(await (await fetch(url)).text(), 'healthy')
  assert.equal(f.app.runtime.status().workersSpawned, 2)
  assert.equal(f.app.runtime.status().recovery[0].consecutiveFailures, 0)
  assert.equal(f.app.runtime.status().recovery[0].lastError.code, 'COW_WORKER_EXIT')
})

test('an exhausted slot keeps retrying and serves again once a worker starts', async (t) => {
  let spawns = 0
  let healthy = false
  const logs = []
  const pool = new WorkerPool({ size: 1, startupTimeout: 150, restartDelay: 20, restartMaxDelay: 100, restartLimit: 1,
    logger: { warn: message => logs.push(message), error: message => logs.push(message) } }, {
    createWorker: () => {
      spawns++
      return new Worker(spawns === 1 ? `
        const { parentPort } = require('node:worker_threads');
        parentPort.postMessage({type:'ready'});
        parentPort.on('message', () => process.exit(17));
      ` : healthy ? `
        const { parentPort } = require('node:worker_threads');
        parentPort.postMessage({type:'ready'});
        parentPort.on('message', message => message.type === 'shutdown'
          ? parentPort.postMessage({type:'shutdown-complete'})
          : parentPort.postMessage({id: message.id, ok: true, result: 'served'}));
      ` : 'setInterval(() => {}, 1000)', { eval: true })
    }
  })
  t.after(() => pool.close())
  await pool.start()
  await assert.rejects(pool.run({}, {}), /exited with code 17/)
  await waitFor(() => pool.status().state === 'failed')
  assert.ok(logs.some(line => /slot 1 exhausted 1 restarts/.test(line)))
  const before = spawns
  await delay(250)
  assert.ok(spawns > before, 'a failed slot is retried')
  assert.equal(pool.status().state, 'failed')
  healthy = true
  await waitFor(() => pool.status().state === 'running')
  assert.equal(await pool.run({}, {}), 'served')
  assert.equal(pool.status().recovery[0].consecutiveFailures, 0)
  assert.ok(logs.some(line => /slot 1 started again/.test(line)))
})

test('a failed runtime refuses admission with its own code and one log line', async (t) => {
  const errors = []
  const f = await fixture(t, { logger: { error: message => errors.push(message), warn() {} } })
  await f.write('index.jsp', 'healthy')
  const url = await f.start()
  f.app.runtime.failed = true
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(url)))
  for (const response of responses) {
    assert.equal(response.status, 503)
    assert.match(await response.text(), /COW_RUNTIME_FAILED/)
  }
  assert.equal(errors.filter(line => /no worker is running/.test(line)).length, 1)
  f.app.runtime.failed = false
  assert.equal(await (await fetch(url)).text(), 'healthy')
})

test('a stalled connection loses its admissions, pipelined ones included, and a full admission names them', async (t) => {
  const { connect } = await import('node:net')
  const lines = []
  const log = message => lines.push(String(message?.message ?? message))
  const f = await fixture(t, { maxQueue: 2, stallTimeout: 300, logger: { error: log, warn: log } })
  await f.write('big.txt', 'x'.repeat(8 * 1024 * 1024))
  await f.write('index.jsp', 'healthy')
  const url = await f.start()
  const { port } = new URL(url)
  const socket = connect(Number(port), '127.0.0.1')
  t.after(() => socket.destroy())
  socket.on('error', () => {})
  await new Promise(resolve => socket.once('connect', resolve))
  socket.pause()
  // Three pipelined requests: the second and third queue behind the first.
  socket.write('GET /big.txt?token=secret HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'.repeat(3))
  await waitFor(() => f.app.dispatcher.status().admittedRequests === 3)
  const refused = await fetch(url)
  assert.equal(refused.status, 503)
  assert.match(await refused.text(), /COW_ADMISSION_FULL/)
  assert.deepEqual(f.app.dispatcher.status().admissionHolders.map(route => route.route), ['GET /big.txt'])
  assert.ok(lines.some(line => line.includes('Cow admission is full') && line.includes('GET /big.txt x3')))
  assert.ok(!lines.some(line => line.includes('secret')), 'a query string is never logged')
  await waitFor(() => f.app.dispatcher.status().admittedRequests === 0)
  assert.ok(lines.some(line => line.includes('Cow closed GET /big.txt')))
  assert.equal(await (await fetch(url)).text(), 'healthy')
})
