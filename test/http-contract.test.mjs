import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cow-http-'))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, logger: { error() {} } })
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'index.jsp'), '<?js res.send("hello π"); ?>')
  await writeFile(join(root, 'style.css'), 'body{}')
  return { root, app, write: (name, source) => writeFile(join(root, name), source) }
}

function http(app, path, method = 'GET', body, headers = {}) {
  if (path === '*') return new Promise((resolve, reject) => {
    // Send the literal request target independently of a host HTTP client's URL handling.
    const socket = connect(app.address().port, '127.0.0.1')
    let wire = ''
    socket.setTimeout(3000, () => socket.destroy(new Error('OPTIONS * timed out')))
    socket.on('error', reject)
    socket.on('data', chunk => { wire += chunk })
    socket.on('close', () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(wire)?.[1]), body: wire }))
    socket.on('connect', () => socket.write('OPTIONS * HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'))
  })
  return new Promise((resolve, reject) => {
    const req = request(app.address().url, { path, method, headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('OPTIONS resolves public routes and advertises route-specific methods without running pages', async t => {
  const f = await fixture(t)
  await f.write('index.jsp', '<?js throw new Error("must not execute OPTIONS"); ?>')
  await f.app.start()
  for (const path of ['/missing', '/_private', '/index.jsp']) assert.equal((await http(f.app, path, 'OPTIONS')).status, 404)
  for (const path of ['/style.css', '/_cow/health', '/_cow/status']) {
    const result = await http(f.app, path, 'OPTIONS')
    assert.equal(result.status, 204)
    assert.equal(result.headers.allow, 'GET, HEAD, OPTIONS')
    assert.equal((await http(f.app, path, 'POST')).status, 405)
  }
  const page = await http(f.app, '/', 'OPTIONS')
  assert.equal(page.status, 204)
  assert.equal(page.headers.allow, 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS')
  assert.equal((await http(f.app, '/', 'TRACE')).status, 405)
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
  const star = await f.app.execute({ method: 'OPTIONS', url: '*' })
  assert.equal(star.response.status, 204)
  // Bun 1.4.2 rejects '*' in its native HTTP parser before calling Cow. Keep
  // this host limitation explicit; route-level OPTIONS above still must pass.
  assert.equal((await http(f.app, '*', 'OPTIONS')).status, globalThis.Bun ? 400 : 204)
})

test('HEAD and 204/205/304 have safe framing in HTTP and embedded responses', async t => {
  const f = await fixture(t)
  await f.write('framing.jsp', '<?js res.status(Number(req.get("status") || 200)); res.setHeader("content-length", "900"); res.setHeader("transfer-encoding", "chunked"); res.setHeader("trailer", "x-end"); res.send("hello π"); ?>')
  await f.app.start()
  for (const path of ['/', '/style.css', '/_cow/health', '/_cow/status', '/missing']) {
    const result = await http(f.app, path, 'HEAD')
    assert.equal(result.status, path === '/missing' ? 404 : 200)
    assert.equal(result.body, '')
    assert.ok(Number(result.headers['content-length']) > 0)
  }
  for (const method of ['GET', 'HEAD']) for (const status of [200, 204, 205, 304]) {
    const path = `/framing?status=${status}`
    const wire = await http(f.app, path, method)
    const embedded = (await f.app.execute({ url: path, method })).response
    for (const result of [wire, { ...embedded, body: Buffer.from(embedded.body).toString() }]) {
      assert.equal(result.status, status)
      assert.equal(result.body, status === 200 && method === 'GET' ? 'hello π' : '')
      assert.equal(result.headers['transfer-encoding'], undefined)
      assert.equal(result.headers.trailer, undefined)
      assert.equal(result.headers['content-length'], [204, 304].includes(status) ? undefined : status === 205 ? '0' : '8')
    }
  }
})

test('invalid final status codes fail safely, including legacy response fields', async t => {
  const f = await fixture(t)
  await f.write('index.jsp', '<?js res.status(Number(req.get("status"))); echo("bad"); ?>')
  await f.write('legacy.jsp', '<?js __res._statusCode = 103; echo("bad"); ?>')
  await f.app.start()
  for (const status of [100, 101, 103, 199, 600, 999]) {
    await assert.rejects(f.app.execute({ url: `/?status=${status}` }), /Invalid HTTP status/)
  }
  await assert.rejects(f.app.execute({ url: '/legacy' }), /Invalid HTTP status/)
  assert.equal((await http(f.app, '/?status=103')).status, 500)
})

test('malformed JSON/forms are 400, wrong form media type is 415, valid values remain intact', async t => {
  const f = await fixture(t)
  const web = pathToFileURL(join(process.cwd(), 'lib/web.mjs')).href
  await f.write('json.jsp', '<?js res.json(req.json()); ?>')
  await f.write('form.jsp', `<?js import { form } from ${JSON.stringify(web)}; res.json([...form(req)]); ?>`)
  await f.app.start()
  for (const body of ['', '{', Buffer.from([0x22, 0xff, 0x22])]) {
    const result = await http(f.app, '/json', 'POST', body)
    assert.equal(result.status, 400, result.body)
  }
  for (const body of ['x=%', 'x=%ZZ', 'x=%C0%AF', Buffer.from([0x78, 0x3d, 0xff])]) {
    const result = await http(f.app, '/form', 'POST', body, { 'content-type': 'application/x-www-form-urlencoded' })
    assert.equal(result.status, 400, result.body)
  }
  assert.equal((await http(f.app, '/form', 'POST', 'x=1')).status, 415)
  assert.equal((await http(f.app, '/json', 'POST', 'null')).body, 'null')
  const good = await http(f.app, '/form', 'POST', 'x=a+b&x=%CF%80&__proto__=safe', { 'content-type': 'application/x-www-form-urlencoded' })
  assert.deepEqual(JSON.parse(good.body), [['x', 'a b'], ['x', 'π'], ['__proto__', 'safe']])
})

test('conflicting input framing is rejected by the HTTP parser before page execution', async t => {
  const f = await fixture(t)
  await f.app.start()
  const wire = await new Promise((resolve, reject) => {
    const socket = connect(f.app.address().port, '127.0.0.1')
    let data = ''
    socket.setTimeout(3000, () => socket.destroy(new Error('HTTP parser did not reject bad framing')))
    socket.on('error', reject)
    socket.on('data', chunk => { data += chunk })
    socket.on('close', () => resolve(data))
    socket.on('connect', () => socket.write('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n'))
  })
  assert.match(wire, /^HTTP\/1.1 400/)
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
})

test('diagnostics do not buffer unfinished uploads or leave connections reusable', async t => {
  const f = await fixture(t)
  await f.app.start()
  for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
    const result = await http(f.app, '/_cow/health', method, 'x', { 'content-length': '100000' })
    assert.equal(result.status, method === 'POST' ? 405 : method === 'OPTIONS' ? 204 : 200)
    assert.equal(result.headers.connection, 'close')
  }
  assert.equal(f.app.dispatcher.status().bufferedBytes, 0)
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
})
