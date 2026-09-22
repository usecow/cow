import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { threadId, workerData } from 'node:worker_threads'

const BRIDGE_SYMBOL = Symbol.for('cow.resource.runtime')
const METRIC_NAMES = [
  'opens',
  'openFailures',
  'acquisitions',
  'acquireFailures',
  'releases',
  'releaseFailures',
  'closes',
  'closeFailures'
]

function emptyMetrics() {
  return Object.fromEntries(METRIC_NAMES.map((name) => [name, 0]))
}

function codedError(message, code, status, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.name = 'CowResourceError'
  error.code = code
  error.status = status
  return error
}

function cloneOptions(options) {
  try {
    return structuredClone(options ?? {})
  } catch (cause) {
    throw codedError(
      'Persistent resource options must be structured-cloneable',
      'COW_RESOURCE_OPTIONS_INVALID',
      500,
      cause
    )
  }
}

function requestView(request = {}) {
  return Object.freeze({
    id: String(request.id || ''),
    url: String(request.url || '/'),
    method: String(request.method || 'GET'),
    headers: Object.freeze({ ...(request.headers || {}) })
  })
}

function createBridge({ maxResources = 64, maxAdapters = 128 } = {}) {
  for (const [name, value] of Object.entries({ maxResources, maxAdapters })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid ${name}: ${value}`)
  }
  const requestStorage = new AsyncLocalStorage()
  const definitions = new Map()
  const entries = new Map()
  const metrics = emptyMetrics()
  const adapterMetrics = new Map()
  let closing = false
  let observer = null
  let admissionQueue = Promise.resolve()
  let sequence = 0
  let recycleRequired = false
  let closePromise = null
  let evictions = 0

  const notify = () => {
    try {
      observer?.(status())
    } catch {}
  }

  const metricsFor = (name) => {
    if (!adapterMetrics.has(name)) {
      adapterMetrics.set(name, {
        ...emptyMetrics(),
        lastFailure: null
      })
    }
    return adapterMetrics.get(name)
  }

  const record = (name, metric) => {
    metrics[metric] += 1
    metricsFor(name)[metric] += 1
  }

  const failed = (name, code) => {
    metricsFor(name).lastFailure = {
      code,
      at: new Date().toISOString()
    }
  }

  const recovered = (name) => {
    metricsFor(name).lastFailure = null
  }

  async function dispose(entry) {
    if (entry.disposal) return entry.disposal
    if (entry.refs !== 0) throw codedError('Cannot close a leased persistent resource', 'COW_RESOURCE_BUSY', 503)
    entry.state = 'closing'
    entry.disposal = Promise.resolve().then(async () => {
      try {
        await entry.definition.close(entry.value, { worker: Object.freeze({ id: threadId }) })
        record(entry.name, 'closes')
        if (entries.get(entry.id) === entry) entries.delete(entry.id)
      } catch (cause) {
        entry.state = 'failed'
        entry.poisoned = true
        recycleRequired = true
        record(entry.name, 'closeFailures')
        failed(entry.name, cause?.code || 'COW_RESOURCE_CLOSE_FAILED')
        // Keep the failed-close tombstone: deleting it would hide a live native
        // handle and permit repeated opens beyond the configured capacity.
        throw codedError(`Could not close persistent resource ${entry.name}`, 'COW_RESOURCE_CLOSE_FAILED', 500, cause)
      } finally { notify() }
    })
    return entry.disposal
  }

  function reserve(resourceId, name, definition, options) {
    const reservation = admissionQueue.then(async () => {
      if (closing || recycleRequired) throw codedError('Persistent resources are unavailable until worker replacement', 'COW_RESOURCE_UNAVAILABLE', 503)
      let entry = entries.get(resourceId)
      if (entry?.poisoned || entry?.state === 'closing') {
        throw codedError(`Persistent resource ${name} is being discarded`, 'COW_RESOURCE_POISONED', 503)
      }
      if (!entry) {
        if (entries.size >= maxResources) {
          const idle = [...entries.values()].filter(item => item.refs === 0 && item.state === 'ready' && !item.poisoned)
            .sort((a, b) => a.lastUsed - b.lastUsed)[0]
          if (!idle) throw codedError('All persistent resource slots are in use', 'COW_RESOURCE_LIMIT', 503)
          await dispose(idle)
          evictions++
        }
        entry = { id: resourceId, name, definition, state: 'opening', value: undefined,
          activeLeases: 0, refs: 0, opening: null, poisoned: false, disposal: null, lastUsed: ++sequence }
        entries.set(resourceId, entry)
        entry.opening = Promise.resolve()
          .then(() => definition.open(options, { worker: Object.freeze({ id: threadId }) }))
          .then(value => {
            entry.value = value
            entry.state = 'ready'
            record(name, 'opens')
            recovered(name)
            notify()
            return value
          }).catch(cause => {
            if (entries.get(resourceId) === entry) entries.delete(resourceId)
            record(name, 'openFailures')
            failed(name, cause?.code || 'COW_RESOURCE_OPEN_FAILED')
            notify()
            throw codedError(`Could not open persistent resource ${name}`, 'COW_RESOURCE_OPEN_FAILED', 503, cause)
          })
        entry.opening.catch(() => {})
      }
      entry.refs++ // includes pending open/acquire, not only completed leases
      entry.lastUsed = ++sequence
      return entry
    })
    admissionQueue = reservation.then(() => {}, () => {})
    return reservation
  }

  function defineResource(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('defineResource requires a resource definition')
    }

    const name = String(definition.name || '')
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new TypeError('A resource name may only contain letters, numbers, dots, underscores, and dashes')
    }
    if (typeof definition.key !== 'function') {
      throw new TypeError(`Resource adapter ${name} must define key(options)`)
    }
    if (typeof definition.open !== 'function') {
      throw new TypeError(`Resource adapter ${name} must define open(options)`)
    }
    if (typeof definition.close !== 'function') {
      throw new TypeError(`Resource adapter ${name} must define close(resource)`)
    }
    if (definitions.has(name) && definitions.get(name) !== definition) {
      throw codedError(
        `Persistent resource adapter ${name} is already registered in this worker`,
        'COW_RESOURCE_DUPLICATE',
        500
      )
    }

    if (!definitions.has(name) && definitions.size >= maxAdapters) {
      recycleRequired = true
      throw codedError('Persistent resource adapter limit reached', 'COW_ADAPTER_LIMIT', 503)
    }

    definitions.set(name, definition)
    metricsFor(name)
    notify()

    return Object.freeze(async function acquireResource(inputOptions = {}) {
      const scope = requestStorage.getStore()
      if (!scope || scope.closed) {
        throw codedError(
          `Persistent resource ${name} can only be acquired while handling a Cow request`,
          'COW_RESOURCE_OUTSIDE_REQUEST',
          500
        )
      }
      if (closing) {
        throw codedError(
          `Persistent resource ${name} is shutting down`,
          'COW_RESOURCE_UNAVAILABLE',
          503
        )
      }

      const options = cloneOptions(inputOptions)
      let rawKey
      try {
        rawKey = definition.key(options)
      } catch (cause) {
        throw codedError(
          `Could not identify persistent resource ${name}`,
          'COW_RESOURCE_KEY_FAILED',
          500,
          cause
        )
      }
      if (!['string', 'number', 'bigint', 'boolean'].includes(typeof rawKey)) {
        throw codedError(
          `Resource adapter ${name} returned an invalid key`,
          'COW_RESOURCE_KEY_INVALID',
          500
        )
      }

      const keyHash = createHash('sha256')
        .update(`${name}\0${String(rawKey)}`)
        .digest('hex')
        .slice(0, 20)
      const resourceId = `${name}:${keyHash}`
      if (scope.leases.has(resourceId)) return scope.leases.get(resourceId).value
      if (scope.pending.has(resourceId)) return scope.pending.get(resourceId)

      const acquisition = (async () => {
        const entry = await reserve(resourceId, name, definition, options)
        try { await entry.opening } catch (error) { entry.refs--; throw error }
        let value
        try {
          value = definition.acquire
            ? await definition.acquire(entry.value, {
                options,
                request: scope.request,
                signal: scope.signal
              })
            : entry.value
          if (entry.poisoned) throw codedError(`Persistent resource ${name} failed during acquisition`, 'COW_RESOURCE_POISONED', 503)
        } catch (cause) {
          entry.poisoned = true
          entry.refs--
          record(name, 'acquireFailures')
          failed(name, cause?.code || 'COW_RESOURCE_ACQUIRE_FAILED')
          notify()
          const error = codedError(
            `Could not acquire persistent resource ${name}`,
            'COW_RESOURCE_ACQUIRE_FAILED',
            503,
            cause
          )
          if (entry.refs === 0) {
            try { await dispose(entry) } catch (closeError) {
              throw Object.assign(new AggregateError([error, closeError], error.message, { cause: error }), {
                code: 'COW_RESOURCE_ACQUIRE_FAILED', status: 503
              })
            }
          }
          throw error
        }

        const lease = { definition, entry, name, options, value }
        scope.leases.set(resourceId, lease)
        scope.order.push(resourceId)
        entry.activeLeases += 1
        record(name, 'acquisitions')
        if (!entry.poisoned) recovered(name)
        notify()
        return value
      })()

      scope.pending.set(resourceId, acquisition)
      try {
        return await acquisition
      } finally {
        scope.pending.delete(resourceId)
      }
    })
  }

  async function releaseRequest(scope, requestError) {
    scope.closed = true
    const errors = []

    // Promise.all can reject while another accepted acquisition is opening.
    // Seal admission, then drain those acquisitions before enumerating leases.
    // The worker's execution deadline also bounds this teardown barrier.
    const pending = await Promise.allSettled([...scope.pending.values()])
    if (!requestError) {
      errors.push(...pending.filter(result => result.status === 'rejected').map(result => result.reason))
    }
    const outcomeError = requestError || errors[0]

    for (const resourceId of scope.order.reverse()) {
      const lease = scope.leases.get(resourceId)
      if (!lease) continue
      try {
        await lease.definition.release?.(lease.value, {
          resource: lease.entry.value,
          options: lease.options,
          request: scope.request,
          signal: scope.signal,
          error: outcomeError || null
        })
        record(lease.name, 'releases')
        if (!lease.entry.poisoned) recovered(lease.name)
      } catch (error) {
        lease.entry.poisoned = true
        errors.push(error)
        record(lease.name, 'releaseFailures')
        failed(lease.name, error?.code || 'COW_RESOURCE_RELEASE_FAILED')
      } finally {
        lease.entry.activeLeases = Math.max(0, lease.entry.activeLeases - 1)
        lease.entry.refs--
        lease.entry.lastUsed = ++sequence
        if (lease.entry.poisoned && lease.entry.refs === 0) {
          try { await dispose(lease.entry) } catch (error) { errors.push(error) }
        }
        notify()
      }
    }

    scope.leases.clear()
    scope.pending.clear()
    if (errors.length > 0) {
      const failures = requestError ? [requestError, ...errors] : errors
      const error = new AggregateError(failures, 'One or more persistent resource leases could not be released')
      error.code = 'COW_RESOURCE_RELEASE_FAILED'
      error.status = 500
      if (requestError) error.cause = requestError
      throw error
    }
  }

  async function runWithRequest({ request, signal, getOutcomeError }, callback) {
    const scope = {
      request: requestView(request),
      signal,
      leases: new Map(),
      pending: new Map(),
      order: [],
      closed: false
    }

    return requestStorage.run(scope, async () => {
      let result
      let requestError
      try {
        result = await callback()
      } catch (error) {
        requestError = error || new Error(`Request threw ${String(error)}`, { cause: error })
      }

      await releaseRequest(scope, requestError || getOutcomeError?.())
      if (requestError) throw requestError
      return result
    })
  }

  async function closeAll() {
    if (closePromise) return closePromise
    closing = true
    closePromise = (async () => {
      await admissionQueue
      const errors = []

      for (const entry of [...entries.values()].reverse()) {
        try {
          await entry.opening
          await dispose(entry)
        } catch (error) {
          errors.push(error)
        } finally {
          notify()
        }
      }

      if (errors.length > 0) {
        const error = new AggregateError(errors, 'One or more persistent resources could not be closed')
        error.code = 'COW_RESOURCE_CLOSE_FAILED'
        throw error
      }
    })().finally(() => { closing = false; closePromise = null })
    return closePromise
  }

  function status() {
    const adapters = {}
    for (const [name, definitionMetrics] of adapterMetrics) {
      const matching = [...entries.values()].filter((entry) => entry.name === name)
      const ready = matching.filter((entry) => entry.state === 'ready').length
      const opening = matching.filter((entry) => entry.state === 'opening').length
      const activeLeases = matching.reduce((total, entry) => total + entry.activeLeases, 0)
      const lastFailure = definitionMetrics.lastFailure
      const state = opening > 0
        ? 'opening'
        : ready > 0
          ? lastFailure ? 'degraded' : 'ready'
          : lastFailure ? 'failed' : 'idle'

      adapters[name] = {
        state,
        instances: matching.length,
        activeLeases,
        ...Object.fromEntries(METRIC_NAMES.map((metric) => [metric, definitionMetrics[metric]])),
        lastFailure
      }
    }

    return {
      instances: entries.size,
      maxResources,
      maxAdapters,
      registeredAdapters: definitions.size,
      evictions,
      recycleRequired,
      activeLeases: [...entries.values()].reduce((total, entry) => total + entry.activeLeases, 0),
      metrics: { ...metrics },
      adapters
    }
  }

  function observe(callback) {
    observer = typeof callback === 'function' ? callback : null
  }

  function assertResponseReady() {
    const scope = requestStorage.getStore()
    for (const lease of scope?.leases.values() || []) {
      const result = lease.definition.beforeResponse?.(lease.value)
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {})
        throw codedError('beforeResponse must be synchronous', 'COW_RESOURCE_ASYNC_RESPONSE_CHECK', 500)
      }
    }
  }

  return Object.freeze({
    version: 1,
    defineResource,
    runWithRequest,
    closeAll,
    status,
    observe,
    assertResponseReady
  })
}

const bridge = globalThis[BRIDGE_SYMBOL] || createBridge(workerData?.resourceLimits)
if (!globalThis[BRIDGE_SYMBOL]) {
  Object.defineProperty(globalThis, BRIDGE_SYMBOL, {
    value: bridge,
    enumerable: false,
    configurable: false,
    writable: false
  })
}

export const defineResource = (definition) => bridge.defineResource(definition)
export const resourceProtocolVersion = bridge.version

export const __runWithResourceRequest = (context, callback) => bridge.runWithRequest(context, callback)
export const __closeWorkerResources = () => bridge.closeAll()
export const __resourceStatus = () => bridge.status()
export const __observeResourceStatus = (callback) => bridge.observe(callback)
export const __assertResponseReady = () => bridge.assertResponseReady()
export const __createResourceRuntime = (options) => createBridge(options)
