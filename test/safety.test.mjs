import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'

const project = fileURLToPath(new URL('../', import.meta.url))

async function site(t, { maxRequestsPerWorker = 1000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-safety-test-'))
  const src = join(root, 'site')
  await mkdir(src)
  const pkg = join(root, 'node_modules/@cowlang/cow')
  await mkdir(pkg, { recursive: true })
  await cp(join(project, 'lib'), join(pkg, 'lib'), { recursive: true })
  await cp(join(project, 'package.json'), join(pkg, 'package.json'))
  let app
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }) })
  return {
    root, src,
    async write(file, content) { await writeFile(join(src, file), content) },
    async start() {
      app = new CowApp({ rootDir: src, host: '127.0.0.1', port: 0, workers: 1, maxRequestsPerWorker, logger: { error() {} } })
      const { url } = await app.start()
      return async (path) => {
        const r = await fetch(url + path, { redirect: 'manual' })
        return { status: r.status, headers: r.headers, text: await r.text() }
      }
    }
  }
}

test('router protects ordinary modules, databases, dotfiles, Windows path variants and symlinks', async (t) => {
  const f = await site(t)
  for (const file of ['config.mjs', 'server.js', 'code.ts', 'package.json', 'news.sqlite', '.env', '_secret.txt']) await f.write(file, 'PRIVATE SOURCE')
  await f.write('index.jsp', '<?js echo("public page") ?>')
  await f.write('public.txt', 'public text')
  await mkdir(join(f.src, 'assets'))
  await mkdir(join(f.src, '_private'))
  await mkdir(join(f.root, 'outside'))
  await f.write('_private/secret.txt', 'PRIVATE SOURCE')
  await f.write('assets/client.mjs', 'export const browser = true')
  await writeFile(join(f.root, 'outside/secret.txt'), 'PRIVATE SOURCE')
  // Directory junctions work without Windows symlink privileges.
  await symlink(join(f.root, 'outside'), join(f.src, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(join(f.src, '_private'), join(f.src, 'private-link'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(f.src, join(f.src, 'assets/alias'), process.platform === 'win32' ? 'junction' : 'dir')
  const request = await f.start()
  for (const path of ['/config.mjs', '/server.js', '/code.ts', '/package.json', '/news.sqlite', '/.env', '/_secret.txt', '/%5c_secret.txt', '/%5cconfig.mjs', '/config.mjs::$DATA', '/_private%5csecret.txt', '/outside-link/secret.txt', '/private-link/secret.txt', '/assets/alias/config.mjs']) {
    const result = await request(path)
    assert.notEqual(result.status, 200, path)
    assert.doesNotMatch(result.text, /PRIVATE SOURCE/, path)
  }
  assert.equal((await request('/')).text, 'public page')
  assert.equal((await request('/public.txt')).text, 'public text')
  assert.equal((await request('/assets/client.mjs')).text, 'export const browser = true')
})

test('ending a response during a transaction fails without committing or sending a success redirect', async (t) => {
  const f = await site(t)
  await f.write('index.jsp', `<?js
    import { sqlite } from 'cow:sqlite'
    const db = await sqlite(new URL('../state.sqlite', import.meta.url))
    db.exec('CREATE TABLE IF NOT EXISTS records (value TEXT)')
    const action = req.get('action')
    if (action === 'normal') await db.transaction(() => db.run("INSERT INTO records VALUES ('committed')"))
    if (action === 'json' || action === 'redirect' || action === 'caught') {
      try {
        await db.transaction(async () => {
          db.run("INSERT INTO records VALUES ('must roll back')")
          if (action === 'json') res.json({ saved: true })
          else res.redirect('/success', 303)
        })
      } catch (error) {
        if (action !== 'caught') throw error
        echo(error.code)
      }
    }
    if (action === 'manual' || action === 'implicit' || action === 'raw') {
      if (action === 'raw') db.exec('BEGIN')
      else db.begin()
      db.run("INSERT INTO records VALUES ('must roll back')")
      if (action !== 'implicit') res.json({ saved: true })
      else { echo('success'); return }
    }
    if (action !== 'caught') res.json(db.all('SELECT value FROM records'))
  `)
  const request = await f.start()
  for (const action of ['json', 'redirect', 'manual', 'implicit', 'raw']) {
    const r = await request(`/?action=${action}`)
    assert.equal(r.status, 500, r.text)
    assert.equal(r.headers.get('location'), null)
    assert.match(r.text, /Finish the SQLite transaction/)
    assert.equal((await request('/')).text, '[]')
  }
  const caught = await request('/?action=caught')
  assert.equal(caught.status, 200)
  assert.equal(caught.headers.get('location'), null)
  assert.equal(caught.text, 'COW_SQLITE_RESPONSE_IN_TRANSACTION')
  assert.equal((await request('/?action=normal')).text, '[{"value":"committed"}]')
})

test('includes share the request and module graph while keeping explicit locals separate', async (t) => {
  const f = await site(t)
  await f.write('_state.mjs', 'export const state = { count: 0 }')
  await f.write('_nested.tsp', '<?ts const label: string = locals.label; echo(h(label)) ?>')
  await f.write('_partial.jsp', `<?js import { state } from './_state.mjs'; echo(++state.count); await include('./_nested.tsp', locals) ?>`)
  await f.write('index.jsp', `<?js await include('./_partial.jsp', { label: '<first>' }); await include('./_partial.jsp', { label: '<second>' }) ?>`)
  const request = await f.start()
  assert.equal((await request('/')).text, '1&lt;first&gt;2&lt;second&gt;')
  assert.equal((await request('/')).text, '1&lt;first&gt;2&lt;second&gt;')
  await f.write('_nested.tsp', '<?ts echo(h(locals.label.toUpperCase())) ?>')
  assert.equal((await request('/')).text, '1&lt;FIRST&gt;2&lt;SECOND&gt;')
  assert.equal((await request('/_partial')).status, 404)
})

test('application and bare package state reset with or without worker recycling', async (t) => {
  for (const recycle of [false, true]) {
    const f = await site(t, { maxRequestsPerWorker: recycle ? 1 : 1000 })
    const external = join(f.root, 'node_modules/state-probe')
    await mkdir(external)
    await writeFile(join(external, 'package.json'), JSON.stringify({ name: 'state-probe', type: 'module', exports: './index.mjs' }))
    await writeFile(join(external, 'index.mjs'), 'let count = 0; export const next = () => ++count')
    await f.write('_local.mjs', 'let count = 0; export const next = () => ++count')
    await f.write('index.jsp', `<?js import { next } from 'state-probe'; import { next as local } from './_local.mjs'; res.json({ external: next(), local: local() }) ?>`)
    const request = await f.start()
    assert.deepEqual(JSON.parse((await request('/')).text), { external: 1, local: 1 })
    assert.deepEqual(JSON.parse((await request('/')).text), { external: 1, local: 1 })
  }
})
