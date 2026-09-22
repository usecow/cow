import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import ts from '../lib/syntax.mjs'

const project=fileURLToPath(new URL('../',import.meta.url))
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'cow-types-')),installed=join(root,'node_modules/@cowlang/cow')
  t.after(()=>rm(root,{recursive:true,force:true}))
  await mkdir(installed,{recursive:true})
  for(const file of ['package.json','lib','types']) await cp(join(project,file),join(installed,file),{recursive:true})
  return {root, async check(source,extension='mts') {
    const file=join(root,'consumer.'+extension);await writeFile(file,source)
    const program=ts.createProgram([file],{noEmit:true,strict:true,skipLibCheck:false,types:[],
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,
      allowJs:extension==='mjs',checkJs:extension==='mjs'})
    const diagnostics=ts.getPreEmitDiagnostics(program)
    assert.deepEqual(diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[])
  }}
}

test('Cow declarations resolve all public exports without host Node declarations and reject invalid page API use',async t=>{
  const f=await fixture(t)
  await f.check(`
    import {CowApp,normalizeRequest,compileSource} from '@cowlang/cow';
    import type {CowRequest,CowResponse,TemplateContext,SiteError} from 'cow:runtime';
    import {sqlite} from 'cow:sqlite';
    import {session,setCookie,deleteCookie,field} from 'cow:web';
    import {parseCsv,stringifyCsv} from 'cow:csv';
    import {defineResource} from 'cow:resource';
    import {sqlite as packageSqlite} from '@cowlang/cow/sqlite';
    const sameHelper:typeof sqlite=packageSqlite;
    export async function page(req:CowRequest,res:CowResponse) {
      const db=await sqlite(':memory:');
      const current=await session<{count:number}>(db,req,res);
      current.update({count:1}); current.touch();
      const data=await req.formData();const value=data.get('avatar');
      if(value && typeof value!=='string') await value.save('/private/avatar');
      field(data,'name');setCookie(res,'theme','dark',{sameSite:'Strict'});deleteCookie(res,'theme');
      res.json(parseCsv(stringifyCsv([['name','001']])));
    }
    const app=new CowApp({port:0,workers:1});await app.initialize();
    const result=await app.execute(normalizeRequest({url:'/'}));
    if(result.kind==='response') result.response.body.byteLength;
    await app.execute({url:'/'},{onStream:async message=>{if(message.type==='chunk') message.body.byteLength;else message.status}});
    export async function download(res:CowResponse){await res.download('/private/report','report.csv')}
    export async function stream(res:CowResponse){await res.stream((async function*(){yield 'text';yield new Uint8Array([1])})())}
    declare const errorPage:TemplateContext<{error:SiteError}>;
    errorPage.locals.error.status;
    compileSource('<?js echo(1) ?>',{filePath:'index.jsp',language:'js'});
    compileSource('<?ts const n: number = 1; ?><?= n ?>',{filePath:'index.cow'});
    const acquire=defineResource({name:'sample',key:(options:{name:string})=>options.name,
      open:()=>({n:1}),acquire:resource=>({value:resource.n}),close:()=>{}});
    const lease=await acquire({name:'one'});const n:number=lease.value;
    declare const context:TemplateContext<{title:string}>;
    context.echo(context.locals.title); await context.include('./_part.jsp',{title:'hello'});
    export function diagnostic(context:TemplateContext){context.cow.info({format:'html'})}
    // @ts-expect-error No unsafe diagnostic switches.
    context.cow.info({secrets:true});
    // @ts-expect-error Request query method does not exist.
    context.req.query('name');
    // @ts-expect-error Upload methods require narrowing away from string.
    (await context.req.formData()).get('file')?.save('/private/file');
    // @ts-expect-error Helpers do not receive ambient page globals.
    req.get('name');
    // @ts-expect-error Cookie values must use a documented SameSite spelling.
    setCookie(context.res,'x','y',{sameSite:'wrong'});
    // @ts-expect-error A serialized CSV cell cannot be an object.
    stringifyCsv([[{}]]);
    // @ts-expect-error Streams accept text or bytes, not objects.
    context.res.stream([{}]);
  `)
})

test('JSDoc helpers can use Cow request/response declarations without a build step',async t=>{
  const f=await fixture(t)
  await f.check(`
    /** @param {import('@cowlang/cow/runtime').CowRequest} req
     * @param {import('@cowlang/cow/runtime').CowResponse} res */
    export function greet(req,res) {res.json({name:req.get('name')??'visitor'})}
  `,'mjs')
})

test('public type-only vocabulary has a harmless runtime target and declarations ship as explicit package files',async()=>{
  const manifest=JSON.parse(await readFile(join(project,'package.json'),'utf8'))
  for(const entry of Object.values(manifest.exports)) {
    assert.equal(typeof entry.types,'string')
    assert.equal(typeof entry.default,'string')
    assert.ok((await readFile(join(project,entry.types),'utf8')).length>0)
  }
  assert.ok(manifest.files.includes('types/'))
  assert.deepEqual(Object.keys(await import('../lib/runtime-types.mjs')),[])
})
