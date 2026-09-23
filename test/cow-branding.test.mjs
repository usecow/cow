import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { CowApp, CowCompileError, startCow } from '@cowlang/cow'
import { CowSQLiteError } from '@cowlang/cow/sqlite'

const root = fileURLToPath(new URL('../', import.meta.url))
const exec = promisify(execFile)

test('Cow package identity, lockfile, scoped exports and executable agree', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  assert.equal(manifest.name, '@cowlang/cow')
  assert.equal(lock.name, manifest.name)
  assert.equal(lock.packages[''].name, manifest.name)
  assert.equal(lock.version, manifest.version)
  assert.equal(lock.packages[''].version, manifest.version)
  assert.deepEqual(manifest.bin, { cow: 'bin/cow.mjs' })
  assert.deepEqual(lock.packages[''].bin, { cow: 'bin/cow.mjs' })
  for (const value of [CowApp, CowCompileError, CowSQLiteError, startCow]) assert.equal(typeof value, 'function')
  for (const subpath of ['web', 'sqlite', 'resource', 'csv', 'runtime']) await import('@cowlang/cow/' + subpath)
  const { stdout } = await exec(process.execPath, [join(root, 'bin/cow.mjs'), '--help'], { windowsHide: true })
  assert.match(stdout, /Usage: cow/)
  const version = await exec(process.execPath, [join(root, 'bin/cow.mjs'), '--version'], { windowsHide: true })
  assert.equal(version.stdout.trim(), manifest.version)
})

test('Cow page binding, diagnostics, error codes and default service endpoints', async t => {
  const site = await mkdtemp(join(tmpdir(), 'cow-branding-'))
  const app = new CowApp({ rootDir: site, port: 0, workers: 1, logger: { error() {} } })
  t.after(async () => { try { await app.close() } finally { await rm(site, { recursive: true, force: true }) } })
  await writeFile(join(site, 'index.cow'), '<?js cow.info({format:"json"}) ?>')
  await writeFile(join(site, 'bad.cow'), '<?js Promise.reject(new Error("expected")); ?>')
  const { url } = await app.start()
  const info = await (await fetch(url)).json()
  assert.equal(typeof info.runtime.cow, 'string')
  assert.equal(info.runtime.jin, undefined)
  assert.ok(info.capabilities.helpers.includes('cow:sqlite'))
  for (const path of ['/_cow/health', '/_cow/status']) assert.equal((await fetch(url + path)).status, 200)
  for (const path of ['/_jin/health', '/_jin/status']) assert.equal((await fetch(url + path)).status, 404)
  await assert.rejects(app.execute({ url: '/bad' }), { code: 'COW_UNHANDLED_REJECTION' })
})
