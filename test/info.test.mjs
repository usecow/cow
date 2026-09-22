import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
import { infoSnapshot, renderInfo } from '../lib/info.mjs'
import { requestBuiltinNames } from '../lib/request-native.mjs'
import { hostRuntime } from '../lib/host-runtime.mjs'

const project=fileURLToPath(new URL('../',import.meta.url))
async function fixture(t,options={}) {
  const root=await mkdtemp(join(tmpdir(),'cow-info-'))
  const app=new CowApp({rootDir:root,port:0,workers:1,maxRequestsPerWorker:0,logger:{error(){}},...options})
  t.after(async()=>{try{await app.close()}finally{await rm(root,{recursive:true,force:true})}})
  const put=async(source,name='index.jsp')=>{await writeFile(join(root,name),source);app.dispatcher?.compiler.clear()}
  await put('<?js cow.info() ?>')
  const url=(await app.start()).url
  return {root,app,put,url,get:(path='/',options)=>fetch(url+path,options)}
}

test('cow.info produces a complete no-store HTML report, ends output and supports HEAD',async t=>{
  const f=await fixture(t)
  await f.put('<?js echo("discard this"); cow.info(); echo("never run"); ?>')
  const r=await f.get(),body=await r.text()
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/html/)
  assert.match(body,/^<!doctype html>/);assert.match(body,/<h1>Cow Version /)
  for(const section of ['Runtime','Effective configuration','Available capabilities','Current request / worker snapshot'])assert.ok(body.includes(section))
  assert.doesNotMatch(body,/discard this|never run|<script|https?:\/\//)
  assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff')
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(r.headers.get('x-robots-tag'),/noindex/)
  const css=body.match(/<style>([\s\S]*?)<\/style>/)[1],hash=createHash('sha256').update(css).digest('base64')
  assert.ok(r.headers.get('content-security-policy').includes(`'sha256-${hash}'`))
  assert.match(r.headers.get('content-security-policy'),/default-src 'none'/)
  const head=await f.get('/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'')
  assert.equal(head.headers.get('content-length'),String(Buffer.byteLength(body)))
})

test('cow.info JSON reports actual effective settings and capabilities without opening resources',async t=>{
  const f=await fixture(t,{mode:'production',timeout:2345,queueTimeout:3456,maxQueue:7,bodyLimit:6543,bodyTimeout:4321,
    outputLimit:55000,bufferLimit:80000,cache:false,cacheEntries:6,cacheBytes:20000,sourceLimit:40000,
    compileTimeout:3500,compiledBufferLimit:90000,resourceLimit:4,adapterLimit:5,namespaceLimit:12})
  await f.put('<?js cow.info({format:"json"}) ?>')
  const r=await f.get(),value=await r.json()
  assert.match(r.headers.get('content-type'),/^application\/json/)
  assert.equal(value.runtime.cow,JSON.parse(await readFile(join(project,'package.json'),'utf8')).version)
  const host=hostRuntime()
  assert.equal(value.runtime.host,host.name);assert.equal(value.runtime.hostVersion,host.version)
  assert.equal(value.runtime.node,host.name==='node' ? process.versions.node : null);assert.equal(value.runtime.typescript,'5.9.3')
  assert.equal(value.runtime.mode,'production');assert.equal(value.runtime.vmModules,true);assert.equal(value.runtime.importMetaResolve,true)
  assert.deepEqual(value.configuration,{workers:1,executionTimeoutMs:2345,queueTimeoutMs:3456,maxQueue:7,maxRequestsPerWorker:0,
    workerHeapLimitMiB:host.workerHeapLimit ? 256 : null,bodyLimitBytes:6543,bodyTimeoutMs:4321,bufferedOutputLimitBytes:55000,aggregateBufferLimitBytes:80000,
    sourceLimitBytes:40000,compileTimeoutMs:3500,compiledBufferLimitBytes:90000,compilerCache:false,compilerCacheEntries:6,compilerCacheBytes:20000,
    nativeResourcesPerWorker:4,nativeAdaptersPerWorker:5,nativeNamespacesPerWorker:12})
  assert.deepEqual(value.capabilities.nodeBuiltins,requestBuiltinNames())
  assert.ok(value.capabilities.helpers.includes('cow:sqlite'));assert.ok(!value.capabilities.nodeBuiltins.includes('node:net'))
  assert.equal(value.snapshot.workerResourceInstances,0);assert.equal(value.snapshot.workerActiveLeases,0)
  assert.equal(f.app.runtime.status().resources.metrics.opens,0)
})

test('both diagnostic formats omit environment, paths, credentials and request input in either mode',async t=>{
  const old=process.env.COW_INFO_TEST_SECRET
  process.env.COW_INFO_TEST_SECRET='environment-private-canary'
  t.after(()=>{if(old===undefined)delete process.env.COW_INFO_TEST_SECRET;else process.env.COW_INFO_TEST_SECRET=old})
  for(const mode of ['development','production']) {
    const f=await fixture(t,{mode})
    for(const format of ['html','json']) {
      await f.put(`<?js cow.info({format:${JSON.stringify(format)}}) ?>`)
      const r=await f.get('/?password=query-private-canary',{method:'POST',headers:{cookie:'sid=cookie-private-canary',authorization:'Bearer authorization-private-canary','x-request-id':'id-private-canary','x-private':'header-private-canary'},body:'body-private-canary'})
      assert.equal(r.status,200)
      const body=await r.text()
      for(const secret of ['environment-private-canary','query-private-canary','cookie-private-canary','authorization-private-canary','id-private-canary','header-private-canary','body-private-canary',f.root,JSON.stringify(f.root).slice(1,-1),project]) assert.ok(!body.includes(secret),secret)
    }
  }
})

test('report facts are escaped and sensitive adapter metadata is never included',()=>{
  const snapshot=infoSnapshot({resources:{registeredAdapters:1,instances:2,activeLeases:1,adapters:{'secret-name':{key:'secret-key',error:'secret-error'}}}})
  assert.doesNotMatch(JSON.stringify(snapshot),/secret-name|secret-key|secret-error/)
  snapshot.runtime.mode='<script>alert("x")</script>'
  const body=renderInfo(snapshot)
  assert.doesNotMatch(body,/<script>/);assert.match(body,/&lt;script&gt;/)
  const names=requestBuiltinNames();names.push('node:net');assert.ok(!requestBuiltinNames().includes('node:net'))
})

test('diagnostics honor header commitment, output limits and application access checks',async t=>{
  const f=await fixture(t)
  await f.put('<?js res.status(403).send("access denied"); cow.info(); ?>')
  const denied=await f.get();assert.equal(denied.status,403);assert.equal(await denied.text(),'access denied')
  await f.put('<?js res.write("committed"); cow.info(); ?>')
  await assert.rejects(f.app.execute({url:'/'}),e=>e.code==='COW_HEADERS_COMMITTED')
  for(const expression of ['null','{format:"text"}','{secrets:true}','[]']) {
    await f.put(`<?js cow.info(${expression}) ?>`)
    await assert.rejects(f.app.execute({url:'/'}),/cow.info accepts only/)
  }
  const tiny=await fixture(t,{outputLimit:100})
  await assert.rejects(tiny.app.execute({url:'/'}),e=>e.code==='COW_RESPONSE_TOO_LARGE')
  await f.put('<?js res.header("content-security-policy","default-src \'none\'");cow.info(); ?>')
  assert.equal((await f.get()).headers.get('content-security-policy'),"default-src 'none'")
})

test('diagnostic counters are request-local and no diagnostic route is registered automatically',async t=>{
  const f=await fixture(t)
  await f.put('export const value=42','_helper.mjs')
  await f.put('<?js import "./_helper.mjs";cow.info({format:"json"}); ?>','with-helper.jsp')
  await f.put('<?js cow.info({format:"json"}) ?>')
  const first=await (await f.get()).json(),loaded=await (await f.get('/with-helper')).json(),fresh=await (await f.get()).json()
  assert.equal(loaded.snapshot.ordinaryModules,first.snapshot.ordinaryModules+1)
  assert.equal(fresh.snapshot.ordinaryModules,first.snapshot.ordinaryModules)
  assert.equal(f.app.runtime.status().workersSpawned,1)
  assert.equal((await f.get('/_cow/info')).status,404)
  assert.equal((await f.get('/info')).status,404)
})

test('cow.info cannot finish an uncommitted transaction as a successful diagnostic response',async t=>{
  const f=await fixture(t),installed=join(f.root,'node_modules/@cowlang/cow')
  await mkdir(installed,{recursive:true});await cp(join(project,'package.json'),join(installed,'package.json'));await cp(join(project,'lib'),join(installed,'lib'),{recursive:true})
  await f.put('<?js import {sqlite} from "cow:sqlite";const db=await sqlite(":memory:");db.exec("BEGIN");cow.info(); ?>')
  await assert.rejects(f.app.execute({url:'/'}),e=>e.code==='COW_SQLITE_RESPONSE_IN_TRANSACTION')
  await f.put('<?js cow.info({format:"json"}) ?>')
  assert.equal((await f.get()).status,200)
})
