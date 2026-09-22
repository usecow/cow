import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { CowApp } from '../../../lib/app.mjs'

const project = fileURLToPath(new URL('../../../', import.meta.url))
const password = 'a unique testing passphrase'
const setupKey = 'private-forum-test-key'

async function fixture(t, { maxRequestsPerWorker = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cow-forum-test-'))
  const site = join(root, 'site')
  let app, url
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }) })
  await cp(join(project, 'examples/forum/site'), site, { recursive: true })
  await mkdir(join(root, 'data'))
  await writeFile(join(root, 'data/setup-key'), setupKey)
  const installed = join(root, 'node_modules/@cowlang/cow')
  await mkdir(installed, { recursive: true })
  await cp(join(project, 'package.json'), join(installed, 'package.json'))
  await cp(join(project, 'lib'), join(installed, 'lib'), { recursive: true })
  async function start() {
    app = new CowApp({ rootDir: site, host: '127.0.0.1', port: 0, workers: 2, maxRequestsPerWorker, logger: { error() {} } })
    url = (await app.start()).url
  }
  await start()
  return {
    root, site, get url() { return url },
    async restart() { await app.close(); await start() },
    db(callback) {
      const db = new DatabaseSync(join(root, 'data/forum.sqlite'))
      try { return callback(db) } finally { db.close() }
    }
  }
}

function client(f) {
  let cookie = ''
  return {
    get cookie() { return cookie }, set cookie(value) { cookie = value },
    async request(path, values, headers = {}) {
      const response = await fetch(f.url + path, {
        redirect: 'manual', method: values === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), ...headers },
        body: values === undefined ? undefined : new URLSearchParams(values)
      })
      for (const item of response.headers.getSetCookie()) {
        if (item.startsWith('jin_forum=')) cookie = item.split(';')[0]
      }
      return { status: response.status, headers: response.headers, text: await response.text() }
    }
  }
}

function hidden(page, name) {
  const match = page.text.match(new RegExp(`name="${name}" value="([^"]*)"`))
  assert.ok(match, `Missing ${name}. HTTP ${page.status}: ${page.text.slice(0, 1600)}`)
  return match[1]
}
function success(result) { assert.equal(result.status, 303, result.text); return result.headers.get('location') }
const credentials = (page, username) => ({ csrf: hidden(page, 'csrf'), username, password, confirmPassword: password })
async function install(c) { success(await c.request('/install', { ...credentials(await c.request('/install'), 'keeper'), setupKey })) }
async function register(c, username, extra = {}) { success(await c.request('/register', { ...credentials(await c.request('/register'), username), ...extra })) }
async function login(c, username) { success(await c.request('/login', credentials(await c.request('/login'), username))) }
const compose = (page, extra = {}) => ({ csrf: hidden(page, 'csrf'), creationKey: hidden(page, 'creationKey'), body: 'A thoughtful contribution.', ...extra })
const editing = (page, body) => ({ csrf: hidden(page, 'csrf'), version: hidden(page, 'version'), body })
const moderation = (page) => ({ csrf: hidden(page, 'csrf'), version: hidden(page, 'version'), confirm: 'yes' })

test('forum has separate accounts, ownership checks, escaped content and sessions surviving workers/restart', async (t) => {
  const f = await fixture(t, { maxRequestsPerWorker: 5 })
  const admin = client(f), alice = client(f), bob = client(f), visitor = client(f)
  assert.equal((await visitor.request('/')).headers.get('location'), '/install')
  await install(admin)
  await register(alice, 'Alice', { role: 'admin', userId: 1 })
  await register(bob, 'Bob')
  assert.equal(f.db((db) => db.prepare("SELECT role FROM forum_users WHERE username='Alice'").get().role), 'member')
  assert.equal(f.db((db) => db.prepare("SELECT count(*) AS n FROM forum_users WHERE role='admin'").get().n), 1)
  assert.match(f.db((db) => db.prepare("SELECT password_hash FROM forum_users WHERE username='Alice'").get().password_hash), /^scrypt-v1\$/)
  const beforeLogin = alice.cookie
  await login(alice, 'ALICE')
  assert.notEqual(alice.cookie, beforeLogin)
  const aliceCookie = alice.cookie
  await login(bob, 'Bob')
  await login(admin, 'keeper')
  assert.match((await alice.request('/new')).text, /Alice/)
  assert.equal((await visitor.request('/new')).headers.get('location'), '/login')
  const form = await alice.request('/new')
  const payload = compose(form, { title: '<script>title</script>', body: 'Literal <b>text</b> and ?>\nSecond line.', userId: 3 })
  const location = success(await alice.request('/new', payload))
  assert.equal(success(await alice.request('/new', payload)), location)
  const first = f.db((db) => db.prepare('SELECT * FROM forum_posts').get())
  const aliceId = f.db((db) => db.prepare("SELECT id FROM forum_users WHERE username='Alice'").get().id)
  assert.equal(first.user_id, aliceId)
  const topicId = first.topic_id
  let page = await visitor.request(`/topic?id=${topicId}`)
  assert.match(page.text, /&lt;script&gt;title&lt;\/script&gt;/)
  assert.match(page.text, /Literal &lt;b&gt;text&lt;\/b&gt; and \?&gt;/)
  assert.doesNotMatch(page.text, /<script>|<b>text/)
  assert.equal(page.headers.get('cache-control'), 'no-store')
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/)
  page = await bob.request(`/topic?id=${topicId}`)
  success(await bob.request(`/topic?id=${topicId}`, compose(page, { body: 'Bob owns this reply.' })))
  const bobPost = f.db((db) => db.prepare('SELECT max(id) AS id FROM forum_posts').get().id)
  assert.equal((await alice.request(`/edit?id=${bobPost}`)).status, 403)
  const alicePage = await alice.request(`/topic?id=${topicId}`)
  assert.equal((await alice.request(`/edit?id=${bobPost}`, { csrf: hidden(alicePage, 'csrf'), version: 1, body: 'Forged edit', userId: 3 })).status, 403)
  assert.equal((await admin.request(`/edit?id=${bobPost}`)).status, 403)
  assert.equal((await bob.request(`/moderate?action=lock&id=${topicId}`)).status, 403)
  assert.equal((await bob.request(`/moderate?action=remove&id=${first.id}`, { csrf: hidden(page, 'csrf'), version: 1, confirm: 'yes', role: 'admin' })).status, 403)
  let edit = await bob.request(`/edit?id=${bobPost}`)
  success(await bob.request(`/edit?id=${bobPost}`, editing(edit, 'Bob made a correction.')))
  const stale = await bob.request(`/edit?id=${bobPost}`, editing(edit, 'Unsaved stale correction.'))
  assert.equal(stale.status, 409)
  assert.match(stale.text, /Unsaved stale correction/)
  assert.equal(f.db((db) => db.prepare('SELECT body FROM forum_posts WHERE id=?').get(bobPost).body), 'Bob made a correction.')
  await f.restart()
  assert.equal((await alice.request('/new')).status, 200)
  assert.equal((await bob.request(`/edit?id=${bobPost}`)).status, 200)
  assert.equal((await admin.request(`/moderate?action=lock&id=${topicId}`)).status, 200)
  const logoutPage = await alice.request('/')
  success(await alice.request('/logout', { csrf: hidden(logoutPage, 'csrf') }))
  alice.cookie = aliceCookie
  assert.equal((await alice.request('/new')).headers.get('location'), '/login')
  assert.equal((await bob.request('/new')).status, 200)
  alice.cookie = beforeLogin
  assert.equal((await alice.request('/new')).headers.get('location'), '/login')
})

test('parallel replies persist, repeated submissions deduplicate, and lock/edit/remove races are serializable', async (t) => {
  const f = await fixture(t)
  const admin = client(f), alice = client(f), bob = client(f)
  await install(admin); await register(alice, 'Alice'); await register(bob, 'Bob')
  await login(admin, 'keeper'); await login(alice, 'Alice'); await login(bob, 'Bob')
  success(await alice.request('/new', compose(await alice.request('/new'), { title: 'Concurrent conversation' })))
  const topicId = f.db((db) => db.prepare('SELECT id FROM forum_topics').get().id)
  const route = `/topic?id=${topicId}`
  const a = compose(await alice.request(route), { body: 'Alice in parallel.' })
  const b = compose(await bob.request(route), { body: 'Bob in parallel.' })
  for (const result of await Promise.all([alice.request(route, a), bob.request(route, b), alice.request(route, a), bob.request(route, b)])) success(result)
  assert.equal(f.db((db) => db.prepare('SELECT count(*) AS n FROM forum_posts').get().n), 3)
  assert.equal((await alice.request(route, { ...a, body: 'Reused key with different text.' })).status, 409)
  const awaitingReply = compose(await bob.request(route), { body: 'Unsent reply after a lock.' })
  const bobPost = f.db((db) => db.prepare("SELECT p.id FROM forum_posts p JOIN forum_users u ON u.id=p.user_id WHERE u.username='Bob'").get().id)
  const awaitingEdit = editing(await bob.request(`/edit?id=${bobPost}`), 'Unsent edit after a lock.')
  const lockRoute = `/moderate?action=lock&id=${topicId}`
  const lock = moderation(await admin.request(lockRoute))
  success(await admin.request(lockRoute, lock))
  const locked = await bob.request(route, awaitingReply)
  assert.equal(locked.status, 409)
  assert.match(locked.text, /Unsent reply after a lock/)
  const lockedEdit = await bob.request(`/edit?id=${bobPost}`, awaitingEdit)
  assert.equal(lockedEdit.status, 409)
  assert.match(lockedEdit.text, /Unsent edit after a lock/)
  assert.equal((await admin.request(route, compose(await admin.request('/new')))).status, 409)
  assert.equal((await admin.request(lockRoute, lock)).status, 409)
  const unlockRoute = `/moderate?action=unlock&id=${topicId}`
  success(await admin.request(unlockRoute, moderation(await admin.request(unlockRoute))))
  // Reply and lock may commit in either order, but cannot violate the committed lock.
  const raceReply = compose(await bob.request(route), { body: 'Racing the lock.' })
  const raceLock = moderation(await admin.request(lockRoute))
  const raced = await Promise.all([bob.request(route, raceReply), admin.request(lockRoute, raceLock)])
  assert.ok([303, 409].includes(raced[0].status), raced[0].text)
  success(raced[1])
  const stored = f.db((db) => db.prepare("SELECT count(*) AS n FROM forum_posts WHERE body='Racing the lock.'").get().n)
  assert.equal(stored, raced[0].status === 303 ? 1 : 0)
  assert.equal((await bob.request(route, compose(await bob.request('/new')))).status, 409)
  success(await admin.request(unlockRoute, moderation(await admin.request(unlockRoute))))
  const removalRoute = `/moderate?action=remove&id=${bobPost}`
  const remove = moderation(await admin.request(removalRoute))
  assert.equal((await admin.request(removalRoute, { ...remove, confirm: '' })).status, 422)
  const staleEdit = editing(await bob.request(`/edit?id=${bobPost}`), 'Must not resurrect this post.')
  success(await admin.request(removalRoute, remove))
  const tombstone = f.db((db) => db.prepare('SELECT * FROM forum_posts WHERE id=?').get(bobPost))
  assert.equal(tombstone.body, '')
  assert.ok(tombstone.removed_at)
  const removedEdit = await bob.request(`/edit?id=${bobPost}`, staleEdit)
  assert.equal(removedEdit.status, 410)
  assert.match(removedEdit.text, /Must not resurrect this post/)
  assert.match((await bob.request(route)).text, /This post was removed by the administrator/)
  assert.doesNotMatch((await bob.request(route)).text, /Bob in parallel\./)
  const firstPost = f.db((db) => db.prepare('SELECT min(id) AS id FROM forum_posts').get().id)
  const removeFirst = `/moderate?action=remove&id=${firstPost}`
  success(await admin.request(removeFirst, moderation(await admin.request(removeFirst))))
  assert.equal((await alice.request(route)).status, 200)
})

test('pagination is stable around tombstones and failed writes never redirect or partly create a topic', async (t) => {
  const f = await fixture(t)
  const admin = client(f)
  await install(admin); await login(admin, 'keeper')
  for (let n = 0; n < 11; n++) success(await admin.request('/new', compose(await admin.request('/new'), { title: `Topic ${n}` })))
  const page1 = await admin.request('/'), page2 = await admin.request('/?page=2')
  assert.match(page1.text, /Topic 10/)
  assert.doesNotMatch(page1.text, />Topic 0</)
  assert.match(page2.text, />Topic 0</)
  assert.equal((await admin.request('/?page=3')).status, 404)
  for (const path of ['/?page=0', '/?page=-1', '/topic?id=1x', '/edit?id=1.5']) assert.equal((await admin.request(path)).status, 400)
  const topicId = f.db((db) => db.prepare('SELECT min(id) AS id FROM forum_topics').get().id)
  const route = `/topic?id=${topicId}`
  let lastLocation
  for (let n = 0; n < 11; n++) lastLocation = success(await admin.request(route, compose(await admin.request(route), { body: `Reply ${n}` })))
  assert.match(lastLocation, /page=2#post-/)
  assert.match((await admin.request(route + '&page=2')).text, /Reply 10/)
  assert.doesNotMatch((await admin.request(route)).text, /Reply 10/)
  assert.match((await admin.request('/')).text, />Topic 0</)
  const beforeTopics = f.db((db) => db.prepare('SELECT count(*) AS n FROM forum_topics').get().n)
  const beforePosts = f.db((db) => db.prepare('SELECT count(*) AS n FROM forum_posts').get().n)
  f.db((db) => db.exec("CREATE TRIGGER fail_forum_insert BEFORE INSERT ON forum_posts BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;"))
  const failure = await admin.request('/new', compose(await admin.request('/new'), { title: 'Must roll back' }))
  assert.equal(failure.status, 500)
  assert.equal(failure.headers.get('location'), null)
  const replyFailure = await admin.request(route, compose(await admin.request(route), { body: 'Must not be saved' }))
  assert.equal(replyFailure.status, 500)
  assert.equal(replyFailure.headers.get('location'), null)
  assert.equal(f.db((db) => db.prepare('SELECT count(*) AS n FROM forum_topics').get().n), beforeTopics)
  assert.equal(f.db((db) => db.prepare('SELECT count(*) AS n FROM forum_posts').get().n), beforePosts)
  f.db((db) => db.exec('DROP TRIGGER fail_forum_insert'))
  const postId = f.db((db) => db.prepare('SELECT min(id) AS id FROM forum_posts').get().id)
  const savedBody = f.db((db) => db.prepare('SELECT body FROM forum_posts WHERE id=?').get(postId).body)
  f.db((db) => db.exec("CREATE TRIGGER fail_forum_update BEFORE UPDATE ON forum_posts BEGIN SELECT RAISE(ABORT, 'injected update failure'); END;"))
  const editFailure = await admin.request(`/edit?id=${postId}`, editing(await admin.request(`/edit?id=${postId}`), 'Must not replace the saved text'))
  assert.equal(editFailure.status, 500)
  assert.equal(editFailure.headers.get('location'), null)
  const removalRoute = `/moderate?action=remove&id=${postId}`
  const removalFailure = await admin.request(removalRoute, moderation(await admin.request(removalRoute)))
  assert.equal(removalFailure.status, 500)
  assert.equal(removalFailure.headers.get('location'), null)
  assert.equal(f.db((db) => db.prepare('SELECT body FROM forum_posts WHERE id=?').get(postId).body), savedBody)
  f.db((db) => db.exec('DROP TRIGGER fail_forum_update'))
  success(await admin.request('/new', compose(await admin.request('/new'), { title: 'Healthy after failure' })))
})

test('setup, registration and request defenses reject forged, duplicate and expired credentials', async (t) => {
  const f = await fixture(t)
  const a = client(f), b = client(f)
  const ap = await a.request('/install'), bp = await b.request('/install')
  assert.equal((await a.request('/install', { ...credentials(ap, 'keeper'), setupKey: 'wrong' })).status, 403)
  const installed = await Promise.all([
    a.request('/install', { ...credentials(ap, 'keeper'), setupKey }),
    b.request('/install', { ...credentials(bp, 'otherkeeper'), setupKey })
  ])
  assert.deepEqual(installed.map((r) => r.status).sort(), [303, 409])
  assert.equal((await a.request('/install')).status, 409)
  const ar = await a.request('/register'), br = await b.request('/register')
  const registered = await Promise.all([a.request('/register', credentials(ar, 'Alice')), b.request('/register', credentials(br, 'aLiCe'))])
  assert.deepEqual(registered.map((r) => r.status).sort(), [303, 409])
  assert.equal((await a.request('/register', { ...credentials(ar, 'Bad'), csrf: 'forged' })).status, 403)
  assert.equal((await a.request('/login', {}, { 'content-type': 'text/plain' })).status, 415)
  const page = await a.request('/login')
  assert.equal((await a.request('/login', { ...credentials(page, 'Alice'), password: 'wrong' })).status, 401)
  const oldCsrf = hidden(page, 'csrf')
  await login(a, 'Alice')
  const newPage = await a.request('/new')
  assert.equal((await a.request('/new', compose(newPage, { title: 'Bad CSRF', csrf: oldCsrf }))).status, 403)
  assert.equal((await a.request('/new', compose(newPage, { title: '', body: 'Something' }))).status, 422)
  const duplicate = new URLSearchParams(compose(newPage, { title: 'Duplicate field' }))
  duplicate.append('body', 'Another value')
  assert.equal((await a.request('/new', duplicate)).status, 400)
  assert.equal((await a.request('/logout')).status, 405)
  assert.equal((await a.request('/logout', { csrf: 'wrong' })).status, 403)
  for (const path of ['/_db.cow', '/_config.cow', '/_account.cow', '/_header', '/data/forum.sqlite', '/%2e%2e%2fdata/forum.sqlite', '/topic.cow']) assert.notEqual((await a.request(path)).status, 200, path)
  assert.equal((await a.request('/assets/site.css')).status, 200)
  f.db((db) => db.exec('UPDATE jin_sessions SET expires_at=0'))
  assert.equal((await a.request('/new')).headers.get('location'), '/login')
  // Login rate counters are shared in SQLite, not in an individual worker VM.
  const loginPage = await b.request('/login')
  let result
  for (let n = 0; n < 6; n++) result = await b.request('/login', { ...credentials(loginPage, 'nobody'), password: 'incorrect' })
  assert.equal(result.status, 429)
  const configFile = join(f.site, '_config.cow')
  await writeFile(configFile, (await readFile(configFile, 'utf8')).replace('registrationOpen: true', 'registrationOpen: false'))
  assert.equal((await a.request('/register')).status, 403)
})

test('forum setup is repeatable, preserves data and stops printing its key after installation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cow-forum-setup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(join(project, 'examples/forum/setup.mjs'), join(root, 'setup.mjs'))
  const run = () => execFileSync(process.execPath, [join(root, 'setup.mjs')], { encoding: 'utf8' })
  assert.match(run(), /Setup key:/)
  const key = await readFile(join(root, 'data/setup-key'), 'utf8')
  assert.match(run(), new RegExp(key))
  const db = new DatabaseSync(join(root, 'data/forum.sqlite'))
  try {
    db.exec("CREATE TABLE forum_users(id INTEGER PRIMARY KEY, role TEXT); INSERT INTO forum_users VALUES(1, 'admin')")
  } finally { db.close() }
  assert.doesNotMatch(run(), /Setup key:/)
  assert.equal(await readFile(join(root, 'data/setup-key'), 'utf8'), key)
})
