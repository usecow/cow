import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cow-imports-'))
  const app = new CowApp({ rootDir: root, workers: 1 })
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }) })
  const write = async (name, text) => { const file = join(root, name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, text) }
  await write('package.json', JSON.stringify({ name: 'local-site', type: 'module', imports: { '#native': 'matrix-esm', '#local': './_native-alias.mjs' } }))
  await write('_native-alias.mjs', 'let n=0; export const next=()=>++n;')
  await write('node_modules/matrix-esm/package.json', JSON.stringify({ name: 'matrix-esm', type: 'module', exports: {
    '.': { import: './index.mjs', require: './require.cjs' }, './feature/*': './features/*.mjs', './data': './data.json'
  } }))
  await write('node_modules/matrix-esm/index.mjs', 'let n=0; export const next=()=>++n; export const mode="import";')
  await write('node_modules/matrix-esm/features/one.mjs', 'export default "feature";')
  await write('node_modules/matrix-esm/private.mjs', 'export default "private";')
  await write('node_modules/matrix-esm/data.json', '{"answer":42}')
  await write('node_modules/matrix-cjs/package.json', JSON.stringify({ name: 'matrix-cjs', main: './index.cjs' }))
  await write('node_modules/matrix-cjs/index.cjs', 'let n=0; exports.next=()=>++n; exports.label="cjs";')
  await app.initialize()
  return { root, app, write, async page(source) {
    await write('index.jsp', `<?js ${source} ?>`)
    app.dispatcher.compiler.clear()
    const result = await app.execute({ url: '/' })
    return JSON.parse(Buffer.from(result.response.body).toString())
  } }
}

test('package export conditions/patterns, CJS interop and aliases share the request lifetime', async t => {
  const f = await fixture(t)
  const source = `
    import * as esm from 'matrix-esm'; import cjs, { label } from 'matrix-cjs';
    import feature from 'matrix-esm/feature/one';
    const alias = await import('#native'); const localAlias = await import('#local');
    let blocked; try { await import('matrix-esm/private.mjs'); } catch(error) { blocked=error.code; }
    res.json({mode:esm.mode, feature, defaultPresent:Object.hasOwn(esm,'default'), alias:alias===esm,
      cjs:label, counts:[esm.next(), cjs.next(), localAlias.next()], blocked});`
  for (let n = 1; n <= 2; n++) assert.deepEqual(await f.page(source), {
    mode: 'import', feature: 'feature', defaultPresent: false, alias: true, cjs: 'cjs', counts: [1,1,1], blocked: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  })
})

test('real paths and directory symlinks share local identity while URL queries/fragments are distinct', async t => {
  const f = await fixture(t)
  await f.write('_helpers/state.mjs', 'let n=0; export const next=()=>++n; export const url=import.meta.url;')
  await symlink(join(f.root, '_helpers'), join(f.root, '_alias'), process.platform === 'win32' ? 'junction' : 'dir')
  const source = `const [a,b,c,d,e]=await Promise.all([
    import('./_helpers/state.mjs'),import('./_alias/state.mjs'),import('./_helpers/state'),
    import('./_helpers/state.mjs?variant=one'),import('./_helpers/state.mjs#two')]);
    res.json({same:a===b && b===c, separate:a!==d && a!==e && d!==e,
      counts:[a.next(),b.next(),c.next(),d.next(),e.next()],query:new URL(d.url).search,hash:new URL(e.url).hash});`
  for (let n=0;n<2;n++) assert.deepEqual(await f.page(source), { same:true, separate:true, counts:[1,2,3,1,1],query:'?variant=one',hash:'#two' })
})

test('local and package JSON support the same optional type attributes', async t => {
  const f = await fixture(t)
  await f.write('_data.json', '{"value":1}')
  const result = await f.page(`
    const plain=await import('./_data.json'); const typed=await import('./_data.json',{with:{type:'json'}});
    let wrong, unknown;
    const packagePlain = await import('matrix-esm/data');
    const external=await import('matrix-esm/data',{with:{type:'json'}});
    try { await import('./_data.json',{with:{type:'css'}}); } catch(e) { wrong=e.code; }
    try { await import('./_data.json',{with:{extra:'value'}}); } catch(e) { unknown=e.code; }
    plain.default.value++; res.json({same:plain===typed && packagePlain===external,value:typed.default.value,external:external.default.answer,wrong,unknown});`)
  assert.deepEqual(result, {same:true,value:2,external:42,wrong:'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED',unknown:'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED'})
  // Static attributes have one pinned parser baseline in pages and TS helpers.
  await f.write('_json.mjs', `import data from './_data.json' with { type: 'json' }; export default data;`)
  assert.deepEqual(await f.page(`import data from './_json.mjs'; res.json(data);`), {value:1})
})

test('a UTF-8 BOM in package.json or a JSON module does not fail requests', async t => {
  const f = await fixture(t)
  // Windows editors and PowerShell write BOMs; Node tolerates them in both.
  await f.write('package.json', '﻿' + JSON.stringify({ name: 'local-site', type: 'module' }))
  await f.write('_bom.json', '﻿{"value":7}')
  const result = await f.page(`
    const typed = await import('./_bom.json', {with:{type:'json'}});
    const plain = await import('./_bom.json');
    res.json({ value: typed.default.value, same: typed === plain });`)
  assert.deepEqual(result, { value: 7, same: true })
})

test('ordinary package scalar exports remain live within each request', async t => {
  const f = await fixture(t)
  await f.write('node_modules/matrix-esm/features/live.mjs', 'export let count=0; export const increment=()=>++count;')
  const source = `import * as native from 'matrix-esm/feature/live'; const before=native.count; native.increment(); res.json([before,native.count]);`
  assert.deepEqual(await f.page(source), [0,1])
  assert.deepEqual(await f.page(source), [0,1])
})

test('local TS resolution is explicit or extensionless, not tsconfig aliases or .js substitution', async t => {
  const f = await fixture(t)
  await f.write('_typed.ts', 'export const value: number = 7;')
  await f.write('_directory/index.ts', 'export const value: string = "index";')
  await f.write('tsconfig.json', '{"compilerOptions":{"baseUrl":".","paths":{"@local/*":["*"]}}}')
  assert.deepEqual(await f.page(`
    const [a,b,c]=await Promise.all([import('./_typed.ts'),import('./_typed'),import('./_directory')]);
    const missing=await Promise.allSettled([import('./_typed.js'),import('@local/_typed')]);
    res.json({same:a===b,values:[a.value,c.value],missing:missing.every(x=>x.status==='rejected')});`),
  {same:true,values:[7,'index'],missing:true})
})

test('local CommonJS is request-scoped and unsupported URL loaders fail explicitly', async t => {
  const f = await fixture(t)
  await f.write('_legacy.cjs', 'module.exports={value:1};')
  const result = await f.page(`
    const results=[]; for(const name of ['./_legacy.cjs','data:text/javascript,export default 1','https://example.invalid/module.mjs']) {
      try { results.push((await import(name)).default.value); } catch(e) { results.push(e.code); }
    } res.json(results);`)
  assert.deepEqual(result, [1,'COW_MODULE_URL_UNSUPPORTED','COW_MODULE_URL_UNSUPPORTED'])
})
