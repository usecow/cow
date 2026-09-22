import { appendFile } from 'node:fs/promises'
import { defineResource } from '@cowlang/cow/resource'

async function event(marker, value) {
  await appendFile(marker, `${value}\n`)
}

const acquireTrackedResource = defineResource({
  name: 'test-resource',

  key(options) {
    return `${options.marker}:${options.key || 'default'}`
  },

  async open(options) {
    await event(options.marker, 'open')
    if (options.failOpen) {
      const error = new Error('Fixture resource could not open')
      error.code = 'TEST_RESOURCE_OPEN_FAILED'
      throw error
    }
    return {
      marker: options.marker,
      uses: 0,
      failClose: options.failClose === true,
      hangClose: options.hangClose === true
    }
  },

  async acquire(resource, { options, request }) {
    if (options.failAcquire) {
      const error = new Error('Fixture resource could not be acquired')
      error.code = 'TEST_RESOURCE_ACQUIRE_FAILED'
      throw error
    }
    resource.uses += 1
    await event(resource.marker, `acquire:${resource.uses}`)
    return Object.freeze({
      requestId: request.id,
      use: resource.uses
    })
  },

  async release(value, { resource, options, error }) {
    await event(resource.marker, `release:${error ? 'error' : 'ok'}:${value.use}`)
    if (options.failRelease) {
      const failure = new Error('Fixture resource could not release')
      failure.code = 'TEST_RESOURCE_RELEASE_FAILED'
      throw failure
    }
  },

  async close(resource) {
    await event(resource.marker, 'close')
    if (resource.hangClose) await new Promise(() => {})
    if (resource.failClose) {
      const error = new Error('Fixture resource could not close')
      error.code = 'TEST_RESOURCE_CLOSE_FAILED'
      throw error
    }
  }
})

export function trackedResource(options) {
  return acquireTrackedResource(options)
}
