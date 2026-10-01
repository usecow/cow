import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
import { createRequestForm } from '../lib/uploads.mjs'
import { field } from '../lib/web.mjs'
// Encode an actual wire body consistently; Bun's native Response(FormData)
// currently omits Content-Type. Cow must still accept normal browser uploads.
import { Response, FormData } from 'undici/index.js'

async function encoded(values = [['title', 'Hello'], ['file', new Blob([Buffer.from([0, 255, 13, 10, 42])]), 'sample.bin']]) {
  const form = new FormData()
  for (const [name, value, filename] of values) {
    if (filename === undefined) form.append(name, value)
    else form.append(name, value, filename)
  }
  const response = new Response(form)
  return { body: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') }
}

function scope(input) {
  let cleanup
  const parse = createRequestForm({ ...input, assertActive() {}, onCleanup(fn) { cleanup = fn } })
  return { parse, close: () => cleanup() }
}

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'cow-uploads-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('multipart fields and binary uploads have a read-only, repeated-key-aware request API', async () => {
  const input = await encoded([['title', 'Hello 世界'], ['tag[]', 'a'], ['tag[]', 'b'], ['__proto__', 'safe'],
    ['file', new Blob([Buffer.from([0, 255, 13, 10, 42])], { type: 'application/octet-stream' }), '../client.bin']])
  const s = scope(input)
  try {
    const values = await s.parse()
    assert.ok(Object.isFrozen(values))
    assert.equal(field(values, 'title'), 'Hello 世界')
    assert.deepEqual(values.getAll('tag[]'), ['a', 'b'])
    assert.equal(values.get('__proto__'), 'safe')
    assert.equal(values.get('missing'), null)
    assert.equal(values.has('missing'), false)
    assert.deepEqual([...values.keys()], ['title', 'tag[]', 'tag[]', '__proto__', 'file'])
    assert.equal([...values].length, 5)
    assert.equal([...values.values()].length, 5)
    assert.throws(() => field(values, 'tag[]'), { status: 400 })
    assert.throws(() => field(values, 'file'), { status: 400 })
    const file = values.get('file')
    assert.equal(file.name, '../client.bin')
    assert.equal(file.type, 'application/octet-stream')
    assert.equal(file.size, 5)
    assert.ok(Object.isFrozen(file))
    assert.equal(file.path, undefined)
    const bytes = await file.bytes()
    assert.deepEqual([...bytes], [0, 255, 13, 10, 42])
    bytes[0] = 5
    assert.deepEqual([...(await file.bytes())], [0, 255, 13, 10, 42])
    assert.equal((await s.parse()).get('file'), file)
    const all = values.getAll('tag[]'); all.push('c')
    assert.deepEqual(values.getAll('tag[]'), ['a', 'b'])
  } finally { s.close() }
})

test('ordinary forms keep strict URL/UTF-8 decoding and repeated names', async () => {
  const s = scope({ body: Buffer.from('title=Hello+world&tag=a&tag=b'), contentType: 'application/x-www-form-urlencoded; charset=utf-8' })
  assert.equal(field(await s.parse(), 'title'), 'Hello world')
  assert.deepEqual((await s.parse()).getAll('tag'), ['a', 'b'])
  s.close()
  for (const body of [Buffer.from('value=%FF'), Buffer.from('value=%GG'), Buffer.from([0xff])]) {
    const invalid = scope({ body, contentType: 'application/x-www-form-urlencoded' })
    await assert.rejects(invalid.parse(), { status: 400, code: 'COW_INVALID_FORM' })
    invalid.close()
  }
})

test('multipart parser rejects missing boundaries, broken headers and truncated bodies', async () => {
  const good = await encoded()
  for (const input of [
    { ...good, contentType: 'multipart/form-data' },
    { ...good, body: good.body.subarray(0, good.body.length - 12) },
    { contentType: 'multipart/form-data; boundary=x', body: Buffer.from('--x\r\nnot a header\r\n\r\nvalue\r\n--x--') },
    { contentType: 'multipart/form-data; boundary=x', body: Buffer.from('not multipart') }
  ]) {
    const s = scope(input)
    await assert.rejects(s.parse(), { status: 400, code: 'COW_INVALID_MULTIPART' })
    await assert.rejects(s.parse(), { status: 400 })
    s.close()
  }
  const other = scope({ body: Buffer.from('{}'), contentType: 'application/json' })
  await assert.rejects(other.parse(), { status: 415, code: 'COW_FORM_CONTENT_TYPE' })
  other.close()
})

test('file/count/field limits reject rather than truncate, including repeated calls and UTF-8 byte sizes', async () => {
  const s = scope(await encoded([['title', 'é'], ['file', new Blob(['12345']), 'five.txt']]))
  assert.equal((await s.parse({ maxFiles: 1, maxFileSize: 5, maxFields: 1, maxFieldSize: 2 })).get('file').size, 5)
  for (const options of [{ maxFiles: 0 }, { maxFileSize: 4 }, { maxFields: 0 }, { maxFieldSize: 1 }]) {
    await assert.rejects(s.parse(options), { status: 413, code: 'COW_FORM_LIMIT' })
  }
  for (const options of [null, [], { extra: 2 }, { maxFiles: -1 }, { maxFields: 0.5 }, { maxFileSize: Infinity }, { maxFiles: '1' }]) {
    await assert.rejects(s.parse(options), TypeError)
  }
  assert.equal((await s.parse()).get('title'), 'é')
  s.close()
  for (const values of [Array.from({ length: 11 }, () => ['file', new Blob([]), 'zero.txt']),
    Array.from({ length: 101 }, () => ['field', '']), [['field', 'a'.repeat(65_537)]],
    [['file', new Blob([new Uint8Array(1_048_577)]), 'big.bin']]]) {
    const s = scope(await encoded(values))
    await assert.rejects(s.parse(), { status: 413, code: 'COW_FORM_LIMIT' })
    s.close()
  }
})

test('field and filename metadata have byte limits and blank file controls differ from named empty files', async () => {
  for (const values of [[['x'.repeat(257), '']], [['file', new Blob([]), 'x'.repeat(1025)]]]) {
    const s = scope(await encoded(values))
    await assert.rejects(s.parse(), { status: 413, code: 'COW_FORM_NAME_TOO_LARGE' })
    s.close()
  }
  const s = scope(await encoded([['blank', new Blob([]), ''], ['zero', new Blob([]), 'zero.txt']]))
  const values = await s.parse()
  assert.equal(values.get('blank'), '') // Native FormData parsing treats filename="" as text.
  assert.equal(values.get('zero').size, 0)
  assert.equal(await values.get('zero').text(), '')
  s.close()
})

test('save is explicit, exclusive and single-use; failed saves can be retried', async t => {
  const root = await temporary(t)
  const s = scope(await encoded())
  try {
    const file = (await s.parse()).get('file')
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(file.save('relative.bin'), TypeError)
    await assert.rejects(file.save(join(root, 'missing', 'file.bin')), { code: 'ENOENT' })
    const destination = join(root, 'saved.bin')
    await writeFile(destination, 'existing')
    await assert.rejects(file.save(destination), { code: 'EEXIST' })
    assert.equal(await readFile(destination, 'utf8'), 'existing')
    const saved = join(root, 'new.bin')
    const first = file.save(saved)
    await assert.rejects(file.save(join(root, 'duplicate.bin')), { code: 'COW_UPLOAD_SAVING' })
    assert.equal(await first, saved)
    await assert.rejects(file.save(join(root, 'duplicate.bin')), { code: 'COW_UPLOAD_SAVED' })
    await assert.rejects(file.bytes(), { code: 'COW_UPLOAD_SAVED' })
    assert.deepEqual([...(await readFile(saved))], [0, 255, 13, 10, 42])
    assert.deepEqual((await readdir(root)).sort(), ['new.bin', 'saved.bin'])
  } finally { s.close() }
})

test('request cleanup revokes upload content and form access without writing temporary files', async t => {
  const root = await temporary(t)
  const s = scope(await encoded())
  const values = await s.parse(), file = values.get('file')
  s.close()
  assert.throws(() => values.get('file'), { code: 'COW_REQUEST_ENDED' })
  await assert.rejects(file.bytes(), { code: 'COW_REQUEST_ENDED' })
  await assert.rejects(file.text(), { code: 'COW_REQUEST_ENDED' })
  await assert.rejects(file.save(join(root, 'late.bin')), { code: 'COW_REQUEST_ENDED' })
  await assert.rejects(s.parse(), { code: 'COW_REQUEST_ENDED' })
  assert.deepEqual(await readdir(root), [])
})

async function site(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-uploads-'))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, maxRequestsPerWorker: 0, logger: { error() {} }, ...options })
  t.after(async () => { try { await app.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await writeFile(join(root, 'index.jsp'), `<?js
    import { field } from ${JSON.stringify(new URL('../lib/web.mjs', import.meta.url).href)};
    const values = await req.formData(req.get('small') ? {maxFileSize: 2} : undefined);
    const file = values.get('file');
    if(req.get('save')) await file.save(__dirname+'/_saved.bin');
    res.json({title:field(values,'title'),tags:values.getAll('tag'),name:file?.name,size:file?.size,
      bytes: file && !req.get('save') ? [...await file.bytes()] : [], raw:req.body().length});
  ?>`)
  await app.initialize()
  return { root, app, async request(path = '/', input) {
    input ||= await encoded()
    return app.execute({ url: path, method: 'POST', headers: { 'content-type': input.contentType }, body: input.body })
  } }
}

test('JSP and includes receive request-owned uploads with binary data and no state across reused workers', async t => {
  const f = await site(t)
  for (let i = 0; i < 3; i++) {
    const r = await f.request()
    assert.deepEqual(JSON.parse(Buffer.from(r.response.body)), { title: 'Hello', tags: [], name: 'sample.bin', size: 5, bytes: [0, 255, 13, 10, 42], raw: (await encoded()).body.length })
  }
  await writeFile(join(f.root, '_child.tsp'), '<?ts const values = await req.formData(); echo((await values.get("file").text())); ?>')
  await writeFile(join(f.root, 'include.jsp'), '<?js await req.formData(); await include("./_child.tsp"); ?>')
  assert.equal(Buffer.from((await f.request('/include', await encoded([['file', new Blob(['included']), 'text.txt']]))).response.body).toString(), 'included')
  assert.equal(f.app.runtime.status().workersSpawned, 1)
  assert.deepEqual((await readdir(f.root)).sort(), ['_child.tsp', 'include.jsp', 'index.jsp'])
})

test('HTTP forms return 400/413/415 on bad input and persist only explicitly saved files', async t => {
  const f = await site(t)
  const { url } = await f.app.start()
  const input = await encoded()
  const post = (path, body = input.body, type = input.contentType) => fetch(url + path, { method: 'POST', body, headers: { 'content-type': type } })
  assert.equal((await post('/?small=1')).status, 413)
  assert.equal((await post('/', input.body.subarray(0, input.body.length - 10))).status, 400)
  assert.equal((await post('/', '{}', 'application/json')).status, 415)
  assert.equal((await post('/?save=1')).status, 200)
  assert.deepEqual([...(await readFile(join(f.root, '_saved.bin')))], [0, 255, 13, 10, 42])
  assert.equal((await post('/?save=1')).status, 500)
  assert.equal((await post('/')).status, 200)
})

test('total body admission still rejects multipart data before site execution', async t => {
  const f = await site(t, { bodyLimit: 40 })
  await assert.rejects(f.request(), { status: 413, code: 'COW_BODY_TOO_LARGE' })
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
})

test('accepted upload work drains after render failure and cleanup hooks can still read unsaved uploads', async t => {
  const f = await site(t)
  await writeFile(join(f.root, 'failure.jsp'), `<?js
    import {writeFile} from 'node:fs/promises'; const values=await req.formData(); const file=values.get('file');
    file.save(__dirname+'/_drained.bin'); throw new Error('expected render failure'); ?>`)
  await assert.rejects(f.request('/failure'), /expected render failure/)
  assert.deepEqual([...(await readFile(join(f.root, '_drained.bin')))], [0, 255, 13, 10, 42])
  await writeFile(join(f.root, 'cleanup.jsp'), `<?js
    import {writeFile} from 'node:fs/promises'; const file=(await req.formData()).get('file');
    cow.onCleanup(async()=>writeFile(__dirname+'/_cleanup.bin',await file.bytes())); echo('done'); ?>`)
  assert.equal(Buffer.from((await f.request('/cleanup')).response.body).toString(), 'done')
  assert.deepEqual([...(await readFile(join(f.root, '_cleanup.bin')))], [0, 255, 13, 10, 42])
})

test('cancellation after parsing uploads leaves no spool files and a replacement worker stays usable', async t => {
  // A page that never yields cannot see the cancellation; its execution
  // timeout replaces the worker.
  const f = await site(t, { timeout: 1500 })
  await writeFile(join(f.root, 'cancel.jsp'), `<?js
    import {writeFileSync} from 'node:fs'; await req.formData(); writeFileSync(__dirname+'/_parsed','yes');
    while(true) {} ?>`)
  const input = await encoded(), controller = new AbortController()
  const pending = f.app.execute({ url: '/cancel', method: 'POST', headers: { 'content-type': input.contentType }, body: input.body }, { signal: controller.signal })
  const rejected = assert.rejects(pending, { code: 'COW_REQUEST_CANCELLED' })
  const deadline = Date.now() + 8000
  while (!(await readFile(join(f.root, '_parsed')).catch(() => null)) && Date.now() < deadline) await delay(20)
  assert.equal(await readFile(join(f.root, '_parsed'), 'utf8'), 'yes')
  controller.abort()
  await rejected
  assert.equal((await f.request()).response.status, 200)
  assert.deepEqual((await readdir(f.root)).sort(), ['_parsed', 'cancel.jsp', 'index.jsp'])
})

test('execution timeout and worker exit discard unsaved uploads without replaying the request', async t => {
  const f = await site(t, { timeout: 1500 })
  await writeFile(join(f.root, 'timeout.jsp'), '<?js await req.formData(); while(true) {} ?>')
  await writeFile(join(f.root, 'exit.jsp'), '<?js await req.formData(); process.exit(7); ?>')
  await assert.rejects(f.request('/timeout'), { code: 'COW_EXECUTION_TIMEOUT' })
  assert.equal((await f.request()).response.status, 200)
  await assert.rejects(f.request('/exit'), /worker exited with code 7/)
  assert.equal((await f.request()).response.status, 200)
  assert.deepEqual((await readdir(f.root)).sort(), ['exit.jsp', 'index.jsp', 'timeout.jsp'])
})

test('upload form iteration works inside the VM and returned data cannot mutate a subsequent request', async t => {
  const f = await site(t)
  await writeFile(join(f.root, 'iterate.jsp'), `<?js
    const values=await req.formData(); const file=values.get('file'); const before=file.name;
    const names=[...values].map(([name])=>name); const keys=[...values.keys()];
    try { file.name='changed' } catch {} const all=values.getAll('file'); all.length=0;
    res.json({names,keys,before,after:file.name,count:values.getAll('file').length}); ?>`)
  for(let n=0;n<2;n++) {
    const r=await f.request('/iterate')
    assert.deepEqual(JSON.parse(Buffer.from(r.response.body)), {names:['title','file'],keys:['title','file'],before:'sample.bin',after:'sample.bin',count:1})
  }
})
