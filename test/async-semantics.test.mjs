import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

async function fixture(t, options={}) {
  const root=await mkdtemp(join(tmpdir(),'cow-async-'))
  const app=new CowApp({rootDir:root,workers:1,maxRequestsPerWorker:0,port:0,logger:{error(){}},...options})
  t.after(async()=>{try {await app.close()} finally {await rm(root,{recursive:true,force:true})}})
  await app.initialize()
  return {app,root,async page(source) {
    await writeFile(join(root,'index.jsp'),'<?js '+source+' ?>')
    app.dispatcher.compiler.clear()
    const result=await app.execute({url:'/'})
    return JSON.parse(Buffer.from(result.response.body))
  }}
}

test('async contract: awaited/caught native failures and explicitly tracked recovery remain successful',async t=>{
  const f=await fixture(t)
  assert.deepEqual(await f.page(`
    import {readFile} from 'node:fs/promises';
    const failures=[];
    try {await readFile(__dirname+'/_missing')} catch(e) {failures.push(e.code)}
    try {await cow.track(readFile(__dirname+'/_missing'))} catch(e) {failures.push(e.code)}
    try {await Promise.reject(new Error('handled'))} catch(e) {failures.push(e.message)}
    res.json(failures);
  `),['ENOENT','ENOENT','handled'])
})

test('async contract: omitted native awaits report an unhandled rejection rather than successful output',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.page(`import {readFile} from 'node:fs/promises'; readFile(__dirname+'/_missing'); res.json('wrong success');`),
    error=>error.code==='COW_UNHANDLED_REJECTION' && error.errors.some(cause=>cause.code==='ENOENT'))
  assert.equal(await f.page('res.json("healthy")'),'healthy')
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('async contract: plain rejected promises belong to the request and do not crash a reused worker',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.page(`Promise.reject(new Error('request-owned failure')); res.json('wrong success');`),
    error=>error.code==='COW_UNHANDLED_REJECTION' && error.errors.some(cause=>cause.message==='request-owned failure'))
  assert.equal(await f.page('res.json("healthy")'),'healthy')
  assert.equal(f.app.runtime.status().workersSpawned,1)
})

test('async diagnostics tolerate rejected values with throwing getters and coercion without crashing the worker', async t => {
  const f = await fixture(t)
  await assert.rejects(f.page(`Promise.reject({get message(){throw new Error('getter')},toString(){throw new Error('coercion')}});res.json('wrong success');`),
    error => error.code === 'COW_UNHANDLED_REJECTION' && error.errors.some(cause => cause.message === 'Non-serializable rejected value'))
  assert.equal(await f.page('res.json("healthy")'), 'healthy')
  assert.equal(f.app.runtime.status().workersSpawned, 1)
})

test('async contract: rejection from an unawaited then branch is not hidden by tracking its parent',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.page(`import {readFile} from 'node:fs/promises'; readFile(__filename).then(()=>{throw new Error('branch failure')}); res.json('wrong success');`),
    error=>error.code==='COW_UNHANDLED_REJECTION' && error.errors.some(cause=>cause.message==='branch failure'))
})

test('async contract: asynchronous filesystem callbacks drain and report their failures',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.page(`import {readFile} from 'node:fs'; import {setTimeout as delay} from 'node:timers/promises';
    readFile(__filename,async()=>{await delay(10);throw new Error('fs callback failure')}); res.json('wrong success');`),
    error=>error.code==='COW_ASYNC_CALLBACK_FAILED' && error.errors.some(cause=>cause.message==='fs callback failure'))
})

test('async contract: asynchronous microtasks and nextTick callbacks report errors',async t=>{
  const f=await fixture(t)
  for(const callback of ['queueMicrotask','process.nextTick']) {
    await assert.rejects(f.page(`${callback}(async()=>{throw new Error('microtask failure')}); res.json('wrong success');`),
      error=>error.code==='COW_ASYNC_CALLBACK_FAILED' && error.errors.some(cause=>cause.message==='microtask failure'))
  }
})

test('async contract: omitted include awaits fail instead of silently losing late output',async t=>{
  const f=await fixture(t)
  await writeFile(join(f.root,'_child.jsp'),'<?js import {setTimeout as delay} from "node:timers/promises"; await delay(20); echo("late") ?>')
  await assert.rejects(f.page(`include('./_child.jsp'); res.json('wrong success');`),
    error=>error.code==='COW_UNHANDLED_REJECTION' && error.errors.some(cause=>cause.code==='COW_RESPONSE_FINISHED'))
})

test('async contract: parallel awaited operations and caught parallel failures preserve JS behavior',async t=>{
  const f=await fixture(t)
  assert.deepEqual(await f.page(`import {writeFile,readFile} from 'node:fs/promises';
    await Promise.all([writeFile(__dirname+'/_one','one'),writeFile(__dirname+'/_two','two')]);
    const values=await Promise.all([readFile(__dirname+'/_one','utf8'),readFile(__dirname+'/_two','utf8')]);
    const failures=await Promise.allSettled([readFile(__dirname+'/_missing'),Promise.reject(new Error('handled'))]);
    res.json({values,failures:failures.map(result=>result.status)});`),
    {values:['one','two'],failures:['rejected','rejected']})
})

test('async contract: async callback failures during cleanup cannot be reported as successful requests',async t=>{
  const f=await fixture(t)
  await assert.rejects(f.page(`cow.onCleanup(()=>{queueMicrotask(async()=>{throw new Error('cleanup callback failure')})}); res.json('wrong success');`),
    error=>error.code==='COW_CLEANUP_FAILED' && error.errors.some(group=>group.errors?.some(cause=>cause.message==='cleanup callback failure')))
})

test('async contract: a rejection handled before completion is not reported as unhandled',async t=>{
  const f=await fixture(t)
  assert.equal(await f.page(`import {setTimeout as delay} from 'node:timers/promises';
    const work=Promise.reject(new Error('handled later')); await delay(10);
    try {await work} catch(e) {} res.json('recovered');`),'recovered')
})

test('async contract: a native consumer can catch a rejected async callback without false failure reports',async t=>{
  const f=await fixture(t), installed=join(f.root,'node_modules/@cowlang/cow'), project=fileURLToPath(new URL('../',import.meta.url))
  await mkdir(installed,{recursive:true})
  await cp(join(project,'package.json'),join(installed,'package.json'))
  await cp(join(project,'lib'),join(installed,'lib'),{recursive:true})
  assert.equal(await f.page(`import {sqlite} from 'cow:sqlite'; const db=await sqlite(':memory:');
    let recovered=false; try {await db.transaction(async()=>{await Promise.resolve();throw new Error('rollback')})}
    catch(e) {recovered=e.message==='rollback'} res.json(recovered);`),true)
})

test('async diagnostics show bounded escaped causes in development and hide them in production',async t=>{
  for(const mode of ['development','production']) {
    const f=await fixture(t,{mode})
    await writeFile(join(f.root,'index.jsp'),'<?js Promise.reject(new Error("diagnostic <secret>")); res.json("wrong success"); ?>')
    const url=(await f.app.start()).url, response=await fetch(url), body=await response.text()
    assert.equal(response.status,500)
    if(mode==='development') {
      assert.match(body,/COW_UNHANDLED_REJECTION/)
      assert.match(body,/diagnostic &lt;secret&gt;/)
      assert.match(body,/index\.jsp:1:/)
    } else assert.doesNotMatch(body,/diagnostic|secret|index\.jsp|COW_UNHANDLED_REJECTION/)
  }
})
