import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
import { compileSource, CowCompileError } from '../lib/compiler.mjs'
import { checkPath } from '../lib/check.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-pages-'))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, maxRequestsPerWorker: 0, logger: { error() {} }, ...options })
  t.after(async () => { try { await app.close() } finally { await rm(root, { recursive: true, force: true }) } })
  const url = (await app.start()).url
  return { root, app, get: (path = '/') => fetch(url + path), async put(name, source) {
    const file = join(root, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source)
    // Deliberately do not clear caches or restart workers after a source edit.
  } }
}

test('Cow pages accept existing JS/TS tags in one typed scope and retain lexical/source locations', () => {
  const source = '<h1>Before</h1>\r\n<?js const first = "?>"; ?><?ts const n: number = 2; ?><?= first + n ?>'
  const result = compileSource(source, { filePath: 'page.cow' })
  assert.match(result, /const n = 2/)
  assert.doesNotMatch(result, /n: number/)
  assert.doesNotThrow(() => compileSource('<?js if (true) { ?>text<?ts } ?>', { filePath: 'page.COW' }))
  for (const tag of ['js', 'ts']) {
    assert.doesNotThrow(() => compileSource(`<?${tag} const r = /[?>/]+/; /* ?> */ echo(r.source);`, { filePath: 'page.cow' }))
    assert.throws(() => compileSource(`<p>Title</p>\r\n<?${tag}\r\nconst broken = ;`, { filePath: 'page.cow' }),
      error => error instanceof CowCompileError && error.line === 3 && error.column === 16)
  }
  assert.throws(() => compileSource('<?ts const n: number = 2 ?>', { filePath: 'old.jsp' }), /cannot be used/)
  assert.throws(() => compileSource('<?js echo(1) ?>', { filePath: 'old.tsp' }), /cannot be used/)
})

test('Cow routes take precedence, resolve directories and never serve page source or private includes', async t => {
  const f = await fixture(t)
  await f.put('index.cow', '<?ts const n: number = 7; ?>Cow <?= n ?>')
  await f.put('index.jsp', 'legacy root')
  await f.put('account.cow', '<?js echo("account") ?>')
  await f.put('docs/index.cow', 'docs')
  await f.put('old.jsp', '<?js echo("legacy JS") ?>')
  await f.put('typed.tsp', '<?ts const n: number = 8; echo(n) ?>')
  await f.put('_secret.cow', 'private source')
  await f.put('assets/source.cow', 'server source')
  for (const [path, expected] of [['/', 'Cow 7'], ['/account', 'account'], ['/docs', 'docs'], ['/docs/', 'docs'], ['/old', 'legacy JS'], ['/typed', '8']]) {
    const response = await f.get(path)
    assert.equal(response.status, 200, path)
    assert.equal(await response.text(), expected)
  }
  for (const path of ['/index.cow', '/index.COW', '/account%2ecow', '/_secret', '/_secret.cow', '/assets/source.cow']) {
    assert.equal((await f.get(path)).status, 404, path)
  }
})

test('Cow pages, includes and ordinary helpers update on the next request without restarting', async t => {
  const f = await fixture(t)
  await f.put('_value.mjs', 'let calls=0; export const next=()=>++calls; export const text="first";')
  await f.put('_part.cow', '<?ts const suffix: string = locals.suffix; ?>part<?= suffix ?>')
  await f.put('index.cow', '<?js import {next,text} from "./_value.mjs"; echo(text+next()); await include("./_part.cow", {suffix:"!"}); ?>')
  for (let i = 0; i < 2; i++) assert.equal(await (await f.get()).text(), 'first1part!')
  const spawned = f.app.runtime.status().workersSpawned
  await f.put('_value.mjs', 'let calls=0; export const next=()=>++calls; export const text="changed";')
  await f.put('_part.cow', '<?js echo("updated"+locals.suffix) ?>')
  assert.equal(await (await f.get()).text(), 'changed1updated!')
  await f.put('index.cow', '<?ts import {next,text} from "./_value.mjs"; const suffix: string = "?"; ?>new <?= text + next() ?><?js await include("./_part.cow", {suffix}); ?>')
  assert.equal(await (await f.get()).text(), 'new changed1updated?')
  assert.equal(f.app.runtime.status().workersSpawned, spawned)
})

test('Cow syntax checking is parse-only and runtime failures map to original Cow lines', async t => {
  const f = await fixture(t)
  await f.put('safe.cow', '<?js import "./missing.mjs"; throw new Error("do not execute") ?><?ts const n: number = 1; ?><?= n ?>')
  assert.equal((await checkPath(join(f.root, 'safe.cow'))).exitCode, 0)
  await f.put('_invalid.cow', '<p>Before</p>\r\n<?ts\r\nconst n: number = ;')
  const checked = await checkPath(f.root)
  assert.equal(checked.checked, 2)
  assert.equal(checked.exitCode, 1)
  assert.equal(checked.errors[0].line, 3)
  assert.ok(checked.errors[0].file.endsWith('_invalid.cow'))
  await f.put('_failure.cow', '<p>Before</p>\n<?ts\nconst n: number = 1;\nthrow new Error("cow location");')
  await f.put('index.cow', '<?js await include("./_failure.cow") ?>')
  await assert.rejects(f.app.execute({ url: '/' }), error => error.stack.includes(`_failure.cow:4:${globalThis.Bun ? 16 : 7}`))
})

test('Private _error.cow takes precedence over legacy handlers and preserves error status', async t => {
  const f = await fixture(t, { mode: 'production' })
  await f.put('_error.jsp', 'legacy error')
  await f.put('_error.cow', '<?ts const status: number = locals.error.status; ?>Cow error <?= status ?>')
  await f.put('index.cow', '<?js throw new Error("private detail") ?>')
  for (const [path, status] of [['/', 500], ['/missing', 404], ['/_error.cow', 404]]) {
    const response = await f.get(path)
    assert.equal(response.status, status)
    assert.equal(await response.text(), 'Cow error ' + status)
  }
})

test('Cow lexer expression and cross-block fixes work in requests, includes and mapped errors', async t => {
  const f = await fixture(t)
  await f.put('_number.cow', '<?ts export const n = { valueOf() { ?>\r\n<?js return 10; } } / 2;')
  await f.put('_part.cow', '<?= { valueOf() { return 12; } } / 3 ?>')
  await f.put('index.cow', '<?js import { n } from "./_number.cow"; echo(n); await include("./_part.cow"); const value = {valueOf() { ?>value=<?ts return 10; }} / 2; echo(value); ?>')
  assert.equal((await checkPath(join(f.root, 'index.cow'))).exitCode, 0)
  for (let i = 0; i < 2; i++) {
    const response = await f.get()
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '54value=5')
  }
  await f.put('index.cow', '<?= {valueOf(){return 10}} / 2 ?>\r\n<?js\r\nthrow new Error("lexer source location");')
  await assert.rejects(f.app.execute({ url: '/' }), error => error.stack.includes(`index.cow:3:${globalThis.Bun ? 16 : 7}`))
})

test('<?= ?> escapes by default; h(), raw() and highlight() output prints as-is', async t => {
  const f = await fixture(t)
  const highlightURL = new URL('../lib/highlight.mjs', import.meta.url).href
  await f.put('_markup.cow', `<?js
import { escapeHtml, raw } from 'cow:web'
export const badge = (label) => raw('<b>' + escapeHtml(label) + '</b>')
export const plain = (label) => '<b>' + label + '</b>'
`)
  await f.put('index.cow', `<?js
import { highlight } from ${JSON.stringify(highlightURL)}
import { badge, plain } from './_markup.cow'
const input = req.get('q')
?><p><?= input ?></p><p><?= h(input) ?></p><p><?= raw('<i>trusted</i>') ?></p><p><?= '<i>' + h(input) ?></p><p><?= badge(input) ?></p><p><?= plain('x') ?></p><?= highlight('const n = 1', { code: true }) ?>[<?= null ?><?= undefined ?>]<?js echo('<hr>') ?>`)
  await f.put('echo.cow', `<?= req.get('q') ?>`)
  const body = await (await f.get('/?q=%3Cscript%3E')).text()
  assert.match(body, /^<p>&lt;script&gt;<\/p><p>&lt;script&gt;<\/p>/, 'plain values and h() print escaped once')
  assert.match(body, /<p><i>trusted<\/i><\/p>/, 'raw() prints as-is')
  assert.match(body, /<p>&lt;i&gt;&amp;lt;script&amp;gt;<\/p>/, 'a string built from h() output is escaped again')
  assert.match(body, /<p><b>&lt;script&gt;<\/b><\/p>/, 'raw() from a helper module is trusted')
  assert.match(body, /<p>&lt;b&gt;x&lt;\/b&gt;<\/p>/, 'HTML a helper returns without raw() is escaped')
  assert.match(body, /<span class="cow-/, 'highlight() output prints as-is')
  assert.match(body, /\[\]<hr>$/, 'null and undefined print nothing; echo() stays unescaped')
  // Trust is per request: a string raw() returned earlier is escaped later.
  assert.equal(await (await f.get('/echo?q=' + encodeURIComponent('<i>trusted</i>'))).text(), '&lt;i&gt;trusted&lt;/i&gt;')
})

test('trusted HTML from helpers survives a Cow path typed in a different case', async t => {
  // Only a case-insensitive disk (Windows, default macOS) opens the flipped path.
  const lib = fileURLToPath(new URL('../lib/', import.meta.url))
  const flipped = lib.replace(/[a-z]/gi, c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())
  if (!existsSync(join(flipped, 'app.mjs'))) return t.skip('case-sensitive file system')
  const { CowApp: FlippedApp } = await import(pathToFileURL(join(flipped, 'app.mjs')).href)
  const root = await mkdtemp(join(tmpdir(), 'cow-case-'))
  const app = new FlippedApp({ rootDir: root, workers: 1, logger: { error() {} } })
  t.after(async () => { try { await app.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await writeFile(join(root, '_markup.cow'), "<?js\nimport { raw } from 'cow:web'\nexport const badge = () => raw('<b>ok</b>')\n")
  await writeFile(join(root, 'index.cow'), "<?js import { badge } from './_markup.cow' ?><?= badge() ?>")
  await app.initialize()
  assert.equal(Buffer.from((await app.execute({ url: '/' })).response.body).toString(), '<b>ok</b>')
})
