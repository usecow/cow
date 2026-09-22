import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CowApp } from '../lib/app.mjs'
import { hostRuntime } from '../lib/host-runtime.mjs'

test('SQLite eviction releases native file handles before worker shutdown', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cow-host-sqlite-'))
  const app = new CowApp({ rootDir: root, workers: 1, resourceLimit: 1, maxRequestsPerWorker: 0 })
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'index.cow'), `<?js
    import {sqlite} from ${JSON.stringify(new URL('../lib/sqlite.mjs', import.meta.url).href)};
    const name=req.get('db')==='b' ? 'b' : 'a';
    const db=await sqlite(new URL('./_'+name+'.sqlite',import.meta.url));
    db.exec('CREATE TABLE IF NOT EXISTS t(v)');db.run('INSERT INTO t VALUES (?)',[42]);
    res.json(db.get('SELECT v FROM t'));`)
  await app.initialize()
  for (const name of ['a', 'b']) assert.deepEqual(JSON.parse((await app.execute({ url: '/?db=' + name })).response.body), { v: 42 })
  // On Windows this fails with EBUSY if Bun's unreachable statements retain a
  // closed connection. Do not GC here: production eviction must release it.
  await rm(join(root, '_a.sqlite'))
  assert.equal(app.runtime.status().workersSpawned, 1)
  assert.equal(app.runtime.status().resources.metrics.closes, 1)
})

test('explicit unsupported worker heap bounds fail instead of silently pretending to enforce them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cow-host-bounds-'))
  const app = new CowApp({ rootDir: root, workers: 1, memoryLimitMb: 128 })
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }) })
  if (hostRuntime().workerHeapLimit) {
    await app.initialize()
    assert.equal(app.runtime.status().memoryLimitMb, 128)
  } else await assert.rejects(app.initialize(), { code: 'COW_RUNTIME_CAPABILITY' })
})
