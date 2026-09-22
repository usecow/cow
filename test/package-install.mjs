// Separate from the default suite: this test downloads public dependencies.
// All npm configuration, caches, packages and application data are disposable.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const exec = promisify(execFile)
const project = fileURLToPath(new URL('../', import.meta.url))
const password = 'Disposable package install passphrase'

function inside(parent, path) {
  const part = relative(parent, path)
  return part !== '' && part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(part)
}

async function npmEntry() {
  // npm supplies this for `npm run test:package`. Direct node invocation also
  // works with the usual Windows and Unix Node/npm installation layouts.
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  for (const path of candidates.filter(Boolean)) {
    if ((await lstat(path).catch(() => null))?.isFile()) return path
  }
  throw new Error('Cannot locate npm. Run this test with npm run test:package.')
}

function client(address, cookiePrefix = 'jin_forum=') {
  let cookie = ''
  return {
    get cookie() { return cookie },
    async request(path, values) {
      const response = await fetch(address() + path, {
        method: values === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(10_000),
        body: values === undefined ? undefined : new URLSearchParams(values)
      })
      for (const header of response.headers.getSetCookie()) {
        if (header.startsWith(cookiePrefix)) cookie = header.split(';')[0]
      }
      return { status: response.status, headers: response.headers, text: await response.text() }
    }
  }
}

function hidden(page, name) {
  const found = page.text.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(found, `Missing ${name}; HTTP ${page.status}: ${page.text.slice(0, 2000)}`)
  return found[1]
}

function redirect(page) {
  assert.equal(page.status, 303, page.text)
  return page.headers.get('location')
}

test('the packed runtime serves installed projects and plain sites through npx', { timeout: 180_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cow-package-test-'))
  const canonicalRoot = await realpath(root)
  assert.ok(!inside(await realpath(project), canonicalRoot), 'The test must live outside the checkout')
  const app = join(root, 'independent app') // Exercise Windows paths with spaces.
  const artifacts = join(root, 'tarballs')
  const dependency = join(root, 'dependency')
  let server
  t.after(async () => {
    await server?.stop()
    // Only remove the exact temporary root created by this test, never a
    // user-provided path or a broad workspace/cache directory.
    const actual = await realpath(root)
    assert.equal(actual, canonicalRoot)
    assert.equal(dirname(actual), await realpath(tmpdir()))
    assert.ok(actual.split(/[\\/]/).at(-1).startsWith('cow-package-test-'))
    await rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })
  await Promise.all([mkdir(app), mkdir(artifacts), mkdir(dependency)])
  const userConfig = join(root, 'user.npmrc'), globalConfig = join(root, 'global.npmrc')
  await Promise.all([writeFile(userConfig, ''), writeFile(globalConfig, '')])
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^npm_/i.test(key) && !/^(NODE_PATH|NODE_OPTIONS|NODE_AUTH_TOKEN|NPM_TOKEN)$/i.test(key)))
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
  if (pathKey) env[pathKey] = env[pathKey].split(process.platform === 'win32' ? ';' : ':')
    .filter((entry) => entry && !inside(project, resolve(entry)))
    .join(process.platform === 'win32' ? ';' : ':')
  Object.assign(env, {
    npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig,
    npm_config_cache: join(root, 'empty-npm-cache'), npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_prefix: join(root, 'global-prefix'),
    npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    npm_config_fetch_retries: '0', npm_config_fetch_timeout: '20000'
  })
  const npm = await npmEntry()
  const run = (args, cwd = app) => exec(process.execPath, args, {
    cwd, env, windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024
  })
  const runNpm = (args, cwd = app) => run([npm, ...args], cwd)
  const pack = async (directory) => {
    const { stdout } = await runNpm(['pack', directory, '--json', '--pack-destination', artifacts], root)
    const [result] = JSON.parse(stdout)
    assert.ok(result && result.filename && !result.filename.includes('/') && !result.filename.includes('\\'))
    return { ...result, tarball: join(artifacts, result.filename) }
  }

  t.diagnostic('Packing Cow locally; no publication or npm login.')
  const packed = await pack(project)
  assert.equal(packed.name, '@cowlang/cow')
  assert.equal(packed.filename, `cowlang-cow-${packed.version}.tgz`)
  assert.ok(packed.files.some(file => file.path === 'bin/cow.mjs'))
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  assert.equal(packed.version, manifest.version)
  assert.ok(packed.files.some((file) => file.path === 'lib/source-map.mjs'))
  assert.ok(packed.files.some((file) => file.path === 'examples/forum/site/topic.cow'))
  for (const name of ['auth', 'config', 'db', 'forum']) {
    assert.ok(packed.files.some(file => file.path === `examples/forum/site/_${name}.cow`))
    assert.ok(!packed.files.some(file => file.path === `examples/forum/site/_${name}.mjs`))
  }
  assert.ok(packed.files.some((file) => file.path === 'lib/uploads.mjs'))
  assert.ok(packed.files.some((file) => file.path === 'examples/uploads/site/index.cow'))
  assert.ok(packed.files.some((file) => file.path === 'lib/request-metadata.mjs'))
  assert.ok(packed.files.some((file) => file.path === 'lib/csv.mjs'))
  assert.ok(packed.files.some((file) => file.path === 'types/runtime.d.mts'))
  assert.ok(packed.files.some((file) => file.path === 'editor/vscode/extension.cjs'))
  assert.ok(packed.files.some((file) => file.path === 'lib/info.mjs'))
  assert.ok(packed.files.some((file) => file.path === 'examples/info/site/index.cow'))
  assert.ok(packed.files.some((file) => file.path === 'examples/mininews/site/news.cow'))
  assert.ok(packed.files.some((file) => file.path === 'lib/template-format.mjs'))
  assert.ok(packed.files.some((file) => file.path === 'editor/vscode/syntaxes/cow.json'))
  for(const path of ['lib/site-errors.mjs','lib/file-output.mjs']) assert.ok(packed.files.some(file=>file.path===path))
  for (const file of packed.files) {
    assert.doesNotMatch(file.path, /(?:^|\/)(?:node_modules|test|cache|models|anime|legacy|plugins|dragon-knight|news|metadata)\/|setup-key|\.sqlite(?:$|-)/, file.path)
    assert.doesNotMatch(file.path, /^(?:src|data|website|tools|examples-local)\/|^(?:cli|test)\.mjs$/, file.path)
  }

  await writeFile(join(dependency, 'package.json'), JSON.stringify({
    name: '@cow-package-test/app-only', version: '1.0.0', type: 'module',
    exports: { '.': './index.mjs', './feature': './feature.mjs', './cjs': './helper.cjs', './state': './state.mjs' }
  }))
  await writeFile(join(dependency, 'index.mjs'), 'export default "app-only package"; export const source = import.meta.url;\n')
  await writeFile(join(dependency, 'feature.mjs'), 'export const answer = 42;\n')
  await writeFile(join(dependency, 'helper.cjs'), 'let count=0; exports.value = "commonjs"; exports.next=()=>++count;\n')
  await writeFile(join(dependency, 'state.mjs'), 'export let count=0; export const next=()=>++count;\n')
  const appOnly = await pack(dependency)
  await writeFile(join(app, 'package.json'), JSON.stringify({ name: 'cow-install-consumer', private: true, type: 'module', imports: {'#state':'@cow-package-test/app-only/state'} }))

  t.diagnostic(`Installing ${packed.filename} with an empty cache and no user/global npm credentials.`)
  await runNpm(['install', packed.tarball, appOnly.tarball, '--no-audit', '--no-fund'])
  const installed = join(app, 'node_modules/@cowlang/cow')
  assert.equal((await lstat(installed)).isSymbolicLink(), false)
  assert.ok(inside(await realpath(app), await realpath(installed)))
  const packageInfo = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(packageInfo.name, '@cowlang/cow')
  assert.equal(packageInfo.version, packed.version)
  await writeFile(join(app,'typing.mts'), `import type {CowRequest,CowResponse,SiteError} from '@cowlang/cow/runtime';
    import {session} from '@cowlang/cow/web'; import {sqlite} from '@cowlang/cow/sqlite'; import {parseCsv} from '@cowlang/cow/csv';
    export async function page(req:CowRequest,res:CowResponse) {
      const current=await session(await sqlite(':memory:'),req,res); current.update({count:1});
      res.json(parseCsv('name,id\\nCow,001'));
    }
    export async function output(res:CowResponse,error:SiteError) {if(error.status===404) await res.download('/private/file','file.txt');await res.stream(['text',new Uint8Array([1])])}`)
  await run(['--input-type=module','--eval',`import ts from 'typescript';
    const program=ts.createProgram(['typing.mts'],{noEmit:true,strict:true,skipLibCheck:false,types:[],
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext});
    const errors=ts.getPreEmitDiagnostics(program);
    if(errors.length) throw new Error(errors.map(error=>ts.flattenDiagnosticMessageText(error.messageText,'\\n')).join('\\n'));`])
  for (const file of ['lib/http-policy.mjs', 'lib/compiler-worker.mjs', 'lib/lexer.mjs', 'lib/check.mjs', 'lib/module-source.mjs', 'lib/request-loader.mjs', 'lib/request-native.mjs', 'lib/syntax.mjs']) {
    assert.ok((await lstat(join(installed, file))).isFile(), `Missing packaged ${file}`)
  }
  const tree = JSON.parse((await runNpm(['ls', '--json', '--all'])).stdout)
  assert.equal(tree.dependencies['@cowlang/cow'].version, packed.version)
  assert.equal(tree.dependencies['@cowlang/cow'].dependencies.typescript.version, '5.9.3')
  t.diagnostic(`Installed dependencies: TypeScript ${tree.dependencies['@cowlang/cow'].dependencies.typescript.version}, Commander ${tree.dependencies['@cowlang/cow'].dependencies.commander.version}.`)

  const resolved = JSON.parse((await run(['--input-type=module', '-e', `
    import { CowApp } from '@cowlang/cow';
    import { sqlite } from '@cowlang/cow/sqlite';
    import { session } from '@cowlang/cow/web';
    import { defineResource } from '@cowlang/cow/resource';
    console.log(JSON.stringify({ types: [CowApp, sqlite, session, defineResource].map(x => typeof x),
      paths: ['@cowlang/cow', '@cowlang/cow/sqlite', '@cowlang/cow/web', '@cowlang/cow/resource', '@cow-package-test/app-only'].map(x => import.meta.resolve(x)) }));
  `])).stdout)
  assert.deepEqual(resolved.types, ['function', 'function', 'function', 'function'])
  for (const url of resolved.paths) assert.ok(inside(await realpath(app), await realpath(fileURLToPath(url))), url)
  assert.equal((await runNpm(['exec', '--offline', '--', 'cow', '--version'])).stdout.trim(), packed.version)

  // After packing, all app/runtime files come from the installed archive.
  const site = join(app, 'site')
  await cp(join(installed, 'examples/forum/site'), site, { recursive: true })
  await cp(join(installed, 'examples/forum/setup.mjs'), join(app, 'setup.mjs'))
  const cli = join(installed, packageInfo.bin.cow)
  assert.ok(inside(installed, cli))
  t.diagnostic('Checking the installed forum before setup, without executing its application code.')
  const checked = JSON.parse((await runNpm(['exec', '--offline', '--', 'cow', 'check', 'site', '--json'])).stdout)
  assert.equal(checked.exitCode, 0)
  assert.equal(checked.checked, 17)
  await assert.rejects(lstat(join(app, 'data')), { code: 'ENOENT' })
  const checkFixture = join(app, 'check fixture')
  await mkdir(checkFixture)
  await writeFile(join(checkFixture, 'safe.jsp'), `<?js import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(app, '_check-ran'))}, 'bad'); throw new Error('never execute'); ?>`)
  assert.match((await run([cli, 'check', 'check fixture/safe.jsp'])).stdout, /no syntax errors/)
  await assert.rejects(lstat(join(app, '_check-ran')), { code: 'ENOENT' })
  await writeFile(join(checkFixture, 'bad.tsp'), '<h1>Before</h1>\n<?ts const value: number = ; ?>')
  await assert.rejects(run([cli, 'check', 'check fixture', '--json']), error => {
    assert.equal(error.code, 1)
    const result = JSON.parse(error.stdout)
    assert.equal(result.checked, 2)
    assert.equal(result.errors[0].line, 2)
    assert.equal(result.errors[0].column, 28)
    assert.ok(inside(checkFixture, result.errors[0].file))
    return true
  })
  await run(['setup.mjs'])
  const setupKey = (await readFile(join(app, 'data/setup-key'), 'utf8')).trim()
  assert.ok(setupKey.length >= 32)
  await writeFile(join(site, '_probe-helper.mjs'), `
    import label, { source } from '@cow-package-test/app-only';
    let calls = 0;
    export const probe = () => ({ label, source, calls: ++calls });
  `)
  await writeFile(join(site, '_probe-types.cow'), '<?ts\nexport const typed: number = 7;\n')
  await writeFile(join(site, '_mapped.cow'), '<?ts\ninterface Removed { n: number }\nexport function fail(): never {\n  throw new Error("installed Cow location");\n}\n')
  await writeFile(join(site, 'mapped-cow.cow'), '<?js import {fail} from "./_mapped.cow"; fail();')
  await writeFile(join(site, '_mapped.ts'), 'interface Removed {\n  n: number\n}\nexport function fail(): never {\n  throw new Error("installed TS location");\n}\n')
  await writeFile(join(site, 'mapped.jsp'), `<?js import {fail} from './_mapped.ts'; fail(); ?>`)
  await writeFile(join(site, 'async-failure.jsp'), `<?js import {readFile} from 'node:fs/promises'; readFile(__dirname+'/_missing'); res.json('wrong success'); ?>`)
  await writeFile(join(site, 'csv-probe.jsp'), `<?js import {parseCsv,stringifyCsv} from '@cowlang/cow/csv'; res.json(parseCsv(stringifyCsv([['Cow, site','001']]))); ?>`)
  await writeFile(join(site, 'session-probe.jsp'), `<?js
    import { sqlite } from '@cowlang/cow/sqlite';
    import { session, setCookie, deleteCookie, pruneSessions } from '@cowlang/cow/web';
    const db = await sqlite(__dirname + '/../data/session-api.sqlite');
    const current = await session(db, req, res, {name:'cow_probe',maxAge:3600});
    if(req.get('action')==='update') current.update({count:(current.data.count||0)+1});
    if(req.get('action')==='touch') current.touch();
    if(req.get('action')==='delete') current.destroy();
    setCookie(res,'pref.theme','dark',{path:'/preferences',expires:new Date('2030-01-01T00:00:00Z')});
    deleteCookie(res,'pref.theme',{path:'/preferences'});
    res.json({data:current.data,csrf:current.csrfToken,expiry:current.expiresAt,pruned:pruneSessions(db)});
  ?>`)
  await writeFile(join(site, 'probe.jsp'), `<?js
    import { probe } from './_probe-helper.mjs';
    await include('./_probe.tsp', probe());
  `)
  await writeFile(join(site, '_probe.tsp'), `<?ts
    import { typed } from './_probe-types.cow';
    import { basename } from 'node:path';
    const { answer } = await import('@cow-package-test/app-only/feature');
    const count: number = typed;
    res.json({ ...locals, answer, typed: count, filename: basename(__filename) });
  `)
  await writeFile(join(site, 'broken.jsp'), '<p>Packaged diagnostic</p>\n<?js\nthrow new Error("package-location-check");\n')
  await writeFile(join(site, 'lexer.cow'), '<?= {valueOf(){return 10}} / 2 ?><?js const n = {valueOf(){ ?>value=<?js return 12; }} / 3; echo(n); ?>')
  await writeFile(join(site, '_probe-json.json'), '{"value":42}')
  await writeFile(join(site, 'imports.jsp'), `<?js
    import data from './_probe-json.json' with { type: 'json' };
    import cjs from '@cow-package-test/app-only/cjs';
    import * as feature from '@cow-package-test/app-only/feature';
    const [a,b]=await Promise.all([import('./_probe-helper.mjs?one'),import('./_probe-helper.mjs?two')]);
    res.json({data,cjs:cjs.value,inventedDefault:Object.hasOwn(feature,'default'),separate:a!==b,calls:[a.probe().calls,b.probe().calls]});
  ?>`)
  await writeFile(join(site, 'http-contract.jsp'), `<?js
    import { form } from '@cowlang/cow/web';
    if(req.get('json')) res.json(req.json());
    if(req.get('form')) res.json([...form(req)]);
    res.status(Number(req.get('status') || 200));
    res.setHeader('content-length','999'); res.setHeader('transfer-encoding','chunked'); res.send('hello');
  ?>`)
  await writeFile(join(site, 'contract.jsp'), `<?js
    const [a,b]=await Promise.all([import('./_probe-helper.mjs'),import('./_probe-helper.mjs')]);
    if(req.get('large')) echo('x'.repeat(65537));
    if(req.get('drain')) {
      const { setTimeout } = await import('node:timers/promises');
      const { writeFile } = await import('node:fs/promises');
      const work = cow.track(setTimeout(40).then(() => writeFile(__dirname+'/_drained', 'done')));
      await Promise.all([work, Promise.reject(new Error('installed drain failure'))]);
    }
    if (req.get('error')) {
      res.setHeader('allow','GET, HEAD'); res.setHeader('location','/success');
      const error=new Error('contract failure'); error.status=Number(req.get('error')); throw error;
    }
    res.json({same:a===b,calls:[a.probe().calls,b.probe().calls],first:req.params().id,all:req.getAll('id')});
  ?>`)
  await writeFile(join(site, 'source-too-large.jsp'), 'x'.repeat(131073))
  await writeFile(join(site, 'compile-error.tsp'), '<p>Installed compiler</p>\n<?ts const x: = 1; ?>')
  const recoveryDriver = join(app, 'node_modules', 'recovery-driver')
  await mkdir(recoveryDriver)
  await writeFile(join(recoveryDriver, 'package.json'), JSON.stringify({ name: 'recovery-driver', type: 'module', exports: './index.mjs', cow: { native: ['./index.mjs'] } }))
  await writeFile(join(recoveryDriver, 'index.mjs'), `
    import { defineResource } from '@cowlang/cow/resource';
    let opens=0;
    export const acquire=defineResource({name:'package-recovery',key:()=> 'one',open:()=>({id:++opens}),
      release(value,{options}) {if(options.fail) throw new Error('installed cleanup failure');}, close() {}});
  `)
  await writeFile(join(site, 'recover.jsp'), `<?js
    import { acquire } from 'recovery-driver';
    res.json(await acquire({fail:req.get('fail')==='1'}));
  ?>`)

  await writeFile(join(site, 'language.jsp'), `<?js
    import * as state from '@cow-package-test/app-only/state'; import * as alias from '#state';
    import cjs from '@cow-package-test/app-only/cjs'; import path from 'node:path';
    const before=process.env.COW_INSTALLED_PROBE || null; process.env.COW_INSTALLED_PROBE='changed';
    try {path.join.requestProbe='bad'} catch {}
    state.next(); res.json({same:state===alias,live:state.count,cjs:cjs.next(),before,mutated:path.join.requestProbe || null});
  ?>`)
  const uploadExample = join(app, 'upload-example')
  await cp(join(installed, 'examples/uploads/site'), join(uploadExample, 'site'), { recursive: true })
  t.diagnostic('Checking multipart uploads and explicit private saving with the installed example page.')
  await run(['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import { CowApp } from '@cowlang/cow';
    import {readFile,readdir} from 'node:fs/promises';
    const app=new CowApp({rootDir:'upload-example/site',port:0,workers:1});
    try {
      const {url}=await app.start(); const get=await fetch(url); const html=await get.text();
      assert.equal(get.status,200); assert.match(html,/enctype="multipart\\/form-data"/);
      for(const keep of [false,true]) {
        const form=new FormData(); form.append('label','<script>label</script>');
        form.append('attachment',new Blob([new Uint8Array([0,255,42])]),'../client.jsp');
        if(keep) form.append('keep','yes');
        const response=await fetch(url,{method:'POST',body:form}); const text=await response.text();
        assert.equal(response.status,200,text); assert.match(text,/&lt;script&gt;label&lt;\\/script&gt;/);
        if(!keep) await assert.rejects(readdir('upload-example/data'),{code:'ENOENT'});
      }
      const files=await readdir('upload-example/data'); assert.equal(files.length,1);
      assert.match(files[0],/^[a-f0-9-]+\\.bin$/);
      assert.deepEqual([...await readFile('upload-example/data/'+files[0])],[0,255,42]);
      const rejected=new FormData(); rejected.append('attachment',new Blob([new Uint8Array(262145)]),'large.bin');
      assert.equal((await fetch(url,{method:'POST',body:rejected})).status,413);
    } finally {await app.close()}
  `])
  assert.equal((await readdir(join(uploadExample, 'data'))).length, 1)
  await writeFile(join(site, 'metadata.jsp'), [
    '<?js',
    "res.setHeader('cache-control', 'no-store');",
    'res.json({ address: req.address(), scheme: req.scheme(), host: req.host() });',
    '?>',
    ''
  ].join('\n'))
  // Prove the embedding lifecycle against the installed archive, not imports
  // back into this checkout. Await every cancellation before exiting.
  await run(['--input-type=module', '-e', `
    import assert from 'node:assert/strict'; import { CowApp } from '@cowlang/cow';
    const app=new CowApp({rootDir:'site',port:0,workers:1});
    try {
      const cancelled=Promise.allSettled([app.start(),app.initialize()]);
      await app.close(); assert.ok((await cancelled).every(x=>x.status==='rejected'));
      const [a,b]=await Promise.all([app.start(),app.start()]); assert.deepEqual(a,b);
      const controller=new AbortController(); controller.abort(new Error('cancel installed request'));
      await assert.rejects(app.execute({url:'/probe'},{signal:controller.signal}),{code:'COW_REQUEST_CANCELLED',status:499});
      assert.equal(app.dispatcher.status().admittedRequests,0);
      assert.equal((await app.execute({url:'/probe'})).response.status,200);
      const metadata=async input=>JSON.parse(Buffer.from((await app.execute({url:'/metadata',...input})).response.body));
      assert.deepEqual(await metadata({}),{address:null,scheme:null,host:null});
      assert.deepEqual(await metadata({remoteAddress:'2001:db8::2',scheme:'https',headers:{Host:'Example.test:443'}}),
        {address:'2001:db8::2',scheme:'https',host:'example.test:443'});
      assert.deepEqual(await metadata({}),{address:null,scheme:null,host:null});
      for(let n=0;n<4;n++) {
        const result=await app.execute({url:'/language'});
        assert.deepEqual(JSON.parse(Buffer.from(result.response.body).toString()),{same:true,live:1,cjs:1,before:null,mutated:null});
      }
      assert.equal(app.runtime.status().workersSpawned,1);
      await Promise.all([app.close(),app.close()]);
      await app.start(); assert.equal((await app.execute({url:'/probe'})).response.status,200);
    } finally { await app.close(); }
  `])
  async function start(args = [cli, 'site', '--port', '0', '--workers', '2', '--mode', 'development',
      '--output-limit', '65536', '--queue-timeout', '3000', '--body-timeout', '5000',
      '--buffer-limit', '16777216', '--startup-timeout', '10000', '--restart-delay', '100',
      '--restart-max-delay', '5000', '--restart-limit', '5', '--cache-entries', '8', '--cache-bytes', '1048576',
      '--resource-limit', '8', '--adapter-limit', '16', '--namespace-limit', '64', '--source-limit', '131072',
      '--compile-timeout', '2000', '--compile-max-pending', '4', '--compiled-buffer-limit', '16777216'], cwd = app, processTree = false) {
    const child = spawn(process.execPath, args,
      { cwd, env, windowsHide: true, detached: processTree && process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Installed CLI did not start: ${output}`)), processTree ? 60_000 : 15_000)
      const read = (chunk) => {
        output = (output + chunk.toString()).slice(-20_000)
        const found = output.match(/Cow serving .* at (http:\/\/127\.0\.0\.1:\d+)/)
        if (found) { clearTimeout(timeout); resolve(found[1]) }
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.once('error', (error) => { clearTimeout(timeout); reject(error) })
      child.once('close', () => { clearTimeout(timeout); reject(new Error(`Installed CLI exited: ${output}`)) })
    })
    const stop = async () => {
      if (child.exitCode !== null || child.signalCode !== null) return closed
      // npx owns a shell and a Cow child. Stop the test-owned tree, not just npm.
      if (processTree && process.platform === 'win32') {
        await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        return closed
      }
      const signal = name => processTree ? process.kill(-child.pid, name) : child.kill(name)
      signal('SIGTERM')
      const timer = setTimeout(() => signal('SIGKILL'), 8_000)
      try { return await closed } finally { clearTimeout(timer) }
    }
    server = { stop }
    const url = await ready
    return { stop, url }
  }

  server = await start()
  const address = () => server.url
  const admin = client(address), alice = client(address), bob = client(address), visitor = client(address)
  t.diagnostic('Installed CLI is serving the copied forum; checking imports, accounts and writes.')
  // Native fetch may substitute the URL authority for a caller-supplied Host.
  // Use the HTTP client so these probes actually send the supplied header.
  const metadataRequest = headers => new Promise((resolve, reject) => {
    const req = httpRequest(address() + '/metadata', { headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => req.destroy(new Error('Installed metadata request timed out')))
    req.end()
  })
  const metadata = await metadataRequest({
    host: 'Supplied.test:443', forwarded: 'for=192.0.2.1;proto=https;host=forged.test',
    'x-forwarded-for': '192.0.2.2', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'forged.test'
  })
  assert.equal(metadata.status, 200)
  assert.deepEqual(JSON.parse(metadata.text), { address: '127.0.0.1', scheme: 'http', host: 'supplied.test:443' })
  const badHost = await metadataRequest({ host: 'invalid.test/path' })
  assert.equal(badHost.status, 400)
  assert.match(badHost.text, /COW_INVALID_HOST/)
  t.diagnostic('Installed metadata helpers preserve direct connection values and reject invalid Host input.')
  const imports = await visitor.request('/imports')
  assert.equal(imports.status, 200, imports.text)
  assert.deepEqual(JSON.parse(imports.text), { data:{value:42},cjs:'commonjs',inventedDefault:false,separate:true,calls:[1,1] })
  for(let n=0;n<6;n++) {
    const result=await visitor.request('/language'); assert.equal(result.status,200,result.text);
    assert.deepEqual(JSON.parse(result.text),{same:true,live:1,cjs:1,before:null,mutated:null});
  }
  for (const [path, method, status, allow] of [
    ['/_private','OPTIONS',404], ['/assets/site.css','OPTIONS',204,'GET, HEAD, OPTIONS'],
    ['/_cow/health','HEAD',200], ['/http-contract','HEAD',200], ['/http-contract?status=205','GET',205],
    ['/http-contract?status=204','GET',204], ['/http-contract?status=304','GET',304]
  ]) {
    const result = await fetch(address()+path,{method})
    assert.equal(result.status,status)
    if (status !== 404) assert.equal(await result.text(),'')
    else await result.arrayBuffer()
    if (allow) assert.equal(result.headers.get('allow'),allow)
    assert.equal(result.headers.get('transfer-encoding'),null)
    if ([204,304].includes(status)) assert.equal(result.headers.get('content-length'),null)
    if (status===205) assert.equal(result.headers.get('content-length'),'0')
  }
  for (const [kind, body] of [['json','{'],['form','value=%FF']]) {
    const result=await fetch(address()+'/http-contract?'+kind+'=1',{method:'POST',body,headers:{'content-type':'application/x-www-form-urlencoded'}})
    assert.equal(result.status,400,await result.text())
  }
  for (let n = 0; n < 4; n++) {
    const response = await visitor.request('/probe')
    assert.equal(response.status, 200, response.text)
    const result = JSON.parse(response.text)
    assert.deepEqual({ ...result, source: undefined }, {
      label: 'app-only package', source: undefined, calls: 1, answer: 42, typed: 7, filename: '_probe.tsp'
    })
    assert.ok(inside(join(app, 'node_modules/@cow-package-test/app-only'), fileURLToPath(result.source)), result.source)
  }
  const lexed = await visitor.request('/lexer')
  assert.equal(lexed.status, 200, lexed.text)
  assert.equal(lexed.text, '5value=4')
  const sessionStart = await fetch(address()+'/session-probe')
  assert.equal(sessionStart.status,200,await sessionStart.clone().text())
  const sessionCookie = sessionStart.headers.getSetCookie().find(value=>value.startsWith('cow_probe=')).split(';')[0]
  const sessionInitial = await sessionStart.json()
  for (let n=1;n<=3;n++) {
    const result = await fetch(address()+'/session-probe?action=update',{headers:{cookie:sessionCookie}})
    assert.equal(result.status,200,await result.clone().text())
    assert.deepEqual(await result.json(),{...sessionInitial,data:{count:n}})
    const cookies=result.headers.getSetCookie()
    assert.equal(cookies.length,2)
    assert.match(cookies[0],/^pref\.theme=dark; Path=\/preferences;/)
    assert.match(cookies[1],/^pref\.theme=; Path=\/preferences;.*Max-Age=0; Expires=/)
  }
  const renewed = await fetch(address()+'/session-probe?action=touch',{headers:{cookie:sessionCookie}})
  assert.equal(renewed.status,200,await renewed.clone().text())
  assert.equal(renewed.headers.getSetCookie()[0].split(';')[0],sessionCookie)
  await renewed.arrayBuffer()
  const ended = await fetch(address()+'/session-probe?action=delete',{headers:{cookie:sessionCookie}})
  assert.equal(ended.status,200,await ended.clone().text())
  assert.match(ended.headers.getSetCookie()[0],/Max-Age=0/)
  await ended.arrayBuffer()
  const broken = await visitor.request('/broken')
  assert.equal(broken.status, 500)
  assert.ok(broken.text.includes('broken.jsp:3:7'), broken.text)
  assert.ok(!broken.text.includes(project), 'A packaged error must not point back into the checkout')
  const mapped = await visitor.request('/mapped')
  assert.equal(mapped.status,500)
  assert.ok(mapped.text.includes('_mapped.ts:5:9'),mapped.text)
  const mappedCow = await visitor.request('/mapped-cow')
  assert.equal(mappedCow.status, 500)
  assert.ok(mappedCow.text.includes('_mapped.cow:4:9'), mappedCow.text)
  const asyncFailure = await visitor.request('/async-failure')
  assert.equal(asyncFailure.status,500)
  assert.match(asyncFailure.text,/COW_UNHANDLED_REJECTION/)
  assert.match(asyncFailure.text,/ENOENT/)
  const csv = await visitor.request('/csv-probe')
  assert.equal(csv.status,200,csv.text)
  assert.deepEqual(JSON.parse(csv.text),[['Cow, site','001']])
  const contract = await visitor.request('/contract?id=first&id=last')
  assert.equal(contract.status, 200, contract.text)
  assert.deepEqual(JSON.parse(contract.text), { same: true, calls: [1, 2], first: 'first', all: ['first', 'last'] })
  const method = await visitor.request('/contract?error=405')
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('allow'), 'GET, HEAD')
  assert.equal(method.headers.get('location'), null)
  assert.equal(method.headers.get('cache-control'), 'no-store')
  assert.equal((await visitor.request('/contract?error=-1')).status, 500)
  const tooLarge = await visitor.request('/contract?large=1')
  assert.equal(tooLarge.status, 500)
  assert.match(tooLarge.text, /COW_RESPONSE_TOO_LARGE/)
  const drained = await visitor.request('/contract?drain=1')
  assert.equal(drained.status, 500)
  assert.match(drained.text, /installed drain failure/)
  assert.equal(await readFile(join(site, '_drained'), 'utf8'), 'done')
  const runtimeStatus = JSON.parse((await visitor.request('/_cow/status')).text).application
  assert.equal(runtimeStatus.runtime.outputLimit, 65536)
  assert.equal(runtimeStatus.runtime.queueTimeout, 3000)
  assert.equal(runtimeStatus.bufferLimit, 16777216)
  assert.equal(runtimeStatus.runtime.workersCrashed, 0)
  assert.equal(runtimeStatus.compiler.maxEntries, 8)
  assert.equal(runtimeStatus.compiler.maxBytes, 1048576)
  assert.equal(runtimeStatus.compilerRuntime.readyWorkers, 1)
  assert.equal(runtimeStatus.runtime.resourceLimit, 8)
  const tooMuchSource = await visitor.request('/source-too-large')
  assert.equal(tooMuchSource.status, 500)
  assert.match(tooMuchSource.text, /COW_SOURCE_TOO_LARGE/)
  const badCompile = await visitor.request('/compile-error')
  assert.equal(badCompile.status, 500)
  assert.match(badCompile.text, /compile-error\.tsp:2:/)
  // Fill both workers' reusable adapter entries, fail cleanup, then verify the
  // installed bridge discarded an instance and can open a healthy replacement.
  for (let n=0;n<4;n++) assert.equal((await visitor.request('/recover')).status, 200)
  assert.equal((await visitor.request('/recover?fail=1')).status, 500)
  assert.equal((await visitor.request('/recover')).status, 200)
  const recoveredStatus = JSON.parse((await visitor.request('/_cow/status')).text).application
  assert.equal(recoveredStatus.runtime.resources.adapters['package-recovery'].releaseFailures, 1)
  assert.equal(recoveredStatus.runtime.resources.adapters['package-recovery'].closes, 1)
  assert.equal((await visitor.request('/assets/site.css')).status, 200)
  for (const path of ['/_db.cow', '/_probe.tsp', '/data/forum.sqlite']) assert.equal((await visitor.request(path)).status, 404)

  const credentials = (page, username) => ({ csrf: hidden(page, 'csrf'), username, password, confirmPassword: password })
  redirect(await admin.request('/install', { ...credentials(await admin.request('/install'), 'Keeper'), setupKey }))
  assert.equal((await admin.request('/install')).status, 409)
  for (const [c, username] of [[alice, 'Alice'], [bob, 'Bob']]) {
    redirect(await c.request('/register', credentials(await c.request('/register'), username)))
    redirect(await c.request('/login', credentials(await c.request('/login'), username)))
  }
  const compose = (page, extra) => ({ csrf: hidden(page, 'csrf'), creationKey: hidden(page, 'creationKey'), ...extra })
  const form = await alice.request('/new')
  const draft = compose(form, { title: 'A standalone Cow forum', body: 'The package works outside its checkout.' })
  const location = redirect(await alice.request('/new', draft))
  assert.equal(redirect(await alice.request('/new', draft)), location)
  const topicId = new URL(location, server.url).searchParams.get('id')
  const route = `/topic?id=${topicId}`
  const replyLocation = redirect(await bob.request(route, compose(await bob.request(route), { body: 'A separate member can reply.' })))
  const postId = new URL(replyLocation, server.url).hash.replace('#post-', '')
  assert.equal((await alice.request(`/edit?id=${postId}`)).status, 403)
  const edit = await bob.request(`/edit?id=${postId}`)
  redirect(await bob.request(`/edit?id=${postId}`, {
    csrf: hidden(edit, 'csrf'), version: hidden(edit, 'version'), body: 'The edited reply persists.'
  }))
  const aliceSession = alice.cookie, bobSession = bob.cookie
  assert.match((await visitor.request(route)).text, /The edited reply persists/)

  t.diagnostic('Stopping the installed CLI, then restarting against the same application data.')
  await server.stop()
  server = await start()
  assert.equal((await alice.request('/new')).status, 200)
  assert.equal((await bob.request(`/edit?id=${postId}`)).status, 200)
  assert.equal(alice.cookie, aliceSession)
  assert.equal(bob.cookie, bobSession)
  const restored = await visitor.request(route)
  assert.equal(restored.status, 200)
  assert.match(restored.text, /A standalone Cow forum/)
  assert.match(restored.text, /The edited reply persists/)
  redirect(await bob.request(route, compose(await bob.request(route), { body: 'Writes still work after restart.' })))
  assert.match((await visitor.request(route)).text, /Writes still work after restart/)
  const desk = await alice.request('/')
  redirect(await alice.request('/logout', { csrf: hidden(desk, 'csrf') }))
  assert.equal((await alice.request('/new')).headers.get('location'), '/login')
  await cp(join(installed,'examples/info/site/index.cow'),join(site,'info-probe.cow'))
  const info=await visitor.request('/info-probe');assert.equal(info.status,200);assert.match(info.text,/<h1>Cow Version /)
  assert.equal(info.headers.get('cache-control'),'no-store');assert.ok(!info.text.includes(project));assert.ok(!info.text.includes(site))
  await writeFile(join(site,'info-json.jsp'),'<?js cow.info({format:"json"}) ?>')
  const infoJson=JSON.parse((await visitor.request('/info-json')).text)
  assert.equal(infoJson.runtime.cow,packed.version);assert.equal(infoJson.runtime.typescript,'5.9.3');assert.equal(infoJson.configuration.bufferedOutputLimitBytes,65536)
  // Only one source file is needed, copied out of the installed package and
  // renamed. Its schema, private setup key and editor all come from that file.
  await cp(join(installed,'examples/mininews/site/news.cow'),join(site,'mininews.cow'))
  const mini=client(address,'mn_'), miniSetup=await mini.request('/mininews')
  assert.equal(miniSetup.status,200,miniSetup.text)
  const miniKey=(await readFile(join(site,'_mininews.setup-key'),'utf8')).trim()
  assert.ok(!miniSetup.text.includes(miniKey))
  redirect(await mini.request('/mininews',{action:'setup',csrf:hidden(miniSetup,'csrf'),setupKey:miniKey,username:'editor',password,confirmPassword:password}))
  const miniLogin=await mini.request('/mininews?view=login')
  redirect(await mini.request('/mininews?view=login',{action:'login',csrf:hidden(miniLogin,'csrf'),username:'editor',password}))
  const miniNew=await mini.request('/mininews?view=new')
  const miniLocation=redirect(await mini.request('/mininews?view=new',{action:'save',csrf:hidden(miniNew,'csrf'),
    creationKey:hidden(miniNew,'creationKey'),version:hidden(miniNew,'version'),title:'Installed MiniNews',summary:'',body:'Hello **Markdown**. <script>inert</script>',state:'published'}))
  assert.match(miniLocation,/^\/mininews\?view=edit/)
  const miniArticle=await mini.request('/mininews?id=1')
  assert.equal(miniArticle.status,200,miniArticle.text);assert.match(miniArticle.text,/<strong>Markdown<\/strong>/)
  assert.match(miniArticle.text,/&lt;script&gt;inert/)
  assert.equal((await mini.request('/_mininews.sqlite')).status,404)
  t.diagnostic('Installed single-file MiniNews: setup, login, publish and safe Markdown verified.')
  // Add the handler only after the existing diagnostics/forum probes, so their
  // fallback assertions remain independent of this convention.
  await writeFile(join(site,'_download.bin'),Buffer.alloc(200_000,97))
  await writeFile(join(site,'download-probe.jsp'),'<?js await res.download(__dirname+"/_download.bin","résumé.bin"); ?>')
  await writeFile(join(site,'stream-probe.jsp'),'<?js await res.stream((async function*(){yield "begin";yield new Uint8Array(100000);yield "end"})()); ?>')
  const download=await visitor.request('/download-probe')
  assert.equal(download.status,200);assert.equal(download.text.length,200_000);assert.equal(download.headers.get('content-length'),'200000')
  assert.match(download.headers.get('content-disposition'),/filename\*=UTF-8''r%C3%A9sum%C3%A9.bin/)
  const stream=await visitor.request('/stream-probe');assert.equal(stream.status,200);assert.equal(stream.text.length,100008);assert.equal(stream.headers.get('content-length'),null)
  await writeFile(join(site,'_error.jsp'),'<?js res.type("text"); ?>Site error <?= locals.error.status ?>')
  await writeFile(join(site,'error-probe.jsp'),'<?js throw new Error("installed handler secret"); ?>')
  const handled=await visitor.request('/error-probe');assert.equal(handled.status,500);assert.equal(handled.text,'Site error 500')
  assert.equal((await visitor.request('/missing-handler-probe')).text,'Site error 404')
  await server.stop()

  // Run the single-bin package via real npx, outside any npm project. Use the
  // packed release and the isolated cache above, never a published Cow package.
  const plain = join(root, 'plain consumer'), plainSite = join(plain, 'my-site')
  await mkdir(plainSite, { recursive: true })
  const plainPage = `<?js
    import {sqlite} from '@cowlang/cow/sqlite';
    import {session} from '@cowlang/cow/web';
    import {parseCsv} from '@cowlang/cow/csv';
    const current=await session(await sqlite(__dirname+'/_data.sqlite'),req,res,{name:'plain_session'});
    current.update({visits:(current.data.visits||0)+1});
    res.json({visits:current.data.visits,csv:parseCsv('Cow,001')});
  `
  await writeFile(join(plainSite, 'index.cow'), plainPage)
  const npx = join(dirname(npm), 'npx-cli.js')
  const npxArgs = [npx, '--yes', '--offline', '--package', packed.tarball, 'cow']
  t.diagnostic('Running npx with a plain site: no local package.json, node_modules or Cow install.')
  assert.equal((await run([...npxArgs, '--version'], plain)).stdout.trim(), packed.version)
  const plainCheck = JSON.parse((await run([...npxArgs, 'check', 'my-site', '--json'], plain)).stdout)
  assert.equal(plainCheck.exitCode, 0)
  assert.equal(plainCheck.checked, 1)
  server = await start([...npxArgs, 'my-site', '--port', '0', '--workers', '1'], plain, true)
  const plainClient = client(() => server.url, 'plain_session=')
  for (let visits = 1; visits <= 2; visits++) {
    const page = await plainClient.request('/')
    assert.equal(page.status, 200, page.text)
    assert.deepEqual(JSON.parse(page.text), { visits, csv: [['Cow', '001']] })
  }
  assert.equal((await plainClient.request('/_data.sqlite')).status, 404)
  assert.equal(await readFile(join(plainSite, 'index.cow'), 'utf8'), plainPage)
  assert.deepEqual(await readdir(plain), ['my-site'])
  await assert.rejects(lstat(join(plainSite, 'package.json')), { code: 'ENOENT' })
  await assert.rejects(lstat(join(plainSite, 'node_modules')), { code: 'ENOENT' })
  t.diagnostic(`PASS: ${packed.filename}, ${packed.files.length} packaged files; project install, npx, imports, forum, sessions and restart verified.`)
})
