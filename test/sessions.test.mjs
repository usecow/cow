import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { session, pruneSessions } from '../lib/web.mjs'
import { CowApp } from '../lib/app.mjs'

function fixture(t) {
  const database = new DatabaseSync(':memory:')
  t.after(() => database.close())
  const db = {
    exec: sql => database.exec(sql),
    get: (sql, params = []) => database.prepare(sql).get(...params),
    all: (sql, params = []) => database.prepare(sql).all(...params),
    run: (sql, params = []) => database.prepare(sql).run(...params),
    async transaction(callback) {
      database.exec('BEGIN IMMEDIATE')
      try { const value = await callback(); database.exec('COMMIT'); return value }
      catch (error) { database.exec('ROLLBACK'); throw error }
    }
  }
  return { db, async open(cookie = '', options) {
    const headers = {}
    const res = { headersSent: false, getHeader: name => headers[name], setHeader: (name, value) => { headers[name] = value } }
    const current = await session(db, { header: () => cookie }, res, options)
    return { current, res, headers, get cookie() { return headers['set-cookie']?.at(-1).split(';')[0] ?? cookie } }
  } }
}

test('0.0.1 sessions move to cow_sessions and the cow_session cookie without signing anyone out', async t => {
  const f = fixture(t), token = 'a'.repeat(64), csrf = 'b'.repeat(64)
  const identity = createHash('sha256').update(token).digest('hex')
  f.db.exec('CREATE TABLE jin_sessions(token_hash TEXT PRIMARY KEY, data TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0); CREATE INDEX jin_sessions_expiry ON jin_sessions(expires_at)')
  f.db.run('INSERT INTO jin_sessions(token_hash,data,csrf,expires_at) VALUES(?,?,?,?)', [identity, '{"userId":1}', csrf, Math.floor(Date.now()/1000)+3600])
  const moved = await f.open('jin_session=' + token)
  assert.deepEqual(moved.current.data, { userId: 1 })
  assert.equal(moved.current.csrfToken, csrf)
  const [removed, added] = moved.headers['set-cookie']
  assert.match(removed, /^jin_session=; .*Max-Age=0/)
  assert.match(added, new RegExp('^cow_session=' + token + ';'))
  assert.deepEqual(f.db.all("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").map(row => row.name), ['cow_sessions', 'cow_sessions_expiry'])
  moved.current.update({ userId: 1, theme: 'sage' })
  const again = await f.open(moved.cookie)
  assert.equal(again.headers['set-cookie'], undefined)
  assert.deepEqual(again.current.data, { userId: 1, theme: 'sage' })
})

test('sessions with their own cookie name survive the table rename and ignore the old default cookie', async t => {
  const f = fixture(t), token = 'c'.repeat(64)
  f.db.exec('CREATE TABLE jin_sessions(token_hash TEXT PRIMARY KEY, data TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0)')
  f.db.run('INSERT INTO jin_sessions(token_hash,data,csrf,expires_at) VALUES(?,?,?,?)', [createHash('sha256').update(token).digest('hex'), '{"editor":true}', 'csrf', Math.floor(Date.now()/1000)+3600])
  const kept = await f.open('mn_news=' + token, { name: 'mn_news' })
  assert.deepEqual(kept.current.data, { editor: true })
  assert.equal(kept.headers['set-cookie'], undefined)
  const other = await f.open('jin_session=' + token, { name: 'app' })
  assert.deepEqual(other.current.data, {})
  assert.equal(other.headers['set-cookie'].length, 1)
  assert.match(other.headers['set-cookie'][0], /^app=/)
})

test('an existing cow_sessions table wins and jin_sessions is left alone', async t => {
  const f = fixture(t)
  await f.open()
  f.db.exec('CREATE TABLE jin_sessions(token_hash TEXT PRIMARY KEY, data TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL)')
  f.db.run('INSERT INTO jin_sessions VALUES (?,?,?,?)', ['old', '{}', 'csrf', Math.floor(Date.now()/1000)+3600])
  await f.open()
  assert.equal(f.db.get('SELECT count(*) AS n FROM jin_sessions').n, 1)
  assert.equal(f.db.get('SELECT count(*) AS n FROM cow_sessions').n, 2)
})

test('session updates persist explicitly without rotating identity, CSRF or expiry', async t => {
  const f = fixture(t), a = await f.open()
  const { cookie } = a, csrf = a.current.csrfToken, expiry = a.current.expiresAt
  a.current.data.ignored = true
  assert.deepEqual(a.current.data, {})
  a.current.update({ theme: 'dark', cart: ['book'] })
  assert.equal(a.current.csrfToken, csrf)
  assert.equal(a.current.expiresAt, expiry)
  assert.equal(a.cookie, cookie)
  assert.equal(a.headers['set-cookie'].length, 1)
  const b = await f.open(cookie)
  assert.deepEqual(b.current.data, { theme: 'dark', cart: ['book'] })
  assert.equal(b.headers['set-cookie'], undefined)
  b.current.verify(new URLSearchParams({ csrf }))
})

test('stale session writes conflict, refresh enables explicit retry, and ABA updates are detected', async t => {
  const f = fixture(t), a = await f.open(), b = await f.open(a.cookie)
  a.current.update({ count: 1 })
  a.current.update({})
  assert.throws(() => b.current.update({ lost: true }), { status: 409, code: 'COW_SESSION_CONFLICT' })
  assert.throws(() => b.current.touch(), { code: 'COW_SESSION_CONFLICT' })
  await assert.rejects(b.current.replace({ user: 2 }), { code: 'COW_SESSION_CONFLICT' })
  assert.deepEqual(b.current.refresh(), {})
  b.current.update({ count: 2 })
  assert.deepEqual((await f.open(a.cookie)).current.data, { count: 2 })
})

test('logout cannot be undone by stale update, renewal or identity rotation', async t => {
  const f = fixture(t), a = await f.open(), stale = await f.open(a.cookie)
  a.current.destroy()
  for (const action of [() => stale.current.update({ user: 1 }), () => stale.current.touch(), () => stale.current.refresh()]) {
    assert.throws(action, { status: 403, code: 'COW_SESSION_ENDED' })
  }
  await assert.rejects(stale.current.replace({ user: 1 }), { code: 'COW_SESSION_ENDED' })
  assert.equal(f.db.get('SELECT count(*) AS n FROM cow_sessions').n, 0)
  assert.match(a.headers['set-cookie'].at(-1), /Max-Age=0; Expires=Thu, 01 Jan 1970/)
  assert.throws(() => a.current.update({}), { code: 'COW_SESSION_ENDED' })
  const fresh = await f.open(stale.cookie)
  assert.notEqual(fresh.cookie, stale.cookie)
  assert.deepEqual(fresh.current.data, {})
})

test('touch explicitly renews stored and browser expiry; reads and updates do not', async t => {
  let now = 1_800_000_000_000
  t.mock.method(Date, 'now', () => now)
  const f = fixture(t), a = await f.open('', { maxAge: 60 })
  const cookie = a.cookie, csrf = a.current.csrfToken
  assert.equal(a.current.expiresAt, now / 1000 + 60)
  now += 30_000
  a.current.update({ view: 1 })
  const b = await f.open(cookie, { maxAge: 60 })
  assert.equal(b.current.expiresAt, now / 1000 + 30)
  assert.equal(b.headers['set-cookie'], undefined)
  b.current.touch()
  assert.equal(b.cookie, cookie)
  assert.equal(b.current.csrfToken, csrf)
  assert.equal(b.current.expiresAt, now / 1000 + 60)
  assert.match(b.headers['set-cookie'][0], /Max-Age=60;/)
  assert.ok(b.headers['set-cookie'][0].endsWith('Expires=' + new Date(b.current.expiresAt * 1000).toUTCString()))
  now += 60_000
  assert.throws(() => b.current.touch(), { code: 'COW_SESSION_ENDED' })
  assert.throws(() => b.current.update({}), { code: 'COW_SESSION_ENDED' })
  const c = await f.open(cookie)
  assert.notEqual(c.cookie, cookie)
})

test('session cleanup is bounded, happens for returning visitors and can run explicitly', async t => {
  const f = fixture(t), live = await f.open()
  for (let n = 0; n < 107; n++) f.db.run('INSERT INTO cow_sessions (token_hash,data,csrf,expires_at) VALUES (?,?,?,?)', [`old-${n}`, '{}', 'expired', 0])
  await f.open(live.cookie)
  assert.equal(f.db.get('SELECT count(*) AS n FROM cow_sessions').n, 8)
  assert.equal(pruneSessions(f.db, { limit: 5 }), 5)
  assert.equal(pruneSessions(f.db), 2)
  assert.equal(pruneSessions(f.db), 0)
  assert.equal(f.db.get('SELECT count(*) AS n FROM cow_sessions').n, 1)
  for (const limit of [0, -1, 1.5, Infinity]) assert.throws(() => pruneSessions(f.db, { limit }), TypeError)
})

test('legacy four-column session databases upgrade without losing data or identity', async t => {
  const f = fixture(t)
  f.db.exec('CREATE TABLE jin_sessions (token_hash TEXT PRIMARY KEY, data TEXT NOT NULL, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL)')
  const legacyId = 'a'.repeat(64), cookie = 'jin_session=' + legacyId
  f.db.run('INSERT INTO jin_sessions VALUES (?,?,?,?)', [createHash('sha256').update(legacyId).digest('hex'), '{"legacy":true}', 'old-csrf', Math.floor(Date.now() / 1000) + 3600])
  const a = await f.open(cookie)
  assert.deepEqual(a.current.data, { legacy: true })
  assert.equal(a.current.csrfToken, 'old-csrf')
  assert.match(a.headers['set-cookie'].at(-1), new RegExp('^cow_session=' + legacyId + ';'))
  assert.ok(f.db.all('PRAGMA table_info(cow_sessions)').some(column => column.name === 'version'))
  a.current.update({ preserved: true })
  const b = await f.open(a.cookie)
  assert.deepEqual(b.current.data, { preserved: true })
  assert.equal(b.cookie, a.cookie)
})

test('session cookie scope survives rotation, renewal and deletion and invalid options do not write', async t => {
  const f = fixture(t)
  await assert.rejects(f.open('', { name: '__Host-bad' }), TypeError)
  assert.equal(f.db.get("SELECT count(*) AS n FROM sqlite_master WHERE name='cow_sessions'").n, 0)
  for (const options of [{ expires: new Date() }, { maxAge: 0 }, { maxAge: Infinity }, { typo: 1 }, { path: '/;bad' }]) {
    await assert.rejects(f.open('', options), TypeError)
  }
  const a = await f.open('', { name: 'my.session', path: '/account', domain: 'example.com', secure: true, sameSite: 'Strict' })
  const oldCookie = a.cookie, oldCSRF = a.current.csrfToken
  await a.current.replace({ user: 1 })
  assert.notEqual(a.cookie, oldCookie)
  assert.notEqual(a.current.csrfToken, oldCSRF)
  a.current.touch()
  a.current.destroy()
  for (const header of a.headers['set-cookie']) assert.match(header, /Path=\/account; Domain=example.com; SameSite=Strict; HttpOnly; Secure;/)
})

test('failed serialization and failed rotation leave the prior record intact', async t => {
  const f = fixture(t), a = await f.open()
  const cyclic = {}; cyclic.self = cyclic
  for (const value of [undefined, () => {}, cyclic, 1n]) {
    assert.throws(() => a.current.update(value), TypeError)
    await assert.rejects(a.current.replace(value), TypeError)
  }
  const old = a.cookie
  f.db.exec("CREATE TRIGGER fail_session_insert BEFORE INSERT ON cow_sessions BEGIN SELECT RAISE(ABORT, 'injected'); END")
  await assert.rejects(a.current.replace({ user: 1 }), /injected/)
  assert.equal(a.cookie, old)
  a.current.update({ still: 'alive' })
  assert.deepEqual((await f.open(old)).current.data, { still: 'alive' })
})

test('cookie-changing session operations fail after header commitment before touching the database', async t => {
  const f = fixture(t), a = await f.open()
  a.res.headersSent = true
  assert.throws(() => a.current.touch(), { status: 500 })
  assert.throws(() => a.current.destroy(), { status: 500 })
  await assert.rejects(a.current.replace({}), { status: 500 })
  a.current.update({ savedWithoutCookie: true })
  assert.deepEqual((await f.open(a.cookie)).current.data, { savedWithoutCookie: true })
})

test('unawaited rotation rejects overlapping session operations instead of mixing identities', async t => {
  const f = fixture(t), a = await f.open()
  const pending = a.current.replace({ user: 1 })
  for (const action of [() => a.current.update({}), () => a.current.touch(), () => a.current.destroy(), () => a.current.refresh()]) {
    assert.throws(action, { code: 'COW_SESSION_BUSY' })
  }
  await pending
  a.current.update({ user: 1, theme: 'dark' })
})

test('session updates, conflicts and cookies work in real requests across workers and restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cow-session-'))
  const site = join(root, 'site'), installed = join(root, 'node_modules/@cowlang/cow')
  let app
  t.after(async () => { try { await app?.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await mkdir(site)
  await mkdir(installed, { recursive: true })
  const project = fileURLToPath(new URL('../', import.meta.url))
  await cp(join(project, 'package.json'), join(installed, 'package.json'))
  await cp(join(project, 'lib'), join(installed, 'lib'), { recursive: true })
  await writeFile(join(site, 'index.jsp'), `<?js
    import {sqlite} from 'cow:sqlite'; import {session} from 'cow:web';
    import {writeFile,access} from 'node:fs/promises'; import {setTimeout as delay} from 'node:timers/promises';
    const db=await sqlite(__dirname+'/../sessions.sqlite');
    const s=await session(db,req,res); const action=req.get('action');
    if(action==='update') s.update({count:(s.data.count||0)+1});
    if(action==='conflict') { const stale=await session(db,req,res); s.update({count:10});
      try {stale.update({count:20})} catch(e) {res.json({code:e.code,data:stale.refresh()})} }
    if(action==='race') {
      const mine=req.get('id')==='a'?'a':'b', other=mine==='a'?'b':'a';
      await writeFile(__dirname+'/../ready-'+mine,'ready');
      for(let attempt=0; ; attempt++) {
        try {await access(__dirname+'/../ready-'+other); break} catch(e) {if(attempt>200) throw e; await delay(10)}
      }
      try {s.update({count:s.data.count+1})} catch(e) {res.status(e.status);res.json({code:e.code})}
    }
    if(action==='touch') s.touch();
    if(action==='logout') s.destroy();
    res.json({data:s.data,csrf:s.csrfToken,expiry:s.expiresAt}); ?>`)
  const start = async () => {
    app = new CowApp({ rootDir: site, port: 0, workers: 2, logger: { error() {} } })
    return (await app.start()).url
  }
  let url = await start()
  const first = await fetch(url)
  assert.equal(first.status, 200, await first.clone().text())
  const cookie = first.headers.getSetCookie()[0].split(';')[0], initial = await first.json()
  const call = async action => {
    const response = await fetch(url + '/?action=' + action, { headers: { cookie } })
    assert.equal(response.status, 200, await response.clone().text())
    return { data: await response.json(), headers: response.headers }
  }
  assert.deepEqual((await call('update')).data.data, { count: 1 })
  assert.equal((await call('')).data.csrf, initial.csrf)
  assert.deepEqual((await call('conflict')).data, { code: 'COW_SESSION_CONFLICT', data: { count: 10 } })
  const raced = await Promise.all(['a','b'].map(id => fetch(url+'/?action=race&id='+id, {headers:{cookie}})))
  assert.deepEqual(raced.map(response => response.status).sort(), [200,409])
  assert.equal((await raced.find(response => response.status === 409).json()).code, 'COW_SESSION_CONFLICT')
  await raced.find(response => response.status === 200).arrayBuffer()
  await app.close(); url = await start()
  assert.deepEqual((await call('')).data.data, { count: 11 })
  assert.match((await call('touch')).headers.getSetCookie()[0], /Expires=/)
  await call('logout')
  assert.deepEqual((await call('')).data.data, {})
})
