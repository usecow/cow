import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import {
  __closeWorkerResources,
  __resourceStatus,
  __runWithResourceRequest
} from '../lib/resource.mjs'
import { sqlite } from '../lib/sqlite.mjs'

let temporaryRoot
let nextRequestId = 1

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'cow-sqlite-test-'))
})

after(async () => {
  await __closeWorkerResources()
  await rm(temporaryRoot, { recursive: true, force: true })
})

function request(callback) {
  const controller = new AbortController()
  return __runWithResourceRequest({
    request: {
      id: `sqlite-test-${nextRequestId++}`,
      url: '/sqlite-test',
      method: 'GET',
      headers: {}
    },
    signal: controller.signal
  }, callback)
}

test('persists data while keeping SQLite handles request-scoped', async () => {
  const filename = join(temporaryRoot, 'persistence.sqlite')
  let expiredHandle

  await request(async () => {
    const database = await sqlite(filename)
    assert.equal(await sqlite(filename), database)
    expiredHandle = database

    database.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      )
    `)
    const inserted = database.run('INSERT INTO users (name) VALUES (?)', ['Ada'])
    assert.equal(inserted.changes, 1)
    assert.equal(inserted.lastInsertRowid, 1)
    database.run('INSERT INTO users (name) VALUES ($name)', { name: 'Grace' })

    assert.deepEqual(database.get('SELECT id, name FROM users WHERE name = ?', ['Ada']), {
      id: 1,
      name: 'Ada'
    })
    assert.deepEqual(database.query('SELECT name FROM users ORDER BY id'), [
      { name: 'Ada' },
      { name: 'Grace' }
    ])
  })

  assert.throws(
    () => expiredHandle.get('SELECT 1'),
    (error) => error.code === 'COW_SQLITE_LEASE_CLOSED'
  )

  await request(async () => {
    const database = await sqlite({ filename })
    assert.notEqual(database, expiredHandle)
    assert.equal(database.get('SELECT count(*) AS count FROM users').count, 2)
    assert.deepEqual(database.get('PRAGMA foreign_keys'), { foreign_keys: 1 })
    assert.deepEqual(database.get('PRAGMA busy_timeout'), { timeout: 5000 })
    assert.throws(
      () => database.run('INSERT INTO users (name) VALUES (?)', ['Ada']),
      (error) => error.code === 'ERR_SQLITE_ERROR'
    )
  })

  const status = __resourceStatus().adapters.sqlite
  assert.equal(status.instances, 1)
  assert.equal(status.opens, 1)
  assert.equal(status.acquisitions, 2)
  assert.equal(status.releases, 2)
})

test('commits managed transactions and rolls back failures and nesting', async () => {
  const filename = join(temporaryRoot, 'transactions.sqlite')

  await request(async () => {
    const database = await sqlite(filename)
    database.exec('CREATE TABLE events (name TEXT NOT NULL)')

    const result = await database.transaction(async (transaction) => {
      transaction.run('INSERT INTO events (name) VALUES (?)', ['committed'])
      return 'result'
    }, { mode: 'immediate' })
    assert.equal(result, 'result')

    await assert.rejects(
      database.transaction(async (transaction) => {
        transaction.run('INSERT INTO events (name) VALUES (?)', ['rolled back'])
        throw new Error('stop')
      }),
      /stop/
    )

    await database.transaction(async (outer) => {
      outer.run('INSERT INTO events (name) VALUES (?)', ['outer'])
      await assert.rejects(
        outer.transaction(async (inner) => {
          inner.run('INSERT INTO events (name) VALUES (?)', ['inner'])
          throw new Error('nested stop')
        }),
        /nested stop/
      )
    })

    assert.deepEqual(database.all('SELECT name FROM events ORDER BY rowid'), [
      { name: 'committed' },
      { name: 'outer' }
    ])
  })
})

test('rolls back unfinished manual and raw transactions between requests', async () => {
  const filename = join(temporaryRoot, 'leaks.sqlite')

  await request(async () => {
    const database = await sqlite(filename)
    database.exec('CREATE TABLE values_table (value TEXT)')
    database.begin()
    database.run('INSERT INTO values_table VALUES (?)', ['managed leak'])
  })

  await request(async () => {
    const database = await sqlite(filename)
    assert.equal(database.get('SELECT count(*) AS count FROM values_table').count, 0)
    database.exec('BEGIN')
    database.run('INSERT INTO values_table VALUES (?)', ['raw leak'])
  })

  await request(async () => {
    const database = await sqlite(filename)
    assert.equal(database.inTransaction, false)
    assert.equal(database.get('SELECT count(*) AS count FROM values_table').count, 0)
  })
})

test('enforces foreign keys and validates connection options', async () => {
  const filename = join(temporaryRoot, 'safety.sqlite')

  await request(async () => {
    const database = await sqlite(filename, { timeout: 25 })
    database.exec(`
      CREATE TABLE parents (id INTEGER PRIMARY KEY);
      CREATE TABLE children (parent_id INTEGER REFERENCES parents(id));
    `)
    assert.throws(
      () => database.run('INSERT INTO children (parent_id) VALUES (?)', [999]),
      (error) => error.code === 'ERR_SQLITE_ERROR'
    )
    assert.deepEqual(database.get('PRAGMA busy_timeout'), { timeout: 25 })

    await assert.rejects(sqlite(filename, { extensions: true }), {
      code: 'COW_SQLITE_OPTIONS_INVALID'
    })
    await assert.rejects(sqlite(filename, { timeout: -1 }), {
      code: 'COW_SQLITE_OPTIONS_INVALID'
    })
  })
})

test('supports read-only connections without exposing native database handles', async () => {
  const filename = join(temporaryRoot, 'readonly.sqlite')

  await request(async () => {
    const writable = await sqlite(filename)
    writable.exec('CREATE TABLE records (value TEXT); INSERT INTO records VALUES (\'saved\')')
  })

  await request(async () => {
    const readonly = await sqlite(filename, { readOnly: true })
    assert.deepEqual(readonly.all('SELECT value FROM records'), [{ value: 'saved' }])
    assert.equal('prepare' in readonly, false)
    assert.equal('close' in readonly, false)
    assert.throws(
      () => readonly.run('INSERT INTO records VALUES (?)', ['blocked']),
      (error) => error.code === 'ERR_SQLITE_ERROR'
    )
  })
})

test('keeps distinct statement configurations from sharing a request facade', async () => {
  const filename = join(temporaryRoot, 'statement-options.sqlite')

  await request(async () => {
    const objects = await sqlite(filename)
    objects.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)')
    objects.run('INSERT INTO items (value) VALUES (?)', ['configured'])

    const arrays = await sqlite(filename, { returnArrays: true })
    assert.notEqual(arrays, objects)
    assert.deepEqual(objects.get('SELECT id, value FROM items'), {
      id: 1,
      value: 'configured'
    })
    assert.deepEqual(arrays.get('SELECT id, value FROM items'), [1, 'configured'])
  })
})

test('requires an active Cow request', async () => {
  await assert.rejects(sqlite(join(temporaryRoot, 'outside.sqlite')), {
    code: 'COW_RESOURCE_OUTSIDE_REQUEST'
  })
})

test('managed transactions reject premature commits and concurrent use before it mutates data', async () => {
  await request(async () => {
    const db = await sqlite(join(temporaryRoot, 'ownership.sqlite'))
    db.exec('CREATE TABLE events(value TEXT)')
    for (const finish of [() => db.commit(), () => db.rollback(), () => db.begin(), () => db.exec('/* comment */ COMMIT'), () => db.run('END')]) {
      await assert.rejects(db.transaction(() => {
        db.run("INSERT INTO events VALUES ('should roll back')")
        finish()
      }), { code: 'COW_SQLITE_TRANSACTION_STATE_INVALID' })
      assert.equal(db.get('SELECT count(*) AS n FROM events').n, 0)
    }
    let release
    const barrier = new Promise((resolve) => { release = resolve })
    const transaction = db.transaction(async () => {
      db.run("INSERT INTO events VALUES ('held')")
      await barrier
    })
    assert.throws(() => db.run("INSERT INTO events VALUES ('outside')"), { code: 'COW_SQLITE_TRANSACTION_CONCURRENT' })
    await assert.rejects(db.transaction(() => {}), { code: 'COW_SQLITE_TRANSACTION_CONCURRENT' })
    release()
    await transaction
    assert.deepEqual(db.all('SELECT value FROM events'), [{ value: 'held' }])
  })
})
