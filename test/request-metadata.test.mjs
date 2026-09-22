import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CowApp, normalizeRequest } from '../lib/app.mjs'
import { connectionMetadata, httpConnection, requestHost } from '../lib/request-metadata.mjs'

const page = `<?js res.json({address:req.address(),scheme:req.scheme(),host:req.host(),rawHost:req.header('host') ?? null,url:req.url()}); ?>`
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-metadata-'))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, maxRequestsPerWorker: 0, logger: { error() {} }, ...options })
  t.after(async () => { try { await app.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await writeFile(join(root, 'index.jsp'), page)
  return { root, app, async execute(input = {}) {
    await app.initialize()
    const result = await app.execute({ url: '/', ...input })
    return JSON.parse(Buffer.from(result.response.body))
  } }
}

function http(app, { headers, path = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(app.address().url, { headers, path }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.end()
  })
}

function raw(app, data) {
  return new Promise((resolve, reject) => {
    const socket = connect(app.address().port, '127.0.0.1')
    let result = ''
    socket.setTimeout(5000, () => socket.destroy(new Error('HTTP response deadline exceeded')))
    socket.on('connect', () => socket.write(data))
    socket.on('data', chunk => { result += chunk })
    socket.on('error', reject)
    socket.on('close', () => resolve(result))
  })
}

test('request hosts preserve explicit ports and bracketed IPv6 without URL repair or origin inference', () => {
  for (const [value, expected] of [
    ['EXAMPLE.test', 'example.test'], ['localhost:8000', 'localhost:8000'],
    ['Example.test:80', 'example.test:80'], ['example.test:00443', 'example.test:443'],
    ['example.test:000080', 'example.test:80'],
    ['[2001:DB8::1]:443', '[2001:db8::1]:443'], ['[::ffff:192.0.2.1]', '[::ffff:192.0.2.1]'],
    ['127.0.0.1:0', '127.0.0.1:0'], ['xn--bcher-kva.test:65535', 'xn--bcher-kva.test:65535'],
    ['internal_name.test.', 'internal_name.test.']
  ]) assert.equal(requestHost({ Host: value }), expected)
  for (const value of ['', null, undefined]) assert.equal(requestHost({ host: value }), null)
  assert.equal(requestHost({}), null)
  assert.equal(requestHost(null), null)
  assert.equal(normalizeRequest({ headers: null }).host, null)
  assert.equal(requestHost({ host: ['EXAMPLE.test:443'] }), 'example.test:443')
})

test('ambiguous or malformed Host authorities fail with 400 instead of choosing a host', () => {
  for (const value of [[], ['one.test', 'two.test'], 123, {}, 'user@example.test', 'https://example.test',
    'example.test/path', 'example.test/', 'example.test?x', 'example.test#x', 'example.test\\path',
    'example.test:abc', 'example.test:', 'example.test:65536',
    'one.test,two.test', 'one.test two.test', ' example.test', 'example.test ', 'example.test\r\nx:a',
    'exam\tple.test', '%65xample.test', 'bücher.test', '[::1', '::1', '[127.0.0.1]', '[fe80::1%eth0]',
    '[1:2:3]:443', 'x'.repeat(1025)]) {
    assert.throws(() => requestHost({ host: value }), { status: 400, code: 'COW_INVALID_HOST' }, String(value))
  }
  assert.throws(() => requestHost({ Host: 'one.test', host: 'two.test' }), { code: 'COW_INVALID_HOST' })
})

test('connection metadata is explicit, validated and never inferred from headers or URL', () => {
  assert.deepEqual(connectionMetadata({}), { remoteAddress: null, scheme: null })
  for (const remoteAddress of ['192.0.2.1', '2001:db8::1', '::ffff:192.0.2.1']) {
    assert.deepEqual(connectionMetadata({ remoteAddress, scheme: 'https' }), { remoteAddress, scheme: 'https' })
  }
  for (const remoteAddress of ['', 'localhost', '1.2.3.4:80', ['192.0.2.1'], 12]) {
    assert.throws(() => connectionMetadata({ remoteAddress }), TypeError)
  }
  for (const scheme of ['HTTPS', 'https:', 'ftp', '', false]) assert.throws(() => connectionMetadata({ scheme }), TypeError)
  const input = normalizeRequest({ url: 'https://target.invalid/', headers: {
    forwarded: 'for=192.0.2.1;proto=https;host=public.test', 'x-forwarded-for': '192.0.2.1',
    'x-forwarded-proto': 'https', 'x-forwarded-host': 'public.test', 'x-real-ip': '192.0.2.1'
  } })
  assert.equal(input.remoteAddress, null)
  assert.equal(input.scheme, null)
  assert.equal(input.host, null)
})

test('HTTP connection snapshots use the socket and distinguish encryption from a claimed HTTPS URL', () => {
  const req = { socket: { remoteAddress: '2001:db8::5', encrypted: true },
    url: 'http://ignored.test/', headers: { 'x-forwarded-proto': 'http' } }
  const snapshot = httpConnection(req)
  req.socket.remoteAddress = '192.0.2.8'; req.socket.encrypted = false
  assert.deepEqual(snapshot, { remoteAddress: '2001:db8::5', scheme: 'https' })
  assert.deepEqual(httpConnection(req), { remoteAddress: '192.0.2.8', scheme: 'http' })
  assert.deepEqual(httpConnection({ url: 'https://ignored.test/' }), { remoteAddress: null, scheme: null })
})

test('normalized requests snapshot metadata and Host arrays without mutating caller input', () => {
  const host = ['EXAMPLE.test:443']
  const input = { remoteAddress: '192.0.2.5', scheme: 'https', headers: { Host: host } }
  const result = normalizeRequest(input)
  input.remoteAddress = '192.0.2.6'; input.scheme = 'http'; host[0] = 'changed.test'
  assert.equal(result.remoteAddress, '192.0.2.5')
  assert.equal(result.scheme, 'https')
  assert.equal(result.host, 'example.test:443')
  assert.deepEqual(result.headers.host, ['EXAMPLE.test:443'])
  assert.ok(Object.isFrozen(result))
  assert.ok(Object.isFrozen(result.headers.host))
  assert.deepEqual(normalizeRequest(result), result)
})

test('embedded execution has honest missing metadata and no previous-request carryover', async t => {
  const f = await fixture(t)
  for (let n = 0; n < 3; n++) {
    assert.deepEqual(await f.execute({ remoteAddress: '2001:db8::5', scheme: 'https', headers: { Host: 'Example.test:443' } }), {
      address: '2001:db8::5', scheme: 'https', host: 'example.test:443', rawHost: 'Example.test:443', url: '/'
    })
    assert.deepEqual(await f.execute(), { address: null, scheme: null, host: null, rawHost: null, url: '/' })
    assert.deepEqual(await f.execute({ headers: { host: '[::1]:80' } }), {
      address: null, scheme: null, host: '[::1]:80', rawHost: '[::1]:80', url: '/'
    })
  }
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('malformed embedded metadata fails before executing a page', async t => {
  const f = await fixture(t)
  await f.app.initialize()
  await assert.rejects(f.app.execute({ headers: { host: 'good.test/bad' } }), { status: 400, code: 'COW_INVALID_HOST' })
  await assert.rejects(f.app.execute({ headers: { Host: 'one.test', host: 'two.test' } }), { code: 'COW_INVALID_HOST' })
  await assert.rejects(f.app.execute({ remoteAddress: 'unvalidated user input' }), TypeError)
  await assert.rejects(f.app.execute({ scheme: 'ftp' }), TypeError)
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
})

test('HTTP metadata reports the direct peer and Host, never forwarded claims or the absolute request target', async t => {
  const f = await fixture(t)
  await f.app.start()
  const normal = await http(f.app)
  assert.equal(normal.status, 200, normal.body)
  assert.deepEqual(JSON.parse(normal.body), {
    address: '127.0.0.1', scheme: 'http', host: `127.0.0.1:${f.app.address().port}`,
    rawHost: `127.0.0.1:${f.app.address().port}`, url: '/'
  })
  for (const path of ['/', 'https://target.invalid/']) {
    const response = await http(f.app, { path, headers: { host: 'Supplied.test:443',
      forwarded: 'for=192.0.2.5;proto=https;host=forwarded.test', 'x-forwarded-for': '192.0.2.6, 192.0.2.7',
      'x-forwarded-proto': 'https', 'x-forwarded-host': 'forwarded.test', 'x-real-ip': '192.0.2.8' } })
    assert.equal(response.status, 200, response.body)
    assert.deepEqual(JSON.parse(response.body), {
      address: '127.0.0.1', scheme: 'http', host: 'supplied.test:443', rawHost: 'Supplied.test:443', url: path
    })
  }
})

test('raw HTTP rejects duplicate/invalid Host before reading a body, including static and diagnostic paths', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'style.css'), 'body{}')
  await f.app.start()
  for (const path of ['/', '/style.css', '/_cow/health']) for (const host of [
    'Host: one.test\r\nHost: two.test', 'Host: one.test/path', 'Host: one.test:99999'
  ]) {
    const result = await raw(f.app, `POST ${path} HTTP/1.1\r\n${host}\r\nContent-Length: 10000\r\nConnection: close\r\n\r\nx`)
    assert.match(result, /^HTTP\/1.1 400/)
    assert.match(result, /COW_INVALID_HOST/)
  }
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
  assert.equal(f.app.dispatcher.status().bufferedBytes, 0)
})

test('HTTP/1.0 requests without Host do not invent the listener address as a host', async t => {
  const f = await fixture(t)
  await f.app.start()
  const response = await raw(f.app, 'GET / HTTP/1.0\r\nConnection: close\r\n\r\n')
  assert.match(response, /^HTTP\/1.1 200/)
  assert.deepEqual(JSON.parse(response.split('\r\n\r\n')[1]), {
    address: '127.0.0.1', scheme: 'http', host: null, rawHost: null, url: '/'
  })
})

test('includes see the same metadata and mutation attempts cannot change request snapshots', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, '_child.tsp'), page.replace('<?js', '<?ts'))
  await writeFile(join(f.root, 'include.jsp'), `<?js
    try { req.host=()=> 'changed.test' } catch {}
    try { req.headers().host='changed.test' } catch {}
    await include('./_child.tsp'); ?>`)
  assert.deepEqual(await f.execute({ url: '/include', headers: { host: 'Example.test' }, scheme: 'https', remoteAddress: '192.0.2.1' }), {
    address: '192.0.2.1', scheme: 'https', host: 'example.test', rawHost: 'Example.test', url: '/include'
  })
})
