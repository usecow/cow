import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { CowApp } from '../../../lib/app.mjs'
import { verifyPassword } from '../../../lib/web.mjs'

const project = fileURLToPath(new URL('../../../', import.meta.url))
const password = 'Disposable MiniNews test passphrase'
async function fixture(t, name = 'news') {
  const root = await mkdtemp(join(tmpdir(), 'cow-mininews-test-'))
  const site = join(root, 'site'), path = '/' + name, stem = name.split('/').at(-1)
  const directory = dirname(join(site, name + '.cow'))
  let app, url
  t.after(async () => {
    await app?.close()
    assert.equal(dirname(root), tmpdir())
    assert.ok(root.split(/[\\/]/).at(-1).startsWith('cow-mininews-test-'))
    await rm(root, {recursive:true, force:true})
  })
  await mkdir(directory, {recursive:true})
  await cp(join(project, 'examples/mininews/site/news.cow'), join(site, name + '.cow'))
  const installed = join(root, 'node_modules/@cowlang/cow')
  await mkdir(installed, {recursive:true})
  await cp(join(project, 'package.json'), join(installed, 'package.json'))
  await cp(join(project, 'lib'), join(installed, 'lib'), {recursive:true})
  await writeFile(join(site, 'index.cow'), `<?js res.header('x-parent','kept'); ?><h1>My website</h1><?js await include(${JSON.stringify('./' + name + '.cow')}, {mode:'feed',url:${JSON.stringify(path)},limit:2}) ?><p>After news</p>`)
  async function start() {
    app = new CowApp({rootDir:site,host:'127.0.0.1',port:0,workers:2,logger:{error(){}}})
    url = (await app.start()).url
  }
  await start()
  return {
    site, path, get url() { return url },
    key: () => readFile(join(directory, '_' + stem + '.setup-key'), 'utf8'),
    async restart() { await app.close(); await start() },
    db(callback) {
      const db = new DatabaseSync(join(directory, '_' + stem + '.sqlite'))
      try { return callback(db) } finally { db.close() }
    }
  }
}
function client(f) {
  let cookie = ''
  return {
    get cookie() { return cookie }, set cookie(value) { cookie = value },
    async request(path = f.path, values, headers = {}) {
      const response = await fetch(f.url + path, {
        redirect:'manual',method:values === undefined ? 'GET' : 'POST',
        headers:{...(cookie ? {cookie} : {}),...headers},
        body:values === undefined ? undefined : new URLSearchParams(values), signal:AbortSignal.timeout(15000)
      })
      for (const item of response.headers.getSetCookie()) if (item.startsWith('mn_')) cookie = item.split(';')[0]
      return {status:response.status,headers:response.headers,text:await response.text()}
    }
  }
}
function hidden(page, name) {
  const match = page.text.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `Missing ${name}, HTTP ${page.status}: ${page.text.slice(0,1500)}`)
  return match[1]
}
function redirect(page) { assert.equal(page.status,303,page.text); return page.headers.get('location') }
async function install(f,c) {
  const page = await c.request()
  assert.equal(page.status,200,page.text)
  redirect(await c.request(f.path,{action:'setup',csrf:hidden(page,'csrf'),setupKey:await f.key(),username:'editor',password,confirmPassword:password}))
}
async function login(f,c) {
  const page = await c.request(f.path+'?view=login')
  redirect(await c.request(f.path+'?view=login',{action:'login',csrf:hidden(page,'csrf'),username:'editor',password}))
}
function editForm(page, extra = {}) {
  return {action:'save',csrf:hidden(page,'csrf'),version:hidden(page,'version'),creationKey:hidden(page,'creationKey'),
    title:'A first story',summary:'',body:'Hello **Cow**.',state:'draft',...extra}
}
const count = f => f.db(db => db.prepare('SELECT count(*) AS n FROM mn_posts').get().n)

test('MiniNews single-file setup, Markdown preview, drafts, publish, embed and restart work', async t => {
  const f=await fixture(t), c=client(f), visitor=client(f)
  const empty=await visitor.request('/')
  assert.match(empty.text,/No news published yet/)
  assert.equal(empty.headers.get('set-cookie'),null)
  await install(f,c)
  const hash=f.db(db=>db.prepare('SELECT password_hash FROM mn_account').get().password_hash)
  assert.notEqual(hash,password);assert.equal(await verifyPassword(password,hash),true)
  assert.equal((await c.request(f.path+'?view=setup')).status,409)
  const anonymous=c.cookie
  await login(f,c);assert.notEqual(c.cookie,anonymous)
  assert.equal((await visitor.request(f.path+'?view=admin')).headers.get('location'),f.path+'?view=login')
  const page=await c.request(f.path+'?view=new'), draft=editForm(page)
  const preview=await c.request(f.path+'?view=new',{...draft,action:'preview'})
  assert.equal(preview.status,200,preview.text);assert.match(preview.text,/Preview — not saved/)
  assert.match(preview.text,/<strong>Cow<\/strong>/);assert.equal(count(f),0)
  const location=redirect(await c.request(f.path+'?view=new',draft))
  assert.equal(redirect(await c.request(f.path+'?view=new',draft)),location)
  assert.equal(count(f),1)
  assert.equal((await visitor.request(f.path+'?id=1')).status,404)
  const route=f.path+'?view=edit&id=1'
  redirect(await c.request(route,editForm(await c.request(route),{state:'published'})))
  const publicPage=await visitor.request(f.path+'?id=1')
  assert.equal(publicPage.status,200,publicPage.text);assert.match(publicPage.text,/<strong>Cow<\/strong>/)
  assert.equal(publicPage.headers.get('set-cookie'),null)
  const css=publicPage.text.match(/<style>([\s\S]*?)<\/style>/)[1]
  assert.ok(publicPage.headers.get('content-security-policy').includes(createHash('sha256').update(css).digest('base64')))
  const feed=await visitor.request('/?view=delete&id=1',{action:'delete'})
  assert.equal(feed.status,200,feed.text);assert.equal(feed.headers.get('x-parent'),'kept')
  assert.equal(feed.headers.get('set-cookie'),null);assert.equal(feed.headers.get('content-security-policy'),null)
  assert.match(feed.text,/<h1>My website<\/h1>/);assert.match(feed.text,/<p>After news<\/p>/)
  assert.match(feed.text,/<strong>Cow<\/strong>/);assert.doesNotMatch(feed.text,/<!doctype|<form|Manage news/)
  assert.equal(count(f),1)
  await f.restart()
  assert.equal((await c.request(route)).status,200)
  assert.match((await visitor.request(f.path+'?id=1')).text,/A first story/)
  redirect(await c.request(route,editForm(await c.request(route),{state:'draft'})))
  assert.equal((await visitor.request(f.path+'?id=1')).status,404)
  assert.doesNotMatch((await visitor.request('/')).text,/A first story/)
  const identity=c.cookie
  const logout=await c.request(f.path+'?view=admin',{action:'logout',csrf:hidden(await c.request(route),'csrf')})
  redirect(logout);assert.match(logout.headers.get('set-cookie'),/Path=\/news;.*Max-Age=0/)
  c.cookie=identity
  assert.equal((await c.request(route)).headers.get('location'),f.path+'?view=login')
})

test('MiniNews Markdown is formatted but raw HTML, Cow code and unsafe links stay inert', async t => {
  const f=await fixture(t),c=client(f)
  await install(f,c);await login(f,c)
  const body=['# Heading','', '**bold** and *italic* and `a < b`', '', '- one', '- two', '',
    '1. first','2. second','','> quoted **text**','','```js','<script>alert(1)</script>','```','',
    '<img src=x onerror=alert(1)>','<?js throw new Error("article executed") ?>','',
    '[good](https://example.com/a?x=1&y=2) [local](/about) [mail](mailto:a@example.com)',
    '[bad](javascript:alert%281%29) [data](data:text/html;base64,xxx) [relative](//evil.test)',
    '[encoded](javascript&#58;alert) [slash](/\\evil.test) [attribute](https://example.com/"onclick="evil)'].join('\n')
  const page=await c.request(f.path+'?view=new'),form=editForm(page,{title:'<script>Title</script>',body,state:'published'})
  const preview=await c.request(f.path+'?view=new',{...form,action:'preview'})
  redirect(await c.request(f.path+'?view=new',form))
  const article=await c.request(f.path+'?id=1')
  for(const result of [preview,article]) {
    assert.equal(result.status,200,result.text)
    for(const html of ['<h1>Heading</h1>','<strong>bold</strong>','<em>italic</em>','<code>a &lt; b</code>',
      '<ul><li>one</li><li>two</li></ul>','<ol><li>first</li><li>second</li></ol>',
      '<blockquote><p>quoted <strong>text</strong></p></blockquote>','<pre><code>&lt;script&gt;',
      'href="https://example.com/a?x=1&amp;y=2"','href="/about"','href="mailto:a@example.com"']) assert.ok(result.text.includes(html),html)
    // Only the fixed, CSP-hashed enhancement script may execute in the editor.
    const scripts=[...result.text.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    assert.equal(scripts.length,result===preview?1:0)
    for(const script of scripts) assert.ok(result.headers.get('content-security-policy').includes(createHash('sha256').update(script[1]).digest('base64')))
    const content=result.text.replace(/<script>[\s\S]*?<\/script>/g,'')
    assert.doesNotMatch(content,/<script|<img|<\?js|href="(?:javascript|data|\/\/)|"onclick="evil/)
    assert.match(result.text,/&lt;script&gt;Title/)
  }
  assert.equal(f.db(db=>db.prepare('SELECT body FROM mn_posts').get().body),body)
})

test('MiniNews rejects stale updates/deletes, retains submitted text and requires deletion confirmation', async t => {
  const f=await fixture(t),c=client(f),other=client(f)
  await install(f,c);await login(f,c);await login(f,other)
  redirect(await c.request(f.path+'?view=new',editForm(await c.request(f.path+'?view=new'))))
  const route=f.path+'?view=edit&id=1',del=f.path+'?view=delete&id=1'
  const stale=editForm(await other.request(route),{title:'Retain my work'})
  const oldDelete=await other.request(del)
  redirect(await c.request(route,editForm(await c.request(route),{title:'New version',state:'published'})))
  const before=f.db(db=>db.prepare('SELECT * FROM mn_posts').get())
  const conflict=await other.request(route,stale)
  assert.equal(conflict.status,409);assert.match(conflict.text,/Retain my work/)
  assert.equal((await c.request(route,editForm(await c.request(route),{action:'preview',title:'Not stored'}))).status,200)
  assert.deepEqual(f.db(db=>db.prepare('SELECT * FROM mn_posts').get()),before)
  assert.equal((await other.request(del,{action:'delete',csrf:hidden(oldDelete,'csrf'),version:hidden(oldDelete,'version'),confirm:'yes'})).status,409)
  const confirmation=await c.request(del)
  assert.equal(count(f),1)
  const values={action:'delete',csrf:hidden(confirmation,'csrf'),version:hidden(confirmation,'version')}
  assert.equal((await c.request(del,values)).status,422)
  assert.equal((await c.request(del,{...values,csrf:'forged',confirm:'yes'})).status,403)
  redirect(await c.request(del,{...values,confirm:'yes'}));assert.equal(count(f),0)
})

test('MiniNews validates setup, CSRF, form limits, methods, routes and private files', async t => {
  const f=await fixture(t),c=client(f)
  const setup=await c.request(),key=await f.key()
  assert.match(key,/^[a-f0-9]{64}$/);assert.ok(!setup.text.includes(key))
  const credentials={action:'setup',csrf:hidden(setup,'csrf'),setupKey:key,username:'editor',password,confirmPassword:password}
  assert.equal((await c.request(f.path,{...credentials,csrf:'bad'})).status,403)
  assert.equal((await c.request(f.path,{...credentials,setupKey:'wrong'})).status,403)
  assert.equal((await c.request(f.path,{...credentials,password:'short',confirmPassword:'short'})).status,422)
  assert.equal((await c.request(f.path,{...credentials,confirmPassword:'no'})).status,422)
  assert.equal((await c.request(f.path,{...credentials,username:'<bad>'})).status,422)
  redirect(await c.request(f.path,credentials));await login(f,c)
  for(const route of ['/_news.sqlite','/_news.setup-key','/news?view=feed','/news?id=0','/news?id=abc']) {
    assert.ok([400,404].includes((await c.request(route)).status),route)
  }
  const form=editForm(await c.request(f.path+'?view=new'))
  for(const [extra,status] of [[{csrf:'bad'},403],[{title:''},422],[{title:'x'.repeat(161)},422],
    [{body:'x'.repeat(20001)},422],[{summary:'x'.repeat(501)},422],[{state:'anything'},422],[{creationKey:'bad'},400],[{action:'no'},400]]) {
    assert.equal((await c.request(f.path+'?view=new',{...form,...extra})).status,status,JSON.stringify(extra).slice(0,200))
  }
  const duplicate=new URLSearchParams(form);duplicate.append('title','second')
  assert.equal((await c.request(f.path+'?view=new',duplicate)).status,400)
  assert.equal((await c.request(f.path+'?view=new',form,{'content-type':'text/plain'})).status,415)
  const post=await c.request(f.path,{action:'delete',id:'1'})
  assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD')
  const put=await fetch(f.url+f.path,{method:'PUT'});assert.equal(put.status,405);await put.arrayBuffer()
  const head=await fetch(f.url+f.path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'')
  assert.equal(count(f),0)
})

test('MiniNews login limit persists across restart and expired sessions cannot write', async t => {
  const f=await fixture(t),c=client(f),attacker=client(f)
  await install(f,c);await login(f,c)
  const desk=await c.request(f.path+'?view=admin'),page=await attacker.request(f.path+'?view=login')
  for(let n=0;n<8;n++) assert.equal((await attacker.request(f.path+'?view=login',{action:'login',csrf:hidden(page,'csrf'),username:'unknown'+n,password:'incorrect'})).status,401)
  await f.restart()
  assert.equal((await attacker.request(f.path+'?view=login',{action:'login',csrf:hidden(page,'csrf'),username:'editor',password})).status,429)
  assert.equal(f.db(db=>db.prepare('SELECT count(*) AS n FROM mn_attempts').get().n),1)
  assert.equal((await c.request(f.path+'?view=admin')).status,200)
  f.db(db=>db.exec('UPDATE mn_attempts SET until_at=0; UPDATE jin_sessions SET expires_at=0'))
  assert.equal((await c.request(f.path+'?view=admin',{action:'logout',csrf:hidden(desk,'csrf')})).status,303)
  await login(f,attacker)
  assert.equal(f.db(db=>db.prepare('SELECT count(*) AS n FROM mn_attempts').get().n),0)
})

test('MiniNews works renamed/nested, pages/searches news and limits included feeds', async t => {
  const f=await fixture(t,'updates/bulletin'),c=client(f),visitor=client(f)
  await install(f,c);await login(f,c)
  const desk=await c.request(f.path+'?view=admin')
  assert.match(desk.text,/updates\/bulletin/)
  for(let n=0;n<12;n++) {
    redirect(await c.request(f.path+'?view=new',editForm(await c.request(f.path+'?view=new'),{title:'News '+n,state:n===11?'draft':'published'})))
  }
  const first=await visitor.request(),second=await visitor.request(f.path+'?page=2')
  assert.equal(first.status,200,first.text);assert.equal(first.text.match(/<article /g).length,10)
  assert.equal(second.text.match(/<article /g).length,1);assert.match(second.text,/Page 2 of 2/)
  assert.doesNotMatch(first.text,/News 11/)
  const search=await c.request(f.path+'?view=admin&q=News+11')
  assert.match(search.text,/News 11/);assert.doesNotMatch(search.text,/News 10/)
  const feed=await visitor.request('/')
  assert.equal(feed.text.match(/<article /g).length,2)
  assert.match(feed.text,/href="\/updates\/bulletin\?id=/)
  const anon=client(f),loginPage=await anon.request(f.path+'?view=login')
  assert.match(loginPage.headers.get('set-cookie'),/Path=\/updates\/bulletin;/)
  assert.equal((await visitor.request('/updates/_bulletin.setup-key')).status,404)
  for(const [url,limit] of [['//evil.test',2],['/news',0]]) {
    await writeFile(join(f.site,'invalid.cow'),`<?js await include('./updates/bulletin.cow',{mode:'feed',url:${JSON.stringify(url)},limit:${limit}}) ?>`)
    assert.equal((await visitor.request('/invalid')).status,500)
  }
})

test('MiniNews concurrent setup, double submissions and edits serialize across workers', async t => {
  const f=await fixture(t),a=client(f),b=client(f)
  const pages=[await a.request(),await b.request()],key=await f.key()
  const setup=await Promise.all([a,b].map((c,i)=>c.request(f.path+'?view=setup',{
    action:'setup',csrf:hidden(pages[i],'csrf'),setupKey:key,username:'editor',password,confirmPassword:password
  })))
  assert.deepEqual(setup.map(p=>p.status).sort(),[303,409])
  assert.equal(f.db(db=>db.prepare('SELECT count(*) AS n FROM mn_account').get().n),1)
  await login(f,a);await login(f,b)
  const form=editForm(await a.request(f.path+'?view=new'))
  const writes=await Promise.all([a.request(f.path+'?view=new',form),a.request(f.path+'?view=new',form)])
  assert.equal(redirect(writes[0]),redirect(writes[1]));assert.equal(count(f),1)
  const route=f.path+'?view=edit&id=1'
  const one=editForm(await a.request(route),{title:'Writer one',state:'published'})
  const two=editForm(await b.request(route),{title:'Writer two',state:'published'})
  const edits=await Promise.all([a.request(route,one),b.request(route,two)])
  assert.deepEqual(edits.map(p=>p.status).sort(),[303,409])
  assert.equal(f.db(db=>db.prepare('SELECT version FROM mn_posts').get().version),2)
})

test('MiniNews dashboard uses stored counts, private help and a server-rendered writing desk', async t => {
  const f=await fixture(t),c=client(f),visitor=client(f)
  await install(f,c);await login(f,c)
  for(const view of ['dashboard','help']) assert.equal((await visitor.request(f.path+'?view='+view)).headers.get('location'),f.path+'?view=login')
  const empty=await c.request(f.path+'?view=dashboard')
  assert.equal(empty.status,200,empty.text);assert.match(empty.text,/No stories yet/)
  assert.match(empty.text,/<dt>Total stories<\/dt><dd>0<\/dd>/)
  assert.match(empty.text,/<a href="\/news\?view=dashboard" aria-current="page">Dashboard/)
  for(const state of ['published','draft']) redirect(await c.request(f.path+'?view=new',editForm(await c.request(f.path+'?view=new'),{state})))
  const dashboard=await c.request(f.path+'?view=dashboard')
  assert.match(dashboard.text,/<dt>Total stories<\/dt><dd>2<\/dd>/)
  assert.match(dashboard.text,/<dt>Published<\/dt><dd>1<\/dd>/)
  assert.match(dashboard.text,/<dt>In draft<\/dt><dd>1<\/dd>/)
  assert.doesNotMatch(dashboard.text,/<script|href="https?:/)
  const guide=await c.request(f.path+'?view=help')
  assert.equal(guide.status,200);assert.match(guide.text,/&lt;\?js await include/)
  assert.match(guide.text,/Media uploads, comments and scheduled publishing are not included/)
  const desk=await c.request(f.path+'?view=edit&id=1')
  assert.match(desk.text,/data-editor-toolbar="body"[^>]* hidden/)
  assert.match(desk.text,/type="button" data-format="bold"/)
  assert.match(desk.text,/aria-current="page">Edit news/)
  const preview=await c.request(f.path+'?view=edit&id=1',editForm(desk,{action:'preview',summary:'A **short** story',body:'The *full* story'}))
  assert.match(preview.text,/A <strong>short<\/strong> story/)
  assert.match(preview.text,/The <em>full<\/em> story/)
  assert.match(preview.text,/href="#title">Return to editing/)
  assert.match(preview.text,/aria-describedby="publication-help"/)
  assert.equal(f.db(db=>db.prepare('SELECT version FROM mn_posts WHERE id=1').get().version),1)
})

test('MiniNews optional toolbar inserts literal Markdown, preserves selection and respects field limits', async t => {
  const f=await fixture(t),c=client(f)
  await install(f,c);await login(f,c)
  const desk=await c.request(f.path+'?view=new')
  const script=desk.text.match(/<script>([\s\S]*?)<\/script>/)[1]
  assert.ok(desk.headers.get('content-security-policy').includes(createHash('sha256').update(script).digest('base64')))
  assert.doesNotMatch(desk.headers.get('content-security-policy'),/unsafe-inline|unsafe-eval/)
  const buttons=['bold','italic','heading','list','quote','link','code'].map(format=>({dataset:{format},addEventListener(type,fn){assert.equal(type,'click');this.click=fn}}))
  let focused=false,inputs=0
  const field={value:'hello',selectionStart:0,selectionEnd:5,maxLength:20000,
    focus(){focused=true},setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=start;this.selectionEnd=start+text.length},
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end},dispatchEvent(event){assert.equal(event.type,'input');inputs++}}
  const note={textContent:''},toolbar={hidden:true,dataset:{editorToolbar:'body'},querySelectorAll:()=>buttons}
  runInNewContext(script,{document:{querySelectorAll:()=>[toolbar],getElementById:id=>id==='body'?field:note},Event:class{constructor(type){this.type=type}}})
  assert.equal(toolbar.hidden,false)
  const insert=(format,value,start=0,end=value.length)=>{field.value=value;field.selectionStart=start;field.selectionEnd=end;buttons.find(b=>b.dataset.format===format).click();return field.value}
  assert.equal(insert('bold','hello'),'**hello**');assert.equal(field.selectionStart,2);assert.equal(field.selectionEnd,7)
  assert.equal(insert('italic','hello'),'*hello*')
  assert.equal(insert('heading','hello'),'## hello')
  assert.equal(insert('list','one\ntwo'),'- one\n- two')
  assert.equal(insert('quote','a\nb',2,3),'a\n> b')
  assert.equal(insert('heading','\ntext',0,0),'## \ntext')
  assert.equal(insert('link','hello'),'[hello](https://example.com)')
  assert.equal(field.value.slice(field.selectionStart,field.selectionEnd),'https://example.com')
  assert.equal(insert('code','<script>'),'`<script>`')
  assert.equal(focused,true);assert.equal(inputs,8)
  field.maxLength=5
  assert.equal(insert('bold','hello'),'hello');assert.match(note.textContent,/exceed/)
  assert.equal(inputs,8)
})

test('MiniNews Nordic design retains keyboard access, safe action roles and contrasting appearance palettes', async t => {
  const f=await fixture(t),c=client(f)
  await install(f,c);await login(f,c)
  const page=await c.request(f.path+'?view=new')
  assert.match(page.text,/<a class="skip-link" href="#main-content">Skip to content<\/a>/)
  assert.match(page.text,/id="main-content" tabindex="-1"/)
  assert.match(page.text,/<button class="primary" name="action" value="save">Save news<\/button>/)
  const css=page.text.match(/<style>([\s\S]*?)<\/style>/)[1]
  assert.match(css,/system-ui,-apple-system,BlinkMacSystemFont/)
  assert.match(css,/Georgia,"Times New Roman",serif/)
  assert.match(css,/--paper:#fdfdf9/)
  assert.match(css,/--accent:#365d4b/)
  assert.doesNotMatch(css,/border-radius:(?:7|8|10|12|14)px|--shadow:/)
  assert.match(css,/prefers-color-scheme:dark/)
  assert.match(css,/prefers-contrast:more/)
  assert.match(css,/forced-colors:active/)
  assert.match(css,/:focus-visible\{outline:3px solid var\(--focus\)/)
  assert.match(css,/button:active/)
  assert.match(css,/min-height:44px/)
  assert.doesNotMatch(css,/font-face|https?:|transition:all|animation:/)
  const luminance=hex=>{
    const rgb=hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4)
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
  }
  const contrast=(a,b)=>{const one=luminance(a),two=luminance(b);return (Math.max(one,two)+.05)/(Math.min(one,two)+.05)}
  const palettes=[...css.matchAll(/:root\s*\{([^}]+)\}/g)].slice(0,2).map(match=>Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})(?:;|\s)/g)].map(item=>[item[1],item[2]])))
  assert.equal(palettes.length,2)
  for(const palette of palettes) {
    for(const [fg,bg] of [['ink','paper'],['ink','wash'],['muted','paper'],['muted','wash'],['accent','paper'],['accent','wash'],
      ['positive','positive-bg'],['draft','draft-bg'],['danger','danger-bg'],['danger-hover','danger-bg']]) {
      assert.ok(contrast(palette[fg],palette[bg])>=4.5,`${fg}/${bg}: ${JSON.stringify(palette)}`)
    }
    for(const bg of ['primary','primary-pressed']) assert.ok(contrast('#ffffff',palette[bg])>=4.5,bg)
    for(const fg of ['control','focus']) assert.ok(contrast(palette[fg],palette.paper)>=3,fg)
  }
  redirect(await c.request(f.path+'?view=new',editForm(page)))
  const saved=await c.request(f.path+'?view=edit&id=1&saved=1')
  assert.match(saved.text,/role="status">News saved\. This draft is only visible to you\./)
  const deletion=await c.request(f.path+'?view=delete&id=1')
  assert.match(deletion.text,/<label class="confirmation"><input type="checkbox" name="confirm" value="yes" required>/)
  assert.match(deletion.text,/<button class="danger" name="action" value="delete">Delete news<\/button>/)
  assert.doesNotMatch(deletion.text,/<button class="primary"/)
  assert.equal(count(f),1)
})
