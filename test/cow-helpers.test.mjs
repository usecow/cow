import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
import { checkPath } from '../lib/check.mjs'
// V8 points at `new`; JavaScriptCore points at the Error call. Both map back to
// the original expression, not the generated TypeScript output.
const errorColumn = globalThis.Bun ? 18 : 9

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-helpers-'))
  const app = new CowApp({ rootDir: root, port: 0, workers: 1, maxRequestsPerWorker: 0, logger: { error() {} }, ...options })
  t.after(async () => { try { await app.close() } finally { await rm(root, { recursive: true, force: true }) } })
  const { url } = await app.start()
  return { root, app, url, async put(name, source) {
    const file = join(root, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source)
    return file
  }, async run(source) {
    await writeFile(join(root, 'index.cow'), '<?js ' + source)
    return (await app.execute({ url: '/' })).response
  } }
}

test('bundled helpers work in a plain directory with request-local state and persistent sessions', async t => {
  const f = await fixture(t)
  await f.put('_helpers.cow', '<?js export * from "@cowlang/cow/web";')
  await f.put('_bridge.cjs', 'module.exports=()=>import("@cowlang/cow/web")')
  await f.put('index.cow', `<?js
    import * as web from '@cowlang/cow/web';
    import {session as helperSession} from './_helpers.cow';
    import bridge from './_bridge.cjs';
    import {sqlite} from '@cowlang/cow/sqlite';
    import {defineResource} from '@cowlang/cow/resource';
    import {CsvError,parseCsv} from '@cowlang/cow/csv';
    import * as runtime from '@cowlang/cow/runtime';
    const current=await web.session(await sqlite(__dirname+'/_sessions.sqlite'),req,res,{name:'plain_site'});
    current.update({visits:(current.data.visits||0)+1});
    CsvError.calls=(CsvError.calls||0)+1;
    res.json({visits:current.data.visits,fresh:CsvError.calls,csv:parseCsv('Cow,001'),
      same:web===await import('@cowlang/cow/web') && web===await bridge() && web.session===helperSession,
      resource:typeof defineResource,runtime:Object.keys(runtime)});
  `)
  let cookie = ''
  for (let visits = 1; visits <= 3; visits++) {
    const response = await fetch(f.url, { headers: cookie ? { cookie } : {} })
    assert.equal(response.status, 200, await response.clone().text())
    cookie = response.headers.getSetCookie()[0]?.split(';')[0] || cookie
    assert.match(cookie, /^plain_site=/)
    assert.deepEqual(await response.json(), {
      visits, fresh: 1, csv: [['Cow', '001']], same: true, resource: 'function', runtime: []
    })
  }
  for (const path of ['package.json', 'node_modules']) {
    await assert.rejects(readFile(join(f.root, path)), { code: 'ENOENT' })
  }
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('bundled helper names use the active runtime without exposing its other dependencies', async t => {
  const f = await fixture(t)
  await f.put('node_modules/@cowlang/cow/package.json', JSON.stringify({
    name: '@cowlang/cow', type: 'module', exports: { './web': './wrong.mjs', './sqlite': './wrong.mjs', './resource': './wrong.mjs' }
  }))
  await f.put('node_modules/@cowlang/cow/wrong.mjs', 'throw new Error("local Cow must not shadow runtime helpers")')
  await f.put('node_modules/site-package/package.json', JSON.stringify({ name: 'site-package', exports: './index.cjs' }))
  await f.put('node_modules/site-package/index.cjs', 'module.exports="site dependency"')
  const response = await f.run(`import {escapeHtml} from '@cowlang/cow/web';
    import {sqlite} from '@cowlang/cow/sqlite'; import {defineResource} from '@cowlang/cow/resource';
    import local from 'site-package'; const db=await sqlite(':memory:');
    res.json([escapeHtml('<Cow>'),db.get('SELECT 42 AS value').value,typeof defineResource,local]);`)
  assert.deepEqual(JSON.parse(response.body), ['&lt;Cow&gt;', 42, 'function', 'site dependency'])
  for (const specifier of ['typescript', 'missing-site-package']) {
    await assert.rejects(f.run(`await import(${JSON.stringify(specifier)})`), { code: 'ERR_MODULE_NOT_FOUND' })
  }
  await assert.rejects(f.run('await import("@cowlang/cow/lib/web.mjs")'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
  await assert.rejects(f.run('await import("@cowlang/cow/web",{with:{type:"json"}})'), { code: 'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE' })
})

test('cow: protocol imports are the canonical spelling of the same bundled helpers', async t => {
  const f = await fixture(t)
  const response = await f.run(`import * as protocol from 'cow:web';
    import {sqlite} from 'cow:sqlite'; import {parseCsv} from 'cow:csv';
    import {defineResource} from 'cow:resource'; import * as runtime from 'cow:runtime';
    const db=await sqlite(':memory:');
    res.json({same:protocol===await import('@cowlang/cow/web'),
      value:db.get('SELECT 42 AS value').value,csv:parseCsv('Cow,001'),
      resource:typeof defineResource,runtime:Object.keys(runtime)});`)
  assert.deepEqual(JSON.parse(response.body), { same: true, value: 42, csv: [['Cow', '001']], resource: 'function', runtime: [] })
  await assert.rejects(f.run('await import("cow:missing")'), { code: 'COW_MODULE_UNKNOWN' })
})

test('Cow helpers share tagged JS/TS syntax, live exports and fresh request state', async t => {
  const f = await fixture(t)
  await f.put('_helpers.cow', '\uFEFF\r\n<?js\r\nexport let count: number = 0;\r\nexport const next = () => ++count;\r\n?>\r\n<?ts\r\nexport default await Promise.resolve("?>");\r\nexport const meta = import.meta.url;\r\n?>\r\n')
  await f.put('_part.cow', '<?js import {count,next} from "./_helpers.cow"; echo(count); next();')
  const page = 'import label, {count,next,meta} from "./_helpers.cow"; const other=await import("./_helpers.cow"); echo(label); next(); await include("./_part.cow"); echo(count,other.count,meta.endsWith("/_helpers.cow"));'
  for (let i = 0; i < 3; i++) assert.equal((await f.run(page)).body.toString(), '?>12 2 true')
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('Cow helper resolution covers extensionless/directory imports, aliases, packages, cycles and URL identity', async t => {
  const f = await fixture(t)
  await f.put('package.json', JSON.stringify({ type: 'module', imports: { '#helpers': './_helpers.cow' } }))
  await f.put('_helpers.cow', '<?js export let count = 0; export const next = () => ++count;')
  await f.put('_helpers.mjs', 'throw new Error("Cow must take precedence")')
  await f.put('_lib/index.cow', '<?ts export {count,next} from "../_helpers.cow";')
  await f.put('node_modules/cow-helper/package.json', JSON.stringify({ name: 'cow-helper', exports: './index.cow' }))
  await f.put('node_modules/cow-helper/index.cow', '<?js export const value: number = 42;')
  await f.put('_a.cow', '<?js import {other} from "./_b.cow"; export const name="a"; export const pair=()=>name+other();')
  await f.put('_b.cow', '<?ts import {name} from "./_a.cow"; export const other=()=>name+"b";')
  await f.put('_bridge.cjs', 'module.exports=()=>import("./_helpers.cow")')
  const response = await f.run(`import * as a from './_helpers.cow'; import * as b from '#helpers';
    import * as c from './_helpers'; import * as d from './_lib'; import {value} from 'cow-helper';
    import {pair} from './_a.cow'; import bridge from './_bridge.cjs';
    const [x,y]=await Promise.all([import('./_helpers.cow'),import('./_helpers.cow')]);
    const separate=await import('./_helpers.cow?variant#part'); a.next();
    res.json([a===b,a===c,a===x,x===y,a===await bridge(),d.count,separate.count,value,pair()]);`)
  assert.deepEqual(JSON.parse(response.body), [true, true, true, true, true, 1, 0, 42, 'aab'])
  await f.put('_require.cjs', 'module.exports=require("./_helpers.cow")')
  await assert.rejects(f.run('import "./_require.cjs";'), { code: 'ERR_REQUIRE_ESM' })
})

test('Cow helpers reload without restarting, including original CRLF/Unicode runtime error locations', async t => {
  for (const cache of [true, false]) {
    const f = await fixture(t, { cache })
    const helper = '\r\n<?ts\r\ninterface Removed { value: number }\r\nexport const value: number = 1;\r\nexport function fail(): never {\r\n  throw new Error("helper failure");\r\n}\r\n'
    await f.put('_hé lper.cow', helper)
    assert.equal((await f.run('import {value} from "./_hé lper.cow"; echo(value)')).body.toString(), '1')
    await assert.rejects(f.run('const {fail}=await import("./_hé lper.cow?one#part"); fail();'), e => {
      assert.ok(e.stack.includes(`_hé lper.cow:6:${errorColumn}`), e.stack)
      return true
    })
    await f.put('_hé lper.cow', '\r\n\r\n' + helper.replace('number = 1', 'number = 27'))
    assert.equal((await f.run('import {value} from "./_hé lper.cow"; echo(value)')).body.toString(), '27')
    await f.put('_part.cow', '<?js import {fail} from "./_hé lper.cow"; fail();')
    await assert.rejects(f.run('await include("./_part.cow")'), e => e.stack.includes(`_hé lper.cow:8:${errorColumn}`))
    assert.equal(f.app.runtime.status().workersSpawned, 1)
  }
})

test('Cow helper imports reject HTML, echo blocks and untagged code instead of emitting or discarding it', async t => {
  const f = await fixture(t)
  for (const source of ['<p>private text</p><?js export const x=1;', '<?js export const x=1; ?><?= x ?>', 'export const x = 1;']) {
    await f.put('_bad.cow', source)
    await assert.rejects(f.run('import "./_bad.cow"; echo("wrong success")'), { code: 'COW_MODULE_OUTPUT' })
  }
  // Modules receive explicit request/response arguments, not an entry-page global.
  await f.put('_explicit.cow', '<?js export const greet=(req,res)=>res.json(req.get("name")); export const scope=[typeof req,typeof locals,typeof include];')
  assert.deepEqual(JSON.parse((await f.run('import {scope} from "./_explicit.cow"; res.json(scope)')).body), ['undefined','undefined','undefined'])
  await f.put('index.cow', '<?js import {greet} from "./_explicit.cow"; greet(req,res);')
  assert.equal(JSON.parse((await f.app.execute({ url: '/?name=Cow' })).response.body), 'Cow')
})

test('Cow helper syntax checks preserve locations, exports and non-execution without depending on private filenames', async t => {
  const f = await fixture(t)
  const marker = JSON.stringify(join(f.root, '_must-not-exist'))
  await f.put('helpers.cow', `<?ts import {writeFileSync} from 'node:fs'; export default 1; writeFileSync(${marker},'wrong');`)
  await f.put('_types.cow', '<?ts export interface Options { n: number }; export type Name = string;')
  await f.put('_page.cow', '<?js return; ?>unreached')
  const good = await checkPath(f.root)
  assert.equal(good.exitCode, 0, JSON.stringify(good.errors))
  assert.equal(good.checked, 3)
  await assert.rejects(readFile(join(f.root, '_must-not-exist')), { code: 'ENOENT' })
  const bad = await f.put('_bad.cow', '\r\n<?ts\r\nexport const broken: number = ;')
  const checked = await checkPath(bad)
  assert.equal(checked.exitCode, 1)
  assert.equal(checked.errors[0].line, 3)
  await assert.rejects(f.run('import "./_bad.cow"'), e => e.message.includes('_bad.cow:3:'))
  const duplicate = await f.put('_duplicate.cow', '<?ts\r\nexport const x: number=1;\r\nexport const x: number=2;')
  const early = await checkPath(duplicate)
  assert.equal(early.exitCode, 1)
  assert.equal(early.errors[0].line, 3)
  assert.match(early.errors[0].message, /already been declared/)
})

test('Cow helper private paths and directories are denied over HTTP while imports work', async t => {
  const f = await fixture(t)
  await f.put('_helpers.cow', '<?js export const secret="not public";')
  await f.put('_lib/helpers.cow', '<?ts export {secret} from "../_helpers.cow";')
  await f.put('index.cow', '<?js import {secret} from "./_lib/helpers.cow"; echo(secret.length);')
  assert.equal(await (await fetch(f.url)).text(), '10')
  for (const path of ['/_helpers', '/_helpers.cow', '/%5fhelpers', '/%5Fhelpers%2Ecow', '/_lib/helpers', '/_lib/helpers.cow', '/%5flib/helpers']) {
    const response = await fetch(f.url + path)
    assert.equal(response.status, 404, path)
    assert.ok(!(await response.text()).includes('not public'))
  }
})

test('Cow helper failures stay request-owned, async work drains, and source limits still apply', async t => {
  const f = await fixture(t, { sourceLimit: 1024 })
  await f.put('_async.cow', '<?ts import {writeFile} from "node:fs/promises"; export const done=writeFile(new URL("./_done",import.meta.url),"done"); throw new Error("failed import");')
  await assert.rejects(f.run('import "./_async.cow"'), /failed import/)
  assert.equal(await readFile(join(f.root, '_done'), 'utf8'), 'done')
  await f.put('_async.cow', '<?js export const done="recovered";')
  assert.equal((await f.run('import {done} from "./_async.cow"; echo(done)')).body.toString(), 'recovered')
  await f.put('_large.cow', '<?js /*' + 'x'.repeat(1100) + '*/ export const n=1;')
  await assert.rejects(f.run('import "./_large.cow"'), { code: 'COW_SOURCE_TOO_LARGE' })
  await f.put('_cause.cow', '<?ts\nexport async function fail(): Promise<never> {\n  throw new Error("async helper");\n}')
  await assert.rejects(f.run('import {fail} from "./_cause.cow"; fail();'), e => {
    assert.equal(e.code, 'COW_UNHANDLED_REJECTION')
    assert.ok(e.errors.some(cause => cause.stack.includes(`_cause.cow:3:${errorColumn}`)))
    return true
  })
})
