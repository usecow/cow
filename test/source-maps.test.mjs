import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
const errorColumn = globalThis.Bun ? 18 : 9

async function fixture(t, cache=true) {
  const root=await mkdtemp(join(tmpdir(),'cow source maps-'))
  const app=new CowApp({rootDir:root,workers:1,cache,maxRequestsPerWorker:0})
  t.after(async()=>{try {await app.close()} finally {await rm(root,{recursive:true,force:true})}})
  await app.initialize()
  return {root,app,async write(name,source) {const file=join(root,name);await mkdir(dirname(file),{recursive:true});await writeFile(file,source)},
    async page(source) {await writeFile(join(root,'index.jsp'),'<?js '+source+' ?>');app.dispatcher.compiler.clear();return app.execute({url:'/'})}}
}

const helper = [
  'interface Removed {',
  '  value: number',
  '}',
  'type RemovedToo = Removed | undefined',
  '',
  'export function fail(): never {',
  '  throw new Error("typed helper failure")',
  '}'
].join('\r\n')

test('imported TS runtime frames map static/dynamic/extensionless/URL-variant imports to original source',async t=>{
  const f=await fixture(t)
  await f.write('_hé lper.ts',helper)
  for(const source of [
    `import {fail} from './_hé lper.ts'; fail();`,
    `const {fail}=await import('./_hé lper.ts'); fail();`,
    `const {fail}=await import('./_hé lper'); fail();`,
    `const {fail}=await import('./_hé lper.ts?one=1#part'); fail();`,
    `const {fail}=await import('./_hé lper.ts?bad=%&utf8=%ff'); fail();`
  ]) await assert.rejects(f.page(source),error=>{
    assert.ok(error.stack.includes(join(f.root,'_hé lper.ts')+`:7:${errorColumn}`),error.stack)
    assert.ok(error.stack.includes('index.jsp:1:'),error.stack)
    return true
  })
})

test('imported TS maps cover package exports, included TSP and CommonJS dynamic imports',async t=>{
  const f=await fixture(t)
  await f.write('node_modules/typed-package/package.json',JSON.stringify({name:'typed-package',type:'module',exports:'./index.ts'}))
  await f.write('node_modules/typed-package/index.ts',helper)
  await f.write('_child.tsp',`<?ts import {fail} from 'typed-package'; fail(); ?>`)
  await f.write('_bridge.cjs',`module.exports=async()=>{const {fail}=await import('typed-package');fail()}`)
  for(const source of [`import {fail} from 'typed-package'; fail();`,`await include('./_child.tsp');`,`import fail from './_bridge.cjs'; await fail();`]) {
    await assert.rejects(f.page(source),error=>{
      assert.ok(error.stack.includes(join(f.root,'node_modules/typed-package/index.ts')+`:7:${errorColumn}`),error.stack)
      return true
    })
  }
})

test('imported TS maps refresh after helper edits even with compiler caching and worker reuse',async t=>{
  for(const cache of [true,false]) {
    const f=await fixture(t,cache)
    await f.write('_helper.ts',helper)
    await assert.rejects(f.page(`import {fail} from './_helper.ts';fail()`),error=>error.stack.includes(`_helper.ts:7:${errorColumn}`))
    await f.write('_helper.ts','\n\n'+helper)
    await assert.rejects(f.page(`import {fail} from './_helper.ts';fail()`),error=>error.stack.includes(`_helper.ts:9:${errorColumn}`))
    assert.equal(f.app.runtime.status().workersSpawned,1)
  }
})

test('imported TS async errors and aggregate causes retain original locations after cleanup',async t=>{
  const f=await fixture(t)
  await f.write('_helper.ts',helper.replace('export function fail(): never','export async function fail(): Promise<never>'))
  await assert.rejects(f.page(`import {fail} from './_helper.ts';fail();res.json('wrong success');`),error=>{
    assert.equal(error.code,'COW_UNHANDLED_REJECTION')
    assert.ok(error.errors.some(cause=>cause.stack.includes(`_helper.ts:7:${errorColumn}`)))
    return true
  })
  await f.write('_top.ts','type Removed = {\n value: number\n}\n\nawait Promise.resolve();\nthrow new Error("top level");')
  await assert.rejects(f.page(`import './_top.ts';`), error => {
    // Bun 1.4.2 reports an internal rejected TLA promise in addition to the
    // awaited module evaluation. Preserve the mapped primary cause, and keep
    // this conservative extra failure visible rather than filtering by reason.
    if (globalThis.Bun) {
      assert.equal(error.errors[1].code, 'COW_UNHANDLED_REJECTION')
      return error.cause.stack.includes('_top.ts:6:16')
    }
    return error.stack.includes('_top.ts:6:7')
  })
  const recover = () => f.page(`try { await import('./_top.ts') } catch {} echo('caught')`)
  assert.equal(Buffer.from((await recover()).response.body).toString(), 'caught')
})
