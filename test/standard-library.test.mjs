import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cow-stdlib-')), site = join(root, 'site')
  const app = new CowApp({ rootDir: site, workers: 1, maxRequestsPerWorker: 0 })
  t.after(async () => { try { await app.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await mkdir(site)
  const installed = join(root, 'node_modules/@cowlang/cow'), project = fileURLToPath(new URL('../', import.meta.url))
  await mkdir(installed, { recursive: true })
  await cp(join(project, 'package.json'), join(installed, 'package.json'))
  await cp(join(project, 'lib'), join(installed, 'lib'), { recursive: true })
  await app.initialize()
  return { async page(source) {
    await writeFile(join(site, 'index.jsp'), `<?js ${source} ?>`)
    app.dispatcher.compiler.clear()
    const result = await app.execute({ url: '/' })
    return JSON.parse(Buffer.from(result.response.body))
  } }
}

test('standard library: JS collections, Unicode, regular expressions and structured data work in requests', async t => {
  const f = await fixture(t)
  const source = `
    const data = structuredClone({nested:[1,2]}); data.nested.push(3);
    res.json({ normalized:'e\u0301'.normalize('NFC'),
      graphemes:[...new Intl.Segmenter('en',{granularity:'grapheme'}).segment('a👩‍💻')].length,
      regex:'Hello 123'.replace(/\\d+/g,'world'),
      collection:[1,2,3,4].filter(n=>n%2===0).map(n=>n*2).reduce((a,b)=>a+b,0),
      map:[...new Map([['key',1]])], set:[...new Set([1,1,2])],
      json:JSON.parse(JSON.stringify(data)), bigint:(2n**64n).toString()});`
  for (let n=0;n<2;n++) assert.deepEqual(await f.page(source), {
    normalized:'é', graphemes:2, regex:'Hello world', collection:12,
    map:[['key',1]], set:[1,2], json:{nested:[1,2,3]}, bigint:'18446744073709551616'
  })
})

test('standard library: text/byte encodings, URLs, dates and locale formatting are available without adapters', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.page(`
    const bytes=new TextEncoder().encode('café');
    let strict=false; try {new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array([255]))} catch(e) {strict=true}
    const params=new URLSearchParams([['tag','a'],['tag','b']]);
    const url=new URL('/news?q=café','https://example.test');
    const date=new Date('2025-01-02T03:04:05Z');
    res.json({text:new TextDecoder().decode(bytes),hex:Buffer.from(bytes).toString('hex'),
      base64:Buffer.from('Cow').toString('base64'),strict,tags:params.getAll('tag'),host:url.host,
      iso:date.toISOString(),day:new Intl.DateTimeFormat('en-US',{timeZone:'UTC',day:'2-digit'}).format(date),
      money:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(12.5)});
  `), {text:'café',hex:'636166c3a9',base64:'Q293',strict:true,tags:['a','b'],host:'example.test',
    iso:'2025-01-02T03:04:05.000Z',day:'02',money:'$12.50'})
})

test('standard library: ordinary filesystem operations and path helpers work through request-owned views', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.page(`
    import {mkdir,writeFile,readFile,readdir,stat,rename,unlink} from 'node:fs/promises';
    import {join,basename} from 'node:path';
    const directory=join(__dirname,'../files'); await mkdir(directory,{recursive:true});
    const file=join(directory,'one.txt'); await writeFile(file,'hello',{flag:'wx'});
    const size=(await stat(file)).size; const text=await readFile(file,'utf8');
    await rename(file,join(directory,'two.txt')); const names=await readdir(directory);
    await unlink(join(directory,'two.txt'));
    res.json({text,size,names,basename:basename(file),remaining:await readdir(directory)});
  `), {text:'hello',size:5,names:['two.txt'],basename:'one.txt',remaining:[]})
})

test('standard library: native crypto, Web Crypto, passwords, escaping and SQLite compose in a page', async t => {
  const f = await fixture(t)
  const result = await f.page(`
    import {createHash,randomBytes} from 'node:crypto'; import {sqlite} from 'cow:sqlite';
    import {hashPassword,verifyPassword,escapeHtml,secretMatches} from 'cow:web';
    const db=await sqlite(':memory:'); db.exec('CREATE TABLE IF NOT EXISTS value (n INTEGER)');
    await db.transaction(()=>db.run('INSERT INTO value VALUES (?)',[42]));
    const password='example library password'; const hash=await hashPassword(password);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('abc'));
    res.json({hash:createHash('sha256').update('abc').digest('hex'),webHash:Buffer.from(digest).toString('hex'),
      random:randomBytes(16).length,password:await verifyPassword(password,hash),
      escaped:escapeHtml('<&>'),equal:secretMatches('a','a'),row:db.get('SELECT n FROM value')});
  `)
  assert.equal(result.hash,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(result.webHash,result.hash)
  assert.deepEqual({...result,hash:undefined,webHash:undefined},{hash:undefined,webHash:undefined,random:16,password:true,escaped:'&lt;&amp;&gt;',equal:true,row:{n:42}})
})

test('standard library: fetch, JSON response bodies, headers and explicit cancellation work inside requests', async t => {
  const server = createServer((req,res) => { res.setHeader('content-type','application/json'); res.end(JSON.stringify({path:req.url,header:req.headers['x-test']})) })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}))
  const f = await fixture(t), url = 'http://127.0.0.1:'+server.address().port
  assert.deepEqual(await f.page(`
    const response=await fetch(${JSON.stringify(url+'/data')},{headers:new Headers({'x-test':'cow'})});
    const value=await response.json(); const controller=new AbortController(); controller.abort();
    let aborted=false; try {await fetch(${JSON.stringify(url)},{signal:controller.signal})} catch(e) {aborted=e.name==='AbortError'}
    res.json({value,type:response.headers.get('content-type'),status:response.status,aborted});
  `), {value:{path:'/data',header:'cow'},type:'application/json',status:200,aborted:true})
})

test('standard library audit records unsupported capabilities explicitly instead of promising all host Node APIs', async t => {
  const f = await fixture(t)
  const result = await f.page(`
    import {createReadStream} from 'node:fs';
    const blocked={};
    for(const name of ['node:stream','node:zlib','node:http','node:net','node:child_process']) {
      try {await import(name)} catch(e) {blocked[name]=e.code}
    }
    try {createReadStream(__filename)} catch(e) {blocked.fileStream=e.code}
    res.json({blocked,xml:typeof DOMParser,image:typeof Image,csv:typeof parseCsv});
  `)
  assert.deepEqual(Object.keys(result.blocked),['node:stream','node:zlib','node:http','node:net','node:child_process','fileStream'])
  assert.ok(Object.values(result.blocked).every(code=>code==='COW_NATIVE_API_UNSUPPORTED'))
  assert.deepEqual({...result,blocked:undefined},{blocked:undefined,xml:'undefined',image:'undefined',csv:'undefined'})
})

test('standard library: the CSV module composes with file IO in a real request', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.page(`
    import {parseCsv,stringifyCsv} from 'cow:csv'; import {writeFile,readFile} from 'node:fs/promises';
    const rows=[['name','id'],['Cow, site','001'],['quoted "title"','002']];
    const path=__dirname+'/../export.csv'; await writeFile(path,stringifyCsv(rows));
    res.json(parseCsv(await readFile(path,'utf8')));
  `),[['name','id'],['Cow, site','001'],['quoted "title"','002']])
})
