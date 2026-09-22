import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
import { parserVersion } from '../lib/syntax.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-language-'))
  const app = new CowApp({ rootDir: root, workers: 1, maxRequestsPerWorker: 0, ...options })
  t.after(async () => { await app.close().catch(() => {}); await rm(root, { recursive: true, force: true }) })
  const write = async (name, text) => { const path = join(root, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
  await write('package.json', JSON.stringify({ name:'request-site', type:'module', imports:{'#state':'./_state.mjs','#pkg':'state-esm'} }))
  await write('_state.mjs', 'export let count=0; export const next=()=>++count;')
  await write('node_modules/state-esm/package.json', JSON.stringify({ name:'state-esm',type:'module',exports:'./index.mjs' }))
  await write('node_modules/state-esm/index.mjs', 'export { next, count } from "./state.mjs";')
  await write('node_modules/state-esm/state.mjs', 'export let count=0; export const next=()=>++count;')
  await write('node_modules/state-cjs/package.json', JSON.stringify({ name:'state-cjs',main:'index.cjs' }))
  await write('node_modules/state-cjs/index.cjs', 'module.exports=require("./state.cjs");')
  await write('node_modules/state-cjs/state.cjs', 'let count=0; exports.next=()=>++count;')
  await app.initialize()
  return {root,app,write,async request(path='/') {const r=await app.execute({url:path});return JSON.parse(Buffer.from(r.response.body).toString())} }
}

async function waitFor(check) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (check()) return
    await delay(5)
  }
  assert.fail('Timed out waiting for request state')
}

test('already-aborted requests return Cow cancellation without admitting or executing work', async t => {
  const f = await fixture(t)
  await f.write('index.cow', 'healthy')
  for (const reason of [undefined, new Error('cancelled by caller'), 'stop', null, { code: 'COW_REQUEST_CANCELLED' }]) {
    const controller = new AbortController()
    controller.abort(reason)
    await assert.rejects(f.app.execute({ url: '/' }, { signal: controller.signal }), {
      code: 'COW_REQUEST_CANCELLED', status: 499
    })
    assert.equal(f.app.dispatcher.status().admittedRequests, 0)
  }
  assert.equal(f.app.compilerRuntime.status().requestsAccepted, 0)
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
})

test('cancellation during route resolution skips compilation and site error handlers', async t => {
  const f = await fixture(t)
  await f.write('index.cow', 'healthy')
  await f.write('_error.cow', '<?js throw new Error("must not execute"); ?>')
  const controller = new AbortController()
  const router = f.app.dispatcher.router
  const resolve = router.resolve.bind(router)
  router.resolve = async (...args) => {
    const route = await resolve(...args)
    controller.abort(new Error('route cancellation'))
    return route
  }
  await assert.rejects(f.app.execute({ url: '/' }, { signal: controller.signal }), {
    code: 'COW_REQUEST_CANCELLED', status: 499
  })
  assert.equal(f.app.compilerRuntime.status().requestsAccepted, 0)
  assert.equal(f.app.runtime.status().requestsAccepted, 0)
  assert.equal(f.app.dispatcher.status().admittedRequests, 0)
})

test('Cow request contract: local, alias, ESM and CJS dependency graphs reset without recycling workers', async t => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js
    import * as local from './_state.mjs'; import * as alias from '#state';
    import * as pkg from 'state-esm'; import * as pkgAlias from '#pkg';
    import cjs from 'state-cjs';
    res.json({same:local===alias && pkg===pkgAlias,counts:[local.next(),alias.next(),pkg.next(),pkgAlias.next(),cjs.next()],live:pkg.count});
  ?>`)
  for(let n=0;n<4;n++) assert.deepEqual(await f.request(),{same:true,counts:[1,2,1,2,1],live:2})
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('Cow request contract: failure cannot carry package state into another request, with or without compiler caching', async t => {
  for(const cache of [true,false]) {
    const f=await fixture(t,{cache})
    await f.write('bad.jsp', `<?js import {next} from 'state-esm'; next(); process.env.COW_REQUEST_PROBE='bad'; throw new Error('expected'); ?>`)
    await f.write('index.jsp', `<?js import {next} from 'state-esm'; res.json({count:next(),env:process.env.COW_REQUEST_PROBE || null}); ?>`)
    await assert.rejects(f.app.execute({url:'/bad'}),/expected/)
    assert.deepEqual(await f.request(),{count:1,env:null})
    assert.equal(f.app.runtime.status().workersSpawned,1)
  }
})

test('Cow request contract: process state, shared constructors and built-in namespaces do not leak mutations', async t => {
  const f=await fixture(t)
  await f.write('index.jsp', `<?js
    import path from 'node:path'; import proc from 'node:process'; import { Buffer as ImportedBuffer } from 'node:buffer';
    const before=[process.env.COW_REQUEST_PROBE || null, process.requestProbe || null, ArrayBuffer.prototype.requestProbe || null,
      Buffer.prototype.requestProbe || null, path.requestProbe || null];
    process.env.COW_REQUEST_PROBE='changed'; process.requestProbe='changed'; ArrayBuffer.prototype.requestProbe='changed';
    for(const object of [Buffer.prototype,path]) {try {object.requestProbe='changed';} catch {}}
    res.json({before,processSame:proc===process,bufferSame:ImportedBuffer===Buffer});
  ?>`)
  for(let n=0;n<3;n++) assert.deepEqual(await f.request(),{before:[null,null,null,null,null],processSame:true,bufferSame:true})
})

test('Cow request contract: imported timers cannot run application callbacks after a response', async t => {
  const f=await fixture(t)
  await f.write('old.jsp', `<?js import {setTimeout} from 'node:timers'; import {writeFileSync} from 'node:fs';
    setTimeout(()=>writeFileSync(__dirname+'/_late','bad'),80); res.json('old'); ?>`)
  await f.write('index.jsp', `<?js await new Promise(r=>setTimeout(r,150)); res.json('next'); ?>`)
  assert.equal(await f.request('/old'),'old')
  assert.equal(await f.request(),'next')
  await assert.rejects(readFile(join(f.root,'_late')),{code:'ENOENT'})
})

test('Cow request contract: package evaluation failure is request-local and live ESM exports remain live', async t => {
  const f=await fixture(t)
  await f.write('node_modules/state-esm/failure.mjs', 'globalThis.failures=(globalThis.failures||0)+1; throw new Error("failure");')
  await f.write('index.jsp', `<?js
    const name='./node_modules/state-esm/failure.mjs'; const results=await Promise.allSettled([import(name),import(name)]);
    res.json({count:globalThis.failures,same:results[0].reason===results[1].reason}); ?>`)
  for(let n=0;n<3;n++) assert.deepEqual(await f.request(),{count:1,same:true})
})

test('Cow request contract: accepted filesystem work drains and aborted requests never replay', async t => {
  const f=await fixture(t)
  await f.write('old.jsp', `<?js import {writeFile} from 'node:fs/promises'; writeFile(__dirname+'/_done','done'); throw new Error('render failed'); ?>`)
  await assert.rejects(f.app.execute({url:'/old'}),/render failed/)
  assert.equal(await readFile(join(f.root,'_done'),'utf8'),'done')
  await f.write('slow.jsp', `<?js import {next} from 'state-esm'; next(); await new Promise(r=>setTimeout(r,1000)); ?>`)
  const controller=new AbortController()
  const pending=f.app.execute({url:'/slow'},{signal:controller.signal})
  const rejected=assert.rejects(pending,{code:'COW_REQUEST_CANCELLED'})
  await waitFor(() => f.app.runtime.status().busyWorkers === 1)
  controller.abort(); await rejected
  await f.write('index.jsp', `<?js import {next} from 'state-esm'; res.json(next()); ?>`)
  assert.equal(await f.request(),1)
})

test('Cow request contract: CommonJS cycles, require conditions, dynamic imports and failed loads stay in the request', async t => {
  const f = await fixture(t)
  await f.write('node_modules/conditional/package.json', JSON.stringify({name:'conditional',exports:{import:'./esm.mjs',require:'./cjs.cjs'}}))
  await f.write('node_modules/conditional/esm.mjs', 'export default "esm";')
  await f.write('node_modules/conditional/cjs.cjs', 'module.exports="cjs";')
  await f.write('_a.cjs', 'exports.name="a"; exports.b=require("./_b.cjs").name; exports.condition=require("conditional"); exports.dynamic=()=>import("state-esm");')
  await f.write('_b.cjs', 'exports.name="b"; exports.a=require("./_a.cjs").name;')
  await f.write('_bad.cjs', 'globalThis.failures=(globalThis.failures||0)+1; throw null;')
  await f.write('_root.cjs', 'let failures=0; for(let n=0;n<2;n++) {try {require("./_bad.cjs")} catch(e) {if(e===null) failures++}} module.exports={failures,a:require("./_a.cjs"),b:require("./_b.cjs")};')
  await f.write('index.jsp', `<?js import root from './_root.cjs'; import condition from 'conditional'; import * as direct from 'state-esm';
    const dynamic=await root.a.dynamic(); res.json({a:root.a.name,b:root.a.b,cycle:root.b.a,conditions:[condition,root.a.condition],
      failures:[root.failures,globalThis.failures],same:dynamic===direct,count:dynamic.next()}); ?>`)
  for(let n=0;n<3;n++) assert.deepEqual(await f.request(),{a:'a',b:'b',cycle:'a',conditions:['esm','cjs'],failures:[2,1],same:true,count:1})
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('Cow request contract: only declared native entries persist and retained adapter callbacks cannot enter a later request', async t => {
  const f = await fixture(t)
  await f.write('node_modules/driver/package.json', JSON.stringify({name:'driver',type:'module',exports:'./index.mjs',cow:{native:['./index.mjs']}}))
  await f.write('node_modules/driver/index.mjs', 'let count=0; export const next=()=>++count; export function retain(cb) {setTimeout(cb,100)}')
  await f.write('old.jsp', `<?js import {next,retain} from 'driver'; import {writeFileSync} from 'node:fs'; retain(()=>writeFileSync(__dirname+'/_late-adapter','bad')); res.json(next()); ?>`)
  await f.write('index.jsp', `<?js import {next} from 'driver'; await new Promise(r=>setTimeout(r,180)); res.json(next()); ?>`)
  assert.equal(await f.request('/old'),1)
  assert.equal(await f.request(),2)
  await assert.rejects(readFile(join(f.root,'_late-adapter')),{code:'ENOENT'})
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('Cow request contract: process escape APIs and page-level resource definitions are unavailable', async t => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js
    const codes=[]; for(const name of ['node:module','node:vm','node:worker_threads','node:sqlite','node:http','node:child_process']) {
      try {await import(name)} catch(e) {codes.push(e.code)}
    }
    const {defineResource}=await import(${JSON.stringify(new URL('../lib/resource.mjs', import.meta.url).href)});
    try {defineResource({})} catch(e) {codes.push(e.code)}
    res.json({codes,escape:[process.binding,process.getBuiltinModule,process.dlopen,process.on,process.chdir].every(x=>x===undefined)}); ?>`)
  assert.deepEqual(await f.request(),{codes:[...Array(6).fill('COW_NATIVE_API_UNSUPPORTED'),'COW_RESOURCE_DEFINITION_SCOPE'],escape:true})
})

test('Cow request contract: returned data has request-owned prototypes and binary values remain usable', async t => {
  const f = await fixture(t)
  await f.write('index.jsp', `<?js
    import path from 'node:path'; import {URL as U} from 'node:url'; import {randomBytes} from 'node:crypto';
    const params=req.params(), body=req.body(), bytes=Buffer.from([1,2]);
    const before=[Object.getPrototypeOf(body).probe || null,Object.getPrototypeOf(params).probe || null,URL.prototype.probe || null];
    for(const object of [Object.getPrototypeOf(body),Object.getPrototypeOf(params),URL.prototype,TextEncoder.prototype,path.join]) {try {object.probe='bad'} catch {}}
    const data=path.parse('/folder/file.txt'); Object.freeze(data);
    bytes[0]=9; res.json({before,view:ArrayBuffer.isView(bytes),type:bytes instanceof Uint8Array,isBuffer:Buffer.isBuffer(bytes),
      text:bytes.toString('hex'),urlSame:U===URL,random:randomBytes(3).length,frozen:Object.isFrozen(params),base:data.base}); ?>`)
  for(let n=0;n<3;n++) assert.deepEqual(await f.request(),{before:[null,null,null],view:true,type:true,isBuffer:true,text:'0902',urlSame:true,random:3,frozen:true,base:'file.txt'})
  await f.write('binary.jsp', '<?js const bytes=new Uint8Array([3,4]); res.send(bytes.buffer); ?>')
  const result=await f.app.execute({url:'/binary'})
  assert.deepEqual([...result.response.body],[3,4])
})

test('Cow request contract: filesystem callbacks and native promise continuations drain even on failure', async t => {
  const f = await fixture(t)
  await f.write('old.jsp', `<?js import {writeFile,appendFile} from 'node:fs'; import {setTimeout as delay} from 'node:timers/promises';
    writeFile(__dirname+'/_callback','first',()=>appendFile(__dirname+'/_callback',' second',()=>{}));
    delay(120).then(()=>import('node:fs/promises')).catch(()=>{});
    throw new Error('expected failure'); ?>`)
  await assert.rejects(f.app.execute({url:'/old'}),/expected failure/)
  assert.equal(await readFile(join(f.root,'_callback'),'utf8'),'first second')
  await f.write('async-error.jsp', `<?js setTimeout(async()=>{throw new Error('timer failed')},5); await new Promise(r=>setTimeout(r,30)); ?>`)
  await assert.rejects(f.app.execute({url:'/async-error'}),/asynchronous callback failed/)
  await f.write('index.jsp','<?js res.json("healthy"); ?>')
  assert.equal(await f.request(),'healthy')
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('Cow syntax contract: pinned parser accepts static attributes and reports imported TS syntax locations', async t => {
  assert.equal(parserVersion,'5.9.3')
  assert.equal(JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).dependencies.typescript,parserVersion)
  const f = await fixture(t)
  await f.write('_data.json','{"value":42}')
  await f.write('_typed.ts','import data from "./_data.json" with { type: "json" }; export const value: number = data.value;')
  await f.write('index.tsp','<?ts import data from "./_data.json" with {type:"json"}; import {value} from "./_typed.ts"; res.json([data.value,value]); ?>')
  assert.deepEqual(await f.request(),[42,42])
  await f.write('_broken.ts','export const value: number = ;')
  await f.write('broken.jsp','<?js import "./_broken.ts"; ?>')
  await assert.rejects(f.app.execute({url:'/broken'}),error=>error.code==='COW_MODULE_SYNTAX' && /_broken.ts:1:/.test(error.message))
})

test('Cow request contract: loader errors and CommonJS/global helpers cannot expose shared function prototypes', async t => {
  const f = await fixture(t)
  await f.write('_require.cjs','module.exports=require.constructor.prototype.probe || null; try { require.constructor.prototype.probe="local" } catch {}')
  await f.write('index.jsp', `<?js
    const before=Function.prototype.probe || null;
    const cjs=(await import('./_require.cjs')).default;
    let errorBefore; try {await import('./_missing.mjs')} catch(e) {
      errorBefore=e.constructor.prototype.probe || null; try {e.constructor.prototype.probe='changed'} catch {}
    }
    try {ArrayBuffer.isView.constructor.prototype.probe='another'} catch {}
    res.json({before,cjs,errorBefore,text:h({})}); ?>`)
  for(let n=0;n<3;n++) assert.deepEqual(await f.request(),{before:null,cjs:null,errorBefore:null,text:'[object Object]'})
})
