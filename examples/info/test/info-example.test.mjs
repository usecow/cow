import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CowApp } from '../../../lib/app.mjs'

test('the info example renders the runtime report read-only', async t => {
  const app = new CowApp({ rootDir: fileURLToPath(new URL('../site/', import.meta.url)), host: '127.0.0.1', port: 0, workers: 1, logger: { error() {} } })
  t.after(() => app.close())
  const { url } = await app.start()
  const response = await fetch(url)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.match(await response.text(), /Cow/)
})
