// Disposable, loopback-only browser demo. Never changes the shipped example.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CowApp } from '../../../lib/app.mjs'

const project=fileURLToPath(new URL('../../../',import.meta.url))
const root=await mkdtemp(join(tmpdir(),'cow-mininews-preview-')),site=join(root,'site')
await mkdir(site)
await cp(join(project,'examples/mininews/site/news.cow'),join(site,'news.cow'))
const installed=join(root,'node_modules/@cowlang/cow')
await mkdir(installed,{recursive:true})
await cp(join(project,'package.json'),join(installed,'package.json'))
await cp(join(project,'lib'),join(installed,'lib'),{recursive:true})
const app=new CowApp({rootDir:site,host:'127.0.0.1',port:0,workers:2})
const {url}=await app.start()
let stopping=false
async function stop() {
  if(stopping)return
  stopping=true
  await app.close()
  assert.equal(dirname(root),tmpdir())
  assert.ok(root.split(/[\\/]/).at(-1).startsWith('cow-mininews-preview-'))
  await rm(root,{recursive:true,force:true})
}
process.once('SIGINT',stop)
process.once('SIGTERM',stop)
try {
  let cookie=''
  const password='Preview-'+randomBytes(12).toString('hex')
  async function request(query='',values) {
    const result=await fetch(url+'/news'+query,{redirect:'manual',method:values?'POST':'GET',headers:cookie?{cookie}:{},body:values?new URLSearchParams(values):undefined})
    for(const item of result.headers.getSetCookie()) if(item.startsWith('mn_'))cookie=item.split(';')[0]
    const text=await result.text()
    assert.ok([200,303].includes(result.status),text)
    return text
  }
  const hidden=(text,name)=>text.match(new RegExp(`name="${name}" value="([^"]*)"`))[1]
  const setup=await request()
  await request('',{action:'setup',csrf:hidden(setup,'csrf'),setupKey:await readFile(join(site,'_news.setup-key'),'utf8'),username:'editor',password,confirmPassword:password})
  await request('?view=login',{action:'login',csrf:hidden(await request('?view=login'),'csrf'),username:'editor',password})
  for(const [title,summary,body,state] of [
    ['Welcome to our little website','A place for small updates, useful links and the occasional longer story.','## Hello, world\n\nThis is a **MiniNews demo** running on Cow. A single file takes care of writing, previewing and publishing.\n\n- Plain forms\n- Markdown text\n- Drafts kept private\n\n> Small websites should be easy to update.\n\nVisit [the news list](/news) for more.','published'],
    ['September site notes','A few things we have been working on this month.','We tidied up the archive and added a few new pages.\n\n**Next up:** a short guide to getting started.\n\nThanks for stopping by!','published'],
    ['A note for next week','','## Work in progress\n\nThis draft is only visible in the editor. Use **Preview** to check the formatting before publishing.','draft']
  ]) {
    const page=await request('?view=new')
    await request('?view=new',{action:'save',csrf:hidden(page,'csrf'),version:hidden(page,'version'),creationKey:hidden(page,'creationKey'),title,summary,body,state})
  }
  console.log(JSON.stringify({url:url+'/news',login:url+'/news?view=login',username:'editor',password,root,disposable:true}))
} catch(error) { await stop();throw error }
