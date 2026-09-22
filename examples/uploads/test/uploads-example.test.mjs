import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../../../lib/app.mjs'

test('the uploads example receives, escapes and optionally keeps a file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cow-uploads-example-'))
  const site = join(root, 'site')
  let app
  t.after(async () => { await app?.close(); await rm(root, { recursive: true, force: true }) })
  await cp(fileURLToPath(new URL('../site', import.meta.url)), site, { recursive: true })
  app = new CowApp({ rootDir: site, host: '127.0.0.1', port: 0, workers: 1, logger: { error() {} } })
  const { url } = await app.start()
  assert.equal((await fetch(url)).status, 200)
  for (const keep of [false, true]) {
    const form = new FormData()
    form.append('label', '<script>label</script>')
    form.append('attachment', new Blob([new Uint8Array([0, 255, 42])]), 'sample.bin')
    if (keep) form.append('keep', 'yes')
    const response = await fetch(url, { method: 'POST', body: form })
    const text = await response.text()
    assert.equal(response.status, 200, text)
    assert.match(text, /&lt;script&gt;label&lt;\/script&gt;/)
    if (!keep) await assert.rejects(readdir(join(root, 'data')), { code: 'ENOENT' })
  }
  const files = await readdir(join(root, 'data'))
  assert.equal(files.length, 1)
  assert.match(files[0], /^[a-f0-9-]+\.bin$/)
  assert.deepEqual([...await readFile(join(root, 'data', files[0]))], [0, 255, 42])
})
