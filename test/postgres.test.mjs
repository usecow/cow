import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { after, before, test } from 'node:test'
import pg from 'pg'
import { CowApp } from '../lib/app.mjs'

// Needs a real database: COW_TEST_POSTGRES_URL=postgres://user:pass@host/db.
// Each run works in its own schema, so parallel runs do not collide.
const baseUrl = process.env.COW_TEST_POSTGRES_URL
const skip = baseUrl ? false : 'set COW_TEST_POSTGRES_URL to run the Postgres tests'
const schema = `cow_test_${process.pid}_${Date.now()}`
let url, admin, root, app

before(async () => {
  if (!baseUrl) return
  admin = new pg.Client({ connectionString: baseUrl })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  const scoped = new URL(baseUrl)
  scoped.searchParams.set('options', `-c search_path=${schema}`)
  url = scoped.href
  root = await mkdtemp(join(tmpdir(), 'cow-postgres-'))
  await writeFile(join(root, '_db.cow'), `<?js
import { postgres } from 'cow:postgres'
export default await postgres(${JSON.stringify(url)})
`)
  app = new CowApp({ rootDir: root, workers: 2, logger: { error() {} } })
  await app.initialize()
})

after(async () => {
  await app?.close().catch(() => {})
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {})
    await admin.end()
  }
  if (root) await rm(root, { recursive: true, force: true })
})

// Needs no database: a stand-in pg in the site records what Cow sends it.
test('cow:postgres loads pg from the site and drives transactions through it', async t => {
  const site = await mkdtemp(join(tmpdir(), 'cow-postgres-driver-'))
  const fake = new CowApp({ rootDir: site, workers: 1, logger: { error() {} } })
  t.after(async () => { await fake.close().catch(() => {}); await rm(site, { recursive: true, force: true }) })
  await mkdir(join(site, 'node_modules/pg'), { recursive: true })
  await writeFile(join(site, 'node_modules/pg/package.json'), JSON.stringify({ name: 'pg', main: 'index.js' }))
  await writeFile(join(site, 'node_modules/pg/index.js'), `
const { appendFileSync } = require('node:fs')
const log = entry => appendFileSync(require('node:path').join(__dirname, '../../driver.log'), JSON.stringify(entry) + '\\n')
let connections = 0
class Client {
  constructor(id) { this.id = id }
  async query(sql, parameters) {
    log([this.id, sql, parameters?.map(value => value instanceof Date ? 'Date ' + value.getTime() : value) ?? null])
    if (sql === 'FAIL') throw new Error('rejected by the fake server')
    return { rowCount: 1, rows: [{ sql }] }
  }
  release(destroy) { log([this.id, 'release', Boolean(destroy)]) }
}
exports.Pool = class Pool {
  constructor(config) { log(['pool', config.connectionString, config.max]) }
  query(sql, parameters) { return new Client('pool').query(sql, parameters) }
  async connect() { return new Client('c' + ++connections) }
  on() {}
  async end() {}
}
`)
  await writeFile(join(site, 'index.cow'), `<?js
import { postgres } from 'cow:postgres'
import { session } from 'cow:web'
const db = await postgres('postgres://fake/cow', { max: 3 })
const row = await db.get('SELECT $1', [new Date(0)])
await db.transaction(async tx => {
  await tx.run('A')
  try { await tx.transaction(async inner => { await inner.run('B'); throw new Error('undo B') }) } catch {}
})
let failure, sessions
try { await db.transaction(async tx => { await tx.run('FAIL') }) } catch (error) { failure = error.message }
try { await session(db, req, res) } catch (error) { sessions = error.message }
res.json({ row, failure, sessions })
?>`)
  await fake.initialize()
  for (let n = 0; n < 2; n++) {
    const result = await fake.execute({ url: '/' })
    assert.deepEqual(JSON.parse(Buffer.from(result.response.body).toString()), {
      row: { sql: 'SELECT $1' }, failure: 'rejected by the fake server',
      sessions: 'Sessions need a cow:sqlite database. Keep sessions in SQLite, even when the rest of the site uses Postgres.'
    })
  }
  const log = (await readFile(join(site, 'driver.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  const request = (first, second) => [
    ['pool', 'SELECT $1', ['Date 0']],
    [first, 'BEGIN', null], [first, 'A', null], [first, 'SAVEPOINT cow_0', null], [first, 'B', null],
    [first, 'ROLLBACK TO SAVEPOINT cow_0', null], [first, 'COMMIT', null], [first, 'release', false],
    [second, 'BEGIN', null], [second, 'FAIL', null], [second, 'ROLLBACK', null], [second, 'release', false],
    ['pool', "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('cow_sessions', 'jin_sessions')", null]
  ]
  // One pool serves both requests.
  assert.deepEqual(log, [['pool', 'postgres://fake/cow', 3], ...request('c1', 'c2'), ...request('c3', 'c4')])
})

async function page(name, source) {
  await writeFile(join(root, `${name}.cow`), source)
}

async function render(path, options) {
  const result = await app.execute({ url: path }, options)
  return { status: result.response.status, body: Buffer.from(result.response.body).toString() }
}

test('queries bind parameters and return plain rows, dates and changes', { skip }, async () => {
  await page('notes', `<?js
import db from './_db.cow'
await db.exec('CREATE TABLE IF NOT EXISTS notes (id serial PRIMARY KEY, title text NOT NULL, at timestamptz NOT NULL DEFAULT now())')
const inserted = await db.run('INSERT INTO notes (title) VALUES ($1) RETURNING id', [req.get('title')])
const row = await db.get('SELECT id, title, at FROM notes WHERE id = $1', [inserted.rows[0].id])
const all = await db.all('SELECT title FROM notes ORDER BY id')
res.json({ changes: inserted.changes, title: row.title, isDate: row.at instanceof Date, year: row.at.getUTCFullYear(), iso: typeof row.at.toISOString(), count: all.length })
?>`)
  const first = JSON.parse((await render('/notes?title=' + encodeURIComponent("Clover's <first>"))).body)
  assert.deepEqual(first, { changes: 1, title: "Clover's <first>", isDate: true, year: new Date().getUTCFullYear(), iso: 'string', count: 1 })
  const second = JSON.parse((await render('/notes?title=second')).body)
  assert.equal(second.count, 2)
})

test('transactions commit, roll back on failure, and nest with savepoints', { skip }, async () => {
  await page('tx', `<?js
import db from './_db.cow'
await db.exec('CREATE TABLE IF NOT EXISTS herd (name text PRIMARY KEY)')
await db.exec('TRUNCATE herd')
await db.transaction(async tx => {
  await tx.run('INSERT INTO herd VALUES ($1)', ['Clover'])
  try {
    await tx.transaction(async inner => {
      await inner.run('INSERT INTO herd VALUES ($1)', ['Daisy'])
      throw new Error('undo Daisy only')
    })
  } catch {}
})
try {
  await db.transaction(async tx => {
    await tx.run('INSERT INTO herd VALUES ($1)', ['Buttercup'])
    throw new Error('undo everything')
  })
} catch {}
const names = (await db.all('SELECT name FROM herd ORDER BY name')).map(r => r.name)
res.json({ names, inTransaction: db.inTransaction })
?>`)
  assert.deepEqual(JSON.parse((await render('/tx')).body), { names: ['Clover'], inTransaction: false })
})

test('ending the response inside a transaction fails it and rolls back', { skip }, async () => {
  await page('dangling', `<?js
import db from './_db.cow'
await db.exec('CREATE TABLE IF NOT EXISTS dangling (n int)')
await db.transaction(async tx => {
  await tx.run('INSERT INTO dangling VALUES (1)')
  res.json('too early')
})
?>`)
  await assert.rejects(render('/dangling'), { code: 'COW_POSTGRES_RESPONSE_IN_TRANSACTION' })
  await page('count', `<?js import db from './_db.cow' ?><?= (await db.get('SELECT count(*)::int AS n FROM dangling')).n ?>`)
  assert.equal((await render('/count')).body, '0')
})

test('migrate() runs each step once across requests and refuses a newer database', { skip }, async () => {
  await page('migrate', `<?js
import db from './_db.cow'
const steps = [
  'CREATE TABLE pasture (id serial PRIMARY KEY, name text NOT NULL)',
  'ALTER TABLE pasture ADD COLUMN acres int NOT NULL DEFAULT 1',
  async tx => { await tx.run('INSERT INTO pasture (name) VALUES ($1)', ['North']) }
]
const applied = await db.migrate(steps.slice(0, Number(req.get('steps'))))
?><?= applied ?>:<?= (await db.get('SELECT count(*)::int AS n FROM pasture')).n ?>`)
  assert.equal((await render('/migrate?steps=3')).body, '3:1')
  assert.equal((await render('/migrate?steps=3')).body, '3:1')
  await assert.rejects(render('/migrate?steps=2'), { code: 'COW_POSTGRES_MIGRATION_AHEAD' })
  const versions = await admin.query(`SELECT version FROM ${schema}.cow_migrations ORDER BY version`)
  assert.deepEqual(versions.rows.map(r => r.version), [1, 2, 3])
})

test('after a client disconnects, the page finishes but runs no further queries', { skip }, async () => {
  const marker = join(root, '_after-cancel')
  await page('cancel', `<?js
import db from './_db.cow'
import { writeFile } from 'node:fs/promises'
await db.query('SELECT pg_sleep(0.4)')
try { await db.query('SELECT 1'); await writeFile(${JSON.stringify(marker)}, 'ran') }
catch (error) { await writeFile(${JSON.stringify(marker)}, error.code) }
?>`)
  const controller = new AbortController()
  const pending = render('/cancel', { signal: controller.signal })
  const rejected = assert.rejects(pending, { code: 'COW_REQUEST_CANCELLED' })
  await delay(150)
  controller.abort()
  await rejected
  for (let n = 0; n < 100 && !(await readFile(marker, 'utf8').catch(() => '')); n++) await delay(20)
  assert.equal(await readFile(marker, 'utf8'), 'COW_REQUEST_CANCELLED')
})

test('postgres() rejects unknown options and a missing connection string', { skip }, async () => {
  await page('bad', `<?js
import { postgres } from 'cow:postgres'
const errors = []
for (const args of [[{ conectionString: 'x' }], [''], [{}]]) {
  try { await postgres(...args) } catch (error) { errors.push(error.name + ': ' + error.message) }
}
res.json(errors)
?>`)
  const errors = JSON.parse((await render('/bad')).body)
  assert.equal(errors.length, 3)
  assert.match(errors[0], /Unknown postgres\(\) option: conectionString/)
  assert.match(errors[1], /needs a connection string/)
})
