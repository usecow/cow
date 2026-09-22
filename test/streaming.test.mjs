import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
import { downloadDisposition, openOutputFile } from '../lib/file-output.mjs'

async function fixture(t,options={}) {
  const root=await mkdtemp(join(tmpdir(),'cow-stream-')),logs=[]
  const app=new CowApp({rootDir:root,workers:1,maxRequestsPerWorker:0,port:0,outputLimit:1024,mode:'production',logger:{error:e=>logs.push(e)},...options})
  t.after(async()=>{try {await app.close()} finally {await rm(root,{recursive:true,force:true})}})
  const url=(await app.start()).url
  return {app,root,url,logs,put:async(name,source)=>{await writeFile(join(root,name),source);app.dispatcher.compiler.clear()},get:(path='/',init)=>fetch(url+path,init)}
}

test('file downloads stream private files beyond the buffer limit, with UTF-8 names and HEAD framing',async t=>{
  const f=await fixture(t),bytes=Buffer.alloc(300_001,97)
  bytes[0]=0;bytes[bytes.length-1]=255
  await f.put('_private.bin',bytes)
  await f.put('index.jsp','<?js await res.download(__dirname+"/_private.bin","résumé.bin"); echo("must not run"); ?>')
  const r=await f.get();assert.equal(r.status,200);assert.equal(r.headers.get('content-length'),String(bytes.length))
  assert.match(r.headers.get('content-disposition'),/filename\*=UTF-8''r%C3%A9sum%C3%A9.bin/)
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes)
  const head=await f.get('/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal(await head.text(),'')
  assert.equal((await f.get('/_private.bin')).status,404)
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('dynamic streams reach the browser before rendering ends and keep ordinary output buffered',async t=>{
  const f=await fixture(t)
  await f.put('index.jsp','<?js import {setTimeout as delay} from "node:timers/promises"; res.type("text").header("content-length","999"); await res.stream((async function*(){yield "first";await delay(300);yield "last"})()); ?>')
  const r=await f.get();assert.equal(r.headers.get('content-length'),null)
  const reader=r.body.getReader(),first=await reader.read()
  assert.equal(Buffer.from(first.value).toString(),'first')
  assert.equal(f.app.runtime.status().busyWorkers,1)
  let rest='';for(;;){const next=await reader.read();if(next.done)break;rest+=Buffer.from(next.value).toString()}
  assert.equal(rest,'last')
  await f.put('index.jsp','<?js echo("before"); await res.flush(); echo("after"); ?>')
  const buffered=await f.get();assert.equal(buffered.headers.get('content-length'),'11');assert.equal(await buffered.text(),'beforeafter')
})

test('streams replace buffered prefixes, support binary/sync iterables and suppress HEAD/bodyless iteration',async t=>{
  const f=await fixture(t)
  await f.put('index.jsp','<?js echo("discarded"); await res.stream(["a",new Uint8Array([0,255]),"b"]); ?>')
  assert.deepEqual(Buffer.from(await (await f.get()).arrayBuffer()),Buffer.from([97,0,255,98]))
  await f.put('index.jsp','<?js await res.stream(new Response("web body").body); ?>')
  assert.equal(await (await f.get()).text(),'web body')
  for(const status of [200,204,205,304]) {
    await f.put('index.jsp',`<?js res.status(${status}); await res.stream((async function*(){throw new Error("should not iterate")})()); ?>`)
    const r=await f.get('/',status===200?{method:'HEAD'}:undefined)
    assert.equal(r.status,status);assert.equal(await r.text(),'')
    assert.equal(r.headers.get('content-length'),status===205?'0':null)
  }
})

test('missing files and pre-stream failures can use the site error page; late failures cannot',async t=>{
  const f=await fixture(t)
  await f.put('_error.jsp','safe error page')
  for(const source of ['await res.sendFile(__dirname+"/_missing")','await res.stream((async function*(){throw new Error("early")})())']) {
    await f.put('index.jsp','<?js '+source+' ?>');const r=await f.get();assert.ok([404,500].includes(r.status));assert.equal(await r.text(),'safe error page')
  }
  await f.put('index.jsp','<?js import {setTimeout as delay} from "node:timers/promises"; await res.stream((async function*(){yield "prefix";await delay(50);throw new Error("late secret")})()); ?>')
  const r=await f.get();assert.equal(r.status,200)
  await assert.rejects(r.text())
  assert.equal(f.logs.at(-1).message,'late secret')
  await f.put('index.jsp','healthy');assert.equal(await (await f.get()).text(),'healthy')
})

test('embedded execution buffers by default, or awaits a bounded streaming sink',async t=>{
  const f=await fixture(t)
  await f.put('index.jsp','<?js await res.stream(["a","b"]); ?>')
  const buffered=await f.app.execute({url:'/'});assert.equal(Buffer.from(buffered.response.body).toString(),'ab');assert.equal(buffered.response.streamed,undefined)
  await f.put('index.jsp','<?js await res.stream([new Uint8Array(200000)]); ?>')
  await assert.rejects(f.app.execute({url:'/'}),e=>e.code==='COW_RESPONSE_TOO_LARGE')
  const chunks=[];let active=0,max=0
  const streamed=await f.app.execute({url:'/'},{onStream:async message=>{
    active++;max=Math.max(max,active)
    if(message.type==='chunk'){chunks.push(message.body.length);await new Promise(resolve=>setTimeout(resolve,5))}
    active--
  }})
  assert.equal(streamed.response.streamed,true);assert.equal(max,1);assert.equal(chunks.reduce((a,b)=>a+b,0),200000);assert.ok(Math.max(...chunks)<=65536)
})

test('file output validates paths, regular files, filenames and header commitment before reading',async t=>{
  const f=await fixture(t)
  await f.put('_private.txt','hello')
  for(const source of [
    'await res.sendFile("relative.txt")',
    'await res.sendFile(__dirname)',
    'await res.download(__dirname+"/_private.txt","../bad")',
    'await res.download(__dirname+"/_private.txt","bad\\r\\nHeader: x")',
    'res.write("prefix"); await res.sendFile(__dirname+"/_private.txt")',
    'await res.stream([{}])'
  ]) {
    await f.put('index.jsp','<?js '+source+' ?>');assert.equal((await f.get()).status,500)
  }
  await f.put('index.jsp','<?js res.type("text"); await res.sendFile(__dirname+"/_private.txt"); ?>')
  const r=await f.get();assert.equal(r.headers.get('content-type'),'text/plain; charset=utf-8');assert.equal(r.headers.get('content-disposition'),null);assert.equal(await r.text(),'hello')
})

test('late cleanup failures abort streamed responses and client cancellation frees admission',async t=>{
  const f=await fixture(t)
  await f.put('index.jsp','<?js cow.onCleanup(()=>{throw new Error("cleanup failed")});await res.stream(["prefix"]); ?>')
  const r=await f.get();await assert.rejects(r.text())
  await f.put('index.jsp','<?js import {setTimeout as delay} from "node:timers/promises";await res.stream((async function*(){yield "prefix";await delay(3000);yield "suffix"})()); ?>')
  const controller=new AbortController(),pending=await f.get('/',{signal:controller.signal})
  await pending.body.getReader().read();controller.abort()
  const deadline=Date.now()+3000
  while(f.app.dispatcher.status().admittedRequests && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(f.app.dispatcher.status().admittedRequests,0);assert.equal(f.app.dispatcher.status().bufferedBytes,0)
  await f.put('index.jsp','recovered');assert.equal(await (await f.get()).text(),'recovered')
})

test('stream writes check transactions opened inside generators before sending success bytes',async t=>{
  const f=await fixture(t),installed=join(f.root,'node_modules/@cowlang/cow'),project=fileURLToPath(new URL('../',import.meta.url))
  await mkdir(installed,{recursive:true});await cp(join(project,'package.json'),join(installed,'package.json'));await cp(join(project,'lib'),join(installed,'lib'),{recursive:true})
  await f.put('_error.jsp','rolled back')
  await f.put('index.jsp','<?js import {sqlite} from "cow:sqlite";const db=await sqlite(":memory:");await res.stream((async function*(){db.exec("BEGIN");yield "wrong success"})()); ?>')
  const r=await f.get();assert.equal(r.status,500);assert.equal(await r.text(),'rolled back')
})

test('failed streams cannot be disguised as success by catching their errors or omitting await',async t=>{
  const f=await fixture(t)
  for(const source of [
    'res.stream(["omitted await"])',
    'try {await res.stream((async function*(){throw new Error("failure")})())}catch{} res.end("wrong success")'
  ]) {
    await f.put('index.jsp','<?js '+source+' ?>')
    await assert.rejects(f.app.execute({url:'/'}))
  }
  await f.put('index.jsp','healthy');assert.equal(await (await f.get()).text(),'healthy')
})

test('stream sink failures close iteration and do not rerun the site handler',async t=>{
  const f=await fixture(t)
  await f.put('_error.jsp','must not run')
  await f.put('index.jsp','<?js import {writeFile} from "node:fs/promises";await res.stream((async function*(){try {yield "one";yield "two"} finally {await writeFile(__dirname+"/_closed","yes")}})()); ?>')
  let writes=0
  await assert.rejects(f.app.execute({url:'/'},{onStream:message=>{if(message.type==='chunk'){writes++;throw new Error('sink failure')}}}),/sink failure/)
  assert.equal(writes,1);assert.equal(await readFile(join(f.root,'_closed'),'utf8'),'yes')
  await f.put('index.jsp','healthy');assert.equal(await (await f.get()).text(),'healthy')
})

test('file output caps growth, detects truncation and rejects unsafe download names',async t=>{
  const f=await fixture(t),path=join(f.root,'_file')
  await f.put('_file','original')
  const growing=await openOutputFile(path,false)
  try {
    await writeFile(path,'original and additional bytes')
    const chunks=[];for await(const chunk of growing.source)chunks.push(Buffer.from(chunk))
    assert.equal(Buffer.concat(chunks).toString(),'original')
  } finally {await growing.close()}
  const shrinking=await openOutputFile(path,false)
  try {await truncate(path,1);await assert.rejects(async()=>{for await(const chunk of shrinking.source){}},e=>e.code==='COW_FILE_CHANGED')}
  finally {await shrinking.close()}
  for(const name of ['','..','x/y','x\\y','x\nheader','x'.repeat(256)])assert.throws(()=>downloadDisposition(name),TypeError)
  assert.match(downloadDisposition('say "hello".txt'),/filename="say _hello_\.txt"/)
})
