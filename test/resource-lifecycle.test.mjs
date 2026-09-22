import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { defineResource, __runWithResourceRequest, __resourceStatus, __closeWorkerResources } from '../lib/resource.mjs'

after(() => __closeWorkerResources())

function request(callback) {
  return __runWithResourceRequest({ request: { id: 'lifecycle' }, signal: new AbortController().signal }, callback)
}

test('teardown drains a resource opening after a sibling Promise.all failure', async () => {
  const releases = []
  let acquisition
  const acquire = defineResource({
    name: 'late-opening', key: () => 'single',
    async open() { await delay(30); return {} },
    acquire: () => ({}),
    release(value, { error }) { releases.push(error.message) }, close() {}
  })
  await assert.rejects(request(async () => {
    acquisition = acquire()
    await Promise.all([acquisition, Promise.reject(new Error('Sibling failed'))])
  }), /Sibling failed/)
  await acquisition
  assert.deepEqual(releases, ['Sibling failed'])
  assert.equal(__resourceStatus().adapters['late-opening'].activeLeases, 0)
})

test('late acquisition is released once and release failures remain visible', async () => {
  let releases = 0, acquisition
  const acquire = defineResource({
    name: 'late-acquiring', key: () => 'single', open: () => ({}),
    async acquire() { await delay(30); return {} },
    release() { releases++; throw new Error('release failed') }, close() {}
  })
  await assert.rejects(request(async () => {
    acquisition = acquire()
    await Promise.all([acquisition, Promise.reject(new Error('Sibling failed'))])
  }), error => error.code === 'COW_RESOURCE_RELEASE_FAILED' && error.cause.message === 'Sibling failed')
  await acquisition
  assert.equal(releases, 1)
  assert.equal(__resourceStatus().adapters['late-acquiring'].activeLeases, 0)
})

test('rejected pending opens do not leak leases or hide the primary failure', async () => {
  const acquire = defineResource({
    name: 'late-rejecting', key: () => 'single',
    async open() { await delay(30); throw new Error('open failed') },
    close() {}
  })
  await assert.rejects(request(() => Promise.all([acquire(), Promise.reject(new Error('primary'))])), /primary/)
  assert.equal(__resourceStatus().adapters['late-rejecting'].activeLeases, 0)
  assert.equal(__resourceStatus().adapters['late-rejecting'].openFailures, 1)
})

test('teardown drains accepted acquisitions before releasing in reverse order', async () => {
  const events = []
  const acquire = defineResource({
    name: 'drain-order', key: options => options.key,
    async open(options) { if (options.key === 'late') await delay(30); return options.key },
    acquire: value => value,
    release(value) { events.push(value) }, close() {}
  })
  await request(async () => {
    await acquire({ key: 'early' })
    // Even if application code omits await, accepted acquisition must not leak.
    acquire({ key: 'late' })
  })
  assert.deepEqual(events, ['late', 'early'])
  assert.equal(__resourceStatus().adapters['drain-order'].activeLeases, 0)
})
