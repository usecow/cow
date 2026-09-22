import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

async function fixture(t, options={}) {
  const root=await mkdtemp(join(tmpdir(),'cow-errors-')), logs=[]
  const app=new CowApp({rootDir:root,workers:1,maxRequestsPerWorker:0,port:0,mode:'production',logger:{error(value){logs.push(value)}},...options})
  t.after(async()=>{try {await app.close()} finally {await rm(root,{recursive:true,force:true})}})
  const put=async(name,source)=>{await writeFile(join(root,name),source);app.dispatcher.compiler.clear()}
  const url=(await app.start()).url
  return {app,root,url,put,logs,get:(path='/')=>fetch(url+path)}
}

test('site error pages are optional, private, lazy and cover routing and compilation failures',async t=>{
  const f=await fixture(t)
  await f.put('index.jsp','healthy')
  await f.put('_error.tsp','<?ts const status: number = locals.error.status; res.type("text"); ?>custom <?= status ?>')
  assert.equal(await (await f.get()).text(),'healthy')
  for(const path of ['/missing','/_error.tsp']) {
    const r=await f.get(path); assert.equal(r.status,404); assert.equal(await r.text(),'custom 404')
  }
  await f.put('broken.tsp','<?ts const x: = 1; ?>')
  const broken=await f.get('/broken');assert.equal(broken.status,500);assert.equal(await broken.text(),'custom 500')
  await f.put('_error.jsp','JSP wins')
  assert.equal(await (await f.get('/missing')).text(),'JSP wins')
  await f.put('_error.jsp','<?js const = ; ?>')
  assert.equal(await (await f.get()).text(),'healthy')
  assert.equal((await f.get('/missing')).status,500)
})

test('runtime error pages share the original module graph; the next request starts fresh',async t=>{
  const f=await fixture(t)
  await f.put('_state.mjs','let n=0; export const next=()=>++n;')
  await f.put('index.jsp','<?js import {next} from "./_state.mjs"; next(); throw Object.assign(new Error("secret"),{status:422,code:"TEST_FAILURE"}); ?>')
  await f.put('_error.jsp','<?js import {next} from "./_state.mjs"; res.json({n:next(),status:locals.error.status,code:locals.error.code,stack:locals.error.stack}); ?>')
  for(let i=0;i<2;i++) {
    const r=await f.get(),value=await r.json()
    assert.equal(r.status,422); assert.equal(value.n,2); assert.equal(value.code,'TEST_FAILURE');assert.match(value.stack,/index\.jsp:1:/)
  }
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('error pages replace buffered output, preserve only safe headers and log original failures',async t=>{
  const f=await fixture(t)
  await f.put('index.jsp','<?js res.header("set-cookie",["a=1","b=2"]).header("x-frame-options","DENY").header("location","/bad").header("x-success","no"); res.write("partial secret"); throw new Error("private cause"); ?>')
  await f.put('_error.jsp','safe error')
  const r=await f.get();assert.equal(r.status,500);assert.equal(await r.text(),'safe error')
  assert.deepEqual(r.headers.getSetCookie(),['a=1','b=2']);assert.equal(r.headers.get('x-frame-options'),'DENY')
  assert.equal(r.headers.get('location'),null);assert.equal(r.headers.get('x-success'),null)
  assert.equal(r.headers.get('cache-control'),'no-store')
  assert.equal(f.logs.length,1);assert.equal(f.logs[0].message,'private cause');assert.equal(f.app.server.metrics.errors,1)
})

test('site handlers see async failure causes but explicit error responses are not intercepted',async t=>{
  const f=await fixture(t)
  await f.put('_error.jsp','<?js res.json({code:locals.error.code,causes:locals.error.errors.map(e=>e.message)}); ?>')
  await f.put('index.jsp','<?js Promise.reject(new Error("async detail")); echo("wrong success"); ?>')
  const r=await f.get();assert.equal(r.status,500);assert.deepEqual(await r.json(),{code:'COW_UNHANDLED_REJECTION',causes:['async detail']})
  await f.put('index.jsp','<?js res.status(404).send("explicit"); ?>')
  const explicit=await f.get();assert.equal(explicit.status,404);assert.equal(await explicit.text(),'explicit')
})

test('failed module imports are not replayed and a broken handler has one safe fallback',async t=>{
  const f=await fixture(t)
  await f.put('_state.mjs','export const state={n:0};')
  await f.put('_failed.mjs','import {state} from "./_state.mjs"; state.n++; throw new Error("failed import secret");')
  await f.put('index.jsp','<?js import "./_failed.mjs"; ?>')
  await f.put('_error.jsp','<?js import {state} from "./_state.mjs"; try {await import("./_failed.mjs")} catch {} res.json(state.n); ?>')
  assert.equal(await (await f.get()).json(),1)
  await f.put('_error.jsp','<?js throw new Error("handler secret"); ?>')
  const r=await f.get(),body=await r.text();assert.equal(r.status,500);assert.doesNotMatch(body,/secret|_error|failed import/)
  assert.equal(f.logs.at(-1).code,'COW_ERROR_HANDLER_FAILED')
})

test('error output permits automatic rollback, but cannot disguise an unfinished transaction as success',async t=>{
  const f=await fixture(t),installed=join(f.root,'node_modules/@cowlang/cow'),project=fileURLToPath(new URL('../',import.meta.url))
  await mkdir(installed,{recursive:true});await cp(join(project,'package.json'),join(installed,'package.json'));await cp(join(project,'lib'),join(installed,'lib'),{recursive:true})
  await f.put('index.jsp','<?js import {sqlite} from "cow:sqlite"; const db=await sqlite(__dirname+"/_test.sqlite"); db.exec("CREATE TABLE IF NOT EXISTS items(n); BEGIN; INSERT INTO items VALUES(1)"); throw new Error("rollback me"); ?>')
  await f.put('count.jsp','<?js import {sqlite} from "cow:sqlite"; const db=await sqlite(__dirname+"/_test.sqlite"); res.json(db.get("SELECT count(*) AS n FROM items").n); ?>')
  await f.put('_error.jsp','handled')
  const r=await f.get();assert.equal(r.status,500);assert.equal(await r.text(),'handled')
  assert.equal(await (await f.get('/count')).json(),0)
  await f.put('_error.jsp','<?js res.status(200).send("wrong success"); ?>')
  const fail=await f.get();assert.equal(fail.status,500);assert.doesNotMatch(await fail.text(),/wrong success/)
  assert.equal(await (await f.get('/count')).json(),0)
})

test('deadline and cleanup failures do not replay a page through a new error-handler request',async t=>{
  const f=await fixture(t,{timeout:500})
  await f.put('_error.jsp','must not run')
  await f.put('index.jsp','<?js await new Promise(()=>{}); ?>')
  const r=await f.get();assert.equal(r.status,504);assert.doesNotMatch(await r.text(),/must not run/)
  await f.put('index.jsp','<?js cow.onCleanup(()=>{throw new Error("cleanup secret")}); ?>')
  const c=await f.get();assert.equal(c.status,500);assert.doesNotMatch(await c.text(),/must not run|cleanup secret/)
})

test('body and compilation admission failures bypass the site handler with the original status',async t=>{
  const f=await fixture(t,{bodyLimit:16,compiledBufferLimit:1})
  await f.put('index.jsp','healthy');await f.put('_error.jsp','must not run')
  const capacity=await f.get();assert.equal(capacity.status,503);assert.doesNotMatch(await capacity.text(),/must not run/)
  assert.equal(f.logs.at(-1).code,'COW_COMPILED_BUFFER_FULL')
  const body=await fetch(f.url,{method:'POST',body:'x'.repeat(32)});assert.equal(body.status,413);assert.doesNotMatch(await body.text(),/must not run/)
})
