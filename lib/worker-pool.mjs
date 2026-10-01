import { realpathSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MessageChannel, Worker } from 'node:worker_threads'
import { hostRuntime, workerHostOptions } from './host-runtime.mjs'

// Start workers from the file's real path. On a case-insensitive disk one file
// is reachable as F:\Site and f:\site, and ES modules are cached by URL: the
// worker's own imports and the page imports it resolves through realpath would
// load two copies of Cow's native modules, splitting their shared state.
function canonicalWorkerURL(url) {
  if (!(url instanceof URL) || url.protocol !== 'file:') return url
  try {
    return pathToFileURL(realpathSync.native(fileURLToPath(url)))
  } catch {
    return url
  }
}

const RESOURCE_METRICS = [
  'opens',
  'openFailures',
  'acquisitions',
  'acquireFailures',
  'releases',
  'releaseFailures',
  'closes',
  'closeFailures'
]

function emptyResourceMetrics() {
  return Object.fromEntries(RESOURCE_METRICS.map((name) => [name, 0]))
}

export class RuntimeError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = details.name || 'RuntimeError'
    this.stack = details.stack || this.stack
    this.status = details.status
    this.code = details.code
    this.headers = details.headers
    if (details.cause) this.cause = new RuntimeError(details.cause.message, details.cause)
    if (details.errors) this.errors = details.errors.map(error => new RuntimeError(error.message, error))
    for (const name of ['filePath', 'line', 'column']) if (details[name] !== undefined) this[name] = details[name]
  }
}

export class WorkerPool {
  constructor({
    size,
    timeout = 10_000,
    maxQueue = 1_024,
    queueTimeout = 10_000,
    maxRequestsPerWorker = 1_000,
    memoryLimitMb = 256,
    shutdownTimeout = 5_000,
    outputLimit = 8_388_608,
    startupTimeout = 10_000,
    restartDelay = 100,
    restartMaxDelay = 5_000,
    restartLimit = 5,
    compilerLimits = {},
    resourceLimit = 64,
    adapterLimit = 128,
    namespaceLimit = 256,
    cache = true,
    diagnostics = {},
    logger = null,
    label = 'worker'
  } = {}, { createWorker = (url, options) => new Worker(url, options),
    workerURL = new URL('./runtime-worker.mjs', import.meta.url), timeoutCode = 'COW_EXECUTION_TIMEOUT' } = {}) {
    this.size = size ?? Math.max(1, Math.min(4, availableParallelism() - 1))
    this.timeout = timeout
    this.maxQueue = maxQueue
    this.queueTimeout = queueTimeout
    this.maxRequestsPerWorker = maxRequestsPerWorker
    this.memoryLimitMb = memoryLimitMb
    this.shutdownTimeout = shutdownTimeout
    this.outputLimit = outputLimit
    this.startupTimeout = startupTimeout
    this.restartDelay = restartDelay
    this.restartMaxDelay = restartMaxDelay
    this.restartLimit = restartLimit
    this.createWorker = createWorker
    this.workerURL = canonicalWorkerURL(workerURL)
    this.timeoutCode = timeoutCode
    this.compilerLimits = compilerLimits
    this.resourceLimit = resourceLimit
    this.adapterLimit = adapterLimit
    this.namespaceLimit = namespaceLimit
    this.lanes = []
    this.failed = false
    this.startPromise = null
    this.generation = 0
    this.cache = cache
    this.diagnostics = diagnostics
    this.logger = logger
    this.label = label
    this.workers = []
    this.queue = []
    this.nextId = 1
    this.started = false
    this.closing = false
    this.closePromise = null
    this.startedAt = Date.now()
    this.retiredResourceMetrics = emptyResourceMetrics()
    this.retiredResourceAdapters = {}
    this.metrics = {
      requestsAccepted: 0,
      requestsCompleted: 0,
      requestsFailed: 0,
      requestsTimedOut: 0,
      requestsRejected: 0,
      requestsCancelled: 0,
      requestsAbandoned: 0,
      queueTimeouts: 0,
      executionTimeMs: 0,
      workersSpawned: 0,
      workersRecycled: 0,
      workersCrashed: 0
    }
  }

  async start() {
    if (this.closing) throw new RuntimeError('Cow runtime is closing', { status: 503, code: 'COW_RUNTIME_CLOSING' })
    if (this.startPromise) return this.startPromise
    if (this.started) return
    this.started = true
    this.failed = false
    this.lanes = Array.from({ length: this.size }, () => ({ failures: 0, timer: null, failed: false, lastError: null }))
    const generation = this.generation
    const promise = (async () => {
      try {
        await Promise.all(this.lanes.map(lane => this.#spawn(lane)))
      } catch (error) {
        if (this.generation === generation) await this.close().catch(() => {})
        throw error
      } finally {
        if (this.startPromise === promise) this.startPromise = null
      }
    })()
    this.startPromise = promise
    return promise
  }

  #spawn(lane) {
    if (this.closing) return Promise.resolve()

    const worker = this.createWorker(this.workerURL, {
      workerData: { cache: this.cache, outputLimit: this.outputLimit, compilerLimits: this.compilerLimits,
        diagnostics: { ...this.diagnostics, workers:this.size, timeout:this.timeout, queueTimeout:this.queueTimeout,
          maxQueue:this.maxQueue, maxRequestsPerWorker:this.maxRequestsPerWorker, memoryLimitMb:hostRuntime().workerHeapLimit ? this.memoryLimitMb : null },
        resourceLimits: { maxResources: this.resourceLimit, maxAdapters: this.adapterLimit }, namespaceLimit: this.namespaceLimit },
      ...workerHostOptions(this.memoryLimitMb)
    })
    const slot = {
      worker,
      lane,
      failure: null,
      startupTimer: null,
      task: null,
      ready: false,
      retiring: false,
      terminating: false,
      crashCounted: false,
      requests: 0,
      resources: null,
      resourcesFolded: false,
      shutdownPromise: null,
      resolveShutdown: null,
      rejectShutdown: null,
      shutdownTimer: null,
      shutdownSent: false,
      shutdownAcknowledged: false,
      shutdownError: null,
      readySettled: false,
      resolveReady: null,
      rejectReady: null
    }
    const ready = new Promise((resolve, reject) => {
      slot.resolveReady = resolve
      slot.rejectReady = reject
    })

    this.metrics.workersSpawned += 1
    this.workers.push(slot)
    slot.startupTimer = setTimeout(() => {
      if (slot.readySettled) return
      slot.failure = new RuntimeError(`Cow worker did not become ready within ${this.startupTimeout}ms`, {
        status: 503, code: 'COW_WORKER_START_TIMEOUT'
      })
      slot.readySettled = true
      slot.rejectReady(slot.failure)
      slot.retiring = true
      slot.terminating = true
      slot.worker.terminate()
    }, this.startupTimeout)

    worker.on('message', (message) => {
      if (message?.type === 'ready') {
        if (slot.retiring || slot.readySettled) return
        clearTimeout(slot.startupTimer)
        slot.ready = true
        slot.resources = message.resources || null
        slot.readySettled = true
        slot.resolveReady()
        if (lane.failed) {
          // A retry after exhaustion started. One more failure before a
          // successful request fails the slot again; a benign recycle does not.
          lane.failed = false
          lane.failures = this.restartLimit
          this.failed = false
          this.#log('warn', `Cow ${this.label} slot ${this.lanes.indexOf(lane) + 1} started again after exhausting its restarts`)
        }
        this.#dispatch()
        return
      }
      if (message?.type === 'shutdown-complete') {
        slot.resources = message.resources || slot.resources
        slot.shutdownAcknowledged = true
        if (message.error) slot.shutdownError = new RuntimeError(message.error.message, message.error)
        slot.terminating = true
        slot.worker.terminate()
        return
      }
      if (message?.type === 'resource-status') {
        slot.resources = message.resources || slot.resources
        return
      }
      this.#finish(slot, message)
    })

    worker.on('error', (error) => {
      clearTimeout(slot.startupTimer)
      slot.failure = error
      if (!slot.readySettled) {
        slot.readySettled = true
        slot.rejectReady(error)
      }
      this.#fail(slot, error)
    })

    worker.on('exit', (code) => {
      clearTimeout(slot.startupTimer)
      if (!slot.readySettled) {
        slot.failure ||= new RuntimeError(`Cow worker exited during startup with code ${code}`, {
          status: 503, code: 'COW_WORKER_START_FAILED'
        })
        slot.readySettled = true
        slot.rejectReady(slot.failure)
      }
      if (slot.task) {
        this.#rejectTask(slot, new RuntimeError(`Cow worker exited with code ${code}`))
      }
      if (!slot.retiring && !slot.crashCounted && !this.closing) {
        slot.failure ||= new RuntimeError(`Cow worker exited unexpectedly with code ${code}`, {
          status: 503, code: 'COW_WORKER_EXIT'
        })
        slot.crashCounted = true
        this.metrics.workersCrashed += 1
      }
      if (slot.shutdownPromise && !slot.shutdownAcknowledged && !slot.shutdownError) {
        slot.shutdownError = new RuntimeError(
          `Cow worker exited before acknowledging persistent resource shutdown (code ${code})`,
          { code: 'COW_WORKER_SHUTDOWN_FAILED' }
        )
      }
      clearTimeout(slot.shutdownTimer)
      this.#foldResourceMetrics(slot)
      this.workers = this.workers.filter((item) => item !== slot)

      if (slot.shutdownPromise) {
        if (slot.shutdownError) slot.rejectShutdown(slot.shutdownError)
        else slot.resolveShutdown()
      }

      if (!this.closing && this.started) this.#recover(lane, slot.failure)
    })

    return ready
  }

  #recover(lane, error) {
    if (this.closing || !this.started) return
    if (error) {
      lane.failures += 1
      lane.lastError = { code: error.code || 'COW_WORKER_FAILED', message: error.message, at: new Date().toISOString() }
    }
    const slot = this.lanes.indexOf(lane) + 1
    const exhausted = lane.failures > this.restartLimit
    if (exhausted && !lane.failed) {
      lane.failed = true
      this.failed = this.lanes.every(lane => lane.failed)
      this.#log('error', `Cow ${this.label} slot ${slot} exhausted ${this.restartLimit} restarts` +
        ` (${lane.lastError?.code}: ${lane.lastError?.message}); retrying every ${this.restartMaxDelay}ms` +
        (this.failed ? '; no worker slot is left, so requests are refused until one starts' : ''))
      if (this.failed) {
        for (const task of [...this.queue]) this.#removeQueued(task, new RuntimeError(
          'Cow worker recovery exhausted; no worker runs until a restart attempt succeeds', {
            status: 503, code: 'COW_RECOVERY_EXHAUSTED'
          }
        ))
      }
    } else if (error && !exhausted) {
      this.#log('warn', `Cow ${this.label} slot ${slot} failed (${error.code || 'COW_WORKER_FAILED'}: ${error.message}); ` +
        `restart ${lane.failures} of ${this.restartLimit}`)
    }
    // An exhausted slot keeps retrying at the longest delay. A startup
    // deadline also fails on a host too busy to start a worker in time, and
    // such a host recovers; a runtime failed for good would refuse every
    // request until the application was restarted.
    const wait = exhausted ? this.restartMaxDelay
      : Math.min(this.restartMaxDelay, this.restartDelay * 2 ** Math.min(30, Math.max(0, lane.failures - 1)))
    lane.timer = setTimeout(() => {
      lane.timer = null
      try {
        // Async startup failures schedule recovery from the worker exit event.
        this.#spawn(lane).catch(() => {})
      } catch (failure) {
        this.#recover(lane, failure)
      }
    }, wait)
  }

  #log(level, message) {
    try { Promise.resolve(this.logger?.[level]?.(message)).catch(() => {}) } catch { /* logging never breaks recovery */ }
  }

  run(template, request, { signal, errorRoot, errorInfo, onStream } = {}) {
    if (onStream !== undefined && typeof onStream !== 'function') return Promise.reject(new TypeError('onStream must be a function'))
    if (!this.started || this.closing || this.failed) {
      return Promise.reject(new RuntimeError('Cow runtime is not accepting requests', {
        status: 503,
        code: 'COW_RUNTIME_UNAVAILABLE'
      }))
    }

    if (signal?.aborted) return Promise.reject(this.#cancellationError())
    const hasIdleWorker = this.workers.some((slot) => slot.ready && !slot.task && !slot.retiring)
    if (!hasIdleWorker && this.queue.length >= this.maxQueue) {
      this.metrics.requestsRejected += 1
      return Promise.reject(new RuntimeError('Cow runtime request queue is full', {
        status: 503,
        code: 'COW_QUEUE_FULL'
      }))
    }

    this.metrics.requestsAccepted += 1
    return new Promise((resolve, reject) => {
      const task = {
        id: this.nextId++,
        template,
        request,
        errorRoot,
        errorInfo,
        onStream,
        resolve,
        reject,
        timer: null,
        queueTimer: null,
        signal,
        onAbort: null,
        deadline: performance.now() + this.queueTimeout,
        acceptedAt: performance.now(),
        startedAt: null
      }
      task.onAbort = () => {
        this.metrics.requestsCancelled += 1
        if (this.#removeQueued(task, this.#cancellationError())) return
        const slot = this.workers.find(slot => slot.task === task)
        if (!slot || task.abandoned) return
        // The client is gone, but the page may be partway through a write.
        // Tell the caller now and let the page run to its end: its signal
        // aborts so cooperative code stops early, and the execution timeout
        // still ends a page that never finishes. Never retry it.
        task.abandoned = true
        this.metrics.requestsFailed += 1
        this.metrics.requestsAbandoned += 1
        task.reject(this.#cancellationError())
        try { slot.worker.postMessage({ type: 'cancel', id: task.id }) } catch { /* the worker is exiting */ }
      }
      task.queueTimer = setTimeout(() => {
        if (this.#removeQueued(task, new RuntimeError(`Cow request exceeded ${this.queueTimeout}ms queue deadline`, {
          status: 503, code: 'COW_QUEUE_TIMEOUT'
        }))) this.metrics.queueTimeouts += 1
      }, this.queueTimeout)
      signal?.addEventListener('abort', task.onAbort, { once: true })
      this.queue.push(task)
      this.#dispatch()
    })
  }

  #cancellationError() {
    return new RuntimeError('Cow request was cancelled; running writes may already have committed', {
      status: 499, code: 'COW_REQUEST_CANCELLED'
    })
  }

  #clearTask(task) {
    task.streamPort?.close()
    clearTimeout(task.timer)
    clearTimeout(task.queueTimer)
    task.signal?.removeEventListener('abort', task.onAbort)
  }

  #removeQueued(task, error) {
    const index = this.queue.indexOf(task)
    if (index < 0) return false
    this.queue.splice(index, 1)
    this.#clearTask(task)
    this.metrics.requestsFailed += 1
    task.reject(error)
    return true
  }

  #dispatch() {
    for (const slot of this.workers) {
      if (!slot.ready || slot.task || slot.retiring || this.queue.length === 0) continue
      let task
      while (this.queue.length) {
        const candidate = this.queue[0]
        if (performance.now() >= candidate.deadline) {
          this.#removeQueued(candidate, new RuntimeError('Cow request queue deadline expired', {
            status: 503, code: 'COW_QUEUE_TIMEOUT'
          }))
          this.metrics.queueTimeouts += 1
        } else {
          task = this.queue.shift()
          break
        }
      }
      if (!task) continue
      clearTimeout(task.queueTimer)
      slot.task = task
      task.startedAt = performance.now()
      task.timer = setTimeout(() => {
        const error = new RuntimeError(`Cow script exceeded ${this.timeout}ms execution timeout`, {
          status: 504,
          code: this.timeoutCode
        })
        this.metrics.requestsTimedOut += 1
        slot.retiring = true
        slot.terminating = true
        if (slot.shutdownPromise) slot.shutdownAcknowledged = true
        this.#rejectTask(slot, error)
        slot.worker.terminate()
      }, this.timeout)
      let streamPort
      if (task.onStream) {
        const {port1, port2} = new MessageChannel()
        task.streamPort = port1
        streamPort = port2
        port1.on('message', async message => {
          if (slot.task !== task) return
          // Nobody is reading an abandoned stream; end it instead of waiting.
          if (task.abandoned) return port1.postMessage({ ok: false, error: { message: 'Cow request was cancelled: the client disconnected', code: 'COW_REQUEST_CANCELLED', status: 499 } })
          try {
            await task.onStream(message)
            if (slot.task === task) port1.postMessage({ok:true})
          } catch (error) {
            if (slot.task === task) port1.postMessage({ok:false,error:{message:String(error?.message || error),code:error?.code,status:error?.status}})
          }
        })
      }
      try { slot.worker.postMessage({
        id: task.id,
        template: task.template,
        request: task.request,
        errorRoot: task.errorRoot,
        errorInfo: task.errorInfo,
        streamPort
      }, streamPort ? [streamPort] : []) } catch (error) {
        streamPort?.close()
        this.#rejectTask(slot, error)
        queueMicrotask(() => this.#dispatch())
      }
    }
  }

  #finish(slot, message) {
    const task = slot.task
    if (!task || message.id !== task.id) return
    this.#clearTask(task)
    slot.resources = message.resources || slot.resources
    slot.workerState = message.workerState || slot.workerState
    slot.task = null
    slot.requests += 1
    this.metrics.executionTimeMs += performance.now() - task.startedAt

    if (task.abandoned) {
      // Its caller was answered at cancellation; the worker is free again.
      if (message.ok) slot.lane.failures = 0
    } else if (message.ok) {
      // Ready alone is insufficient: a worker that immediately crashes again
      // must not reset its failure streak. A successful request does reset it.
      slot.lane.failures = 0
      this.metrics.requestsCompleted += 1
      task.resolve(message.result)
    } else {
      this.metrics.requestsFailed += 1
      task.reject(new RuntimeError(message.error.message, message.error))
    }

    if (this.closing) {
      this.#shutdown(slot).catch(() => {})
    } else if (message.workerState?.recycleRequired || message.resources?.recycleRequired ||
      (this.maxRequestsPerWorker > 0 && slot.requests >= this.maxRequestsPerWorker)) {
      this.#retire(slot)
    } else {
      this.#dispatch()
    }
  }

  #rejectTask(slot, error) {
    if (!slot.task) return
    this.#clearTask(slot.task)
    if (slot.task.startedAt !== null) {
      this.metrics.executionTimeMs += performance.now() - slot.task.startedAt
    }
    if (!slot.task.abandoned) this.metrics.requestsFailed += 1
    slot.task.reject(error)
    slot.task = null
  }

  #fail(slot, error) {
    if (!slot.crashCounted && !this.closing) {
      slot.crashCounted = true
      this.metrics.workersCrashed += 1
    }
    slot.retiring = true
    slot.terminating = true
    this.#rejectTask(slot, new RuntimeError(error.message, error))
  }

  #retire(slot) {
    if (slot.retiring) return
    this.metrics.workersRecycled += 1
    this.#shutdown(slot).catch(() => {})
  }

  #shutdown(slot) {
    if (slot.shutdownPromise) {
      if (!slot.task) this.#sendShutdown(slot)
      return slot.shutdownPromise
    }
    slot.retiring = true
    slot.shutdownPromise = new Promise((resolve, reject) => {
      slot.resolveShutdown = resolve
      slot.rejectShutdown = reject
    })

    if (!slot.task) {
      if (slot.terminating) slot.shutdownAcknowledged = true
      else this.#sendShutdown(slot)
    }
    return slot.shutdownPromise
  }

  #sendShutdown(slot) {
    if (slot.shutdownSent) return
    slot.shutdownSent = true
    slot.shutdownTimer = setTimeout(() => {
      slot.shutdownError = new RuntimeError(
        `Cow worker did not close its persistent resources within ${this.shutdownTimeout}ms`,
        { code: 'COW_WORKER_SHUTDOWN_TIMEOUT' }
      )
      slot.terminating = true
      slot.worker.terminate()
    }, this.shutdownTimeout)
    slot.worker.postMessage({ type: 'shutdown' })
  }

  #foldResourceMetrics(slot) {
    if (slot.resourcesFolded || !slot.resources?.metrics) return
    slot.resourcesFolded = true
    for (const name of RESOURCE_METRICS) {
      this.retiredResourceMetrics[name] += Number(slot.resources.metrics[name] || 0)
    }
    for (const [name, adapter] of Object.entries(slot.resources.adapters || {})) {
      if (!Object.hasOwn(this.retiredResourceAdapters, name) && Object.keys(this.retiredResourceAdapters).length >= this.adapterLimit) continue
      const history = this.retiredResourceAdapters[name] ||= {
        ...emptyResourceMetrics(),
        lastFailure: null
      }
      for (const metric of RESOURCE_METRICS) {
        history[metric] += Number(adapter[metric] || 0)
      }
      if (adapter.lastFailure?.at >= (history.lastFailure?.at || '')) {
        history.lastFailure = adapter.lastFailure
      }
    }
  }

  status() {
    const busy = this.workers.filter((slot) => Boolean(slot.task)).length
    const ready = this.workers.filter((slot) => slot.ready && !slot.retiring).length
    const handled = this.metrics.requestsCompleted + this.metrics.requestsFailed
    const resourceMetrics = { ...this.retiredResourceMetrics }
    for (const slot of this.workers) {
      for (const name of RESOURCE_METRICS) {
        resourceMetrics[name] += Number(slot.resources?.metrics?.[name] || 0)
      }
    }
    const resourceAdapters = Object.fromEntries(
      Object.entries(this.retiredResourceAdapters).map(([name, adapter]) => [name, {
        state: 'inactive',
        workers: 0,
        instances: 0,
        activeLeases: 0,
        ...adapter,
        _states: []
      }])
    )
    for (const slot of this.workers) {
      for (const [name, adapter] of Object.entries(slot.resources?.adapters || {})) {
        const aggregate = resourceAdapters[name] ||= {
          state: 'idle',
          workers: 0,
          instances: 0,
          activeLeases: 0,
          ...emptyResourceMetrics(),
          lastFailure: null,
          _states: []
        }
        aggregate.workers += 1
        aggregate.instances += Number(adapter.instances || 0)
        aggregate.activeLeases += Number(adapter.activeLeases || 0)
        aggregate._states.push(adapter.state)
        for (const metric of RESOURCE_METRICS) {
          aggregate[metric] += Number(adapter[metric] || 0)
        }
        if (adapter.lastFailure?.at >= (aggregate.lastFailure?.at || '')) {
          aggregate.lastFailure = adapter.lastFailure
        }
      }
    }
    for (const adapter of Object.values(resourceAdapters)) {
      const states = adapter._states
      adapter.state = adapter.workers === 0
        ? 'inactive'
        : states.includes('failed') && adapter.instances === 0
          ? 'failed'
          : states.some((state) => state === 'failed' || state === 'degraded')
            ? 'degraded'
            : states.includes('opening')
              ? 'opening'
              : states.includes('ready')
                ? 'ready'
                : 'idle'
      delete adapter._states
    }

    return {
      state: this.closing ? 'closing' : !this.started ? 'stopped' : this.failed ? 'failed' :
        this.lanes.some(lane => lane.failed) ? 'degraded' : 'running',
      uptimeMs: Date.now() - this.startedAt,
      configuredWorkers: this.size,
      workers: this.workers.length,
      readyWorkers: ready,
      busyWorkers: busy,
      idleWorkers: Math.max(0, ready - busy),
      queuedRequests: this.queue.length,
      maxQueue: this.maxQueue,
      queueTimeout: this.queueTimeout,
      maxRequestsPerWorker: this.maxRequestsPerWorker,
      memoryLimitMb: hostRuntime().workerHeapLimit ? this.memoryLimitMb : null,
      outputLimit: this.outputLimit,
      resourceLimit: this.resourceLimit,
      adapterLimit: this.adapterLimit,
      namespaceLimit: this.namespaceLimit,
      workerCaches: this.workers.map(slot => ({ workerId: slot.worker.threadId, ...slot.workerState })),
      shutdownTimeout: this.shutdownTimeout,
      startupTimeout: this.startupTimeout,
      recovery: this.lanes.map((lane, index) => ({
        slot: index + 1,
        state: lane.failed ? 'failed' : lane.timer ? 'backoff' : 'available-or-starting',
        consecutiveFailures: lane.failures,
        restartLimit: this.restartLimit,
        lastError: lane.lastError
      })),
      averageExecutionTimeMs: handled === 0 ? 0 : this.metrics.executionTimeMs / handled,
      resources: {
        metrics: resourceMetrics,
        adapters: resourceAdapters,
        workers: this.workers.map((slot) => ({
          workerId: slot.worker.threadId,
          ...(slot.resources || {
            instances: 0,
            activeLeases: 0,
            metrics: emptyResourceMetrics(),
            adapters: {}
          })
        }))
      },
      ...this.metrics
    }
  }

  async close({ deadline = Date.now() + this.shutdownTimeout } = {}) {
    if (this.closePromise) return this.closePromise
    if (!this.started) return
    this.closing = true
    this.generation++
    for (const lane of this.lanes) {
      clearTimeout(lane.timer)
      lane.timer = null
    }
    const error = new RuntimeError('Cow runtime closed before executing the request', {
      status: 503,
      code: 'COW_RUNTIME_CLOSED'
    })
    for (const task of this.queue.splice(0)) {
      this.#clearTask(task)
      this.metrics.requestsFailed += 1
      task.reject(error)
    }

    const slots = [...this.workers]
    for (const slot of slots) {
      if (!slot.readySettled) {
        slot.readySettled = true
        clearTimeout(slot.startupTimer)
        slot.rejectReady(new RuntimeError('Cow worker startup was cancelled by close', { status: 503, code: 'COW_RUNTIME_CLOSING' }))
        // A worker that is not ready has run no page and holds no persistent
        // resources. Asking it to shut down would wait for it to finish
        // loading, which on a busy host outlasts the shutdown deadline.
        slot.retiring = true
        slot.terminating = true
        slot.worker.terminate()
      }
    }
    this.closePromise = (async () => {
      const timer = setTimeout(() => {
        for (const slot of this.workers) {
          slot.shutdownError ||= new RuntimeError('Cow worker exceeded the application shutdown deadline', {
            code: 'COW_WORKER_SHUTDOWN_TIMEOUT'
          })
          slot.terminating = true
          slot.worker.terminate()
        }
      }, Math.max(0, deadline - Date.now()))
      let results
      try {
        results = await Promise.allSettled(slots.map((slot) => this.#shutdown(slot)))
      } finally {
        clearTimeout(timer)
      }
      const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason)
      this.workers = []
      this.started = false
      this.closing = false
      this.closePromise = null
      this.startPromise = null
      if (failures.length > 0) {
        const closeError = new AggregateError(failures, 'One or more Cow workers could not shut down cleanly')
        closeError.code = 'COW_RUNTIME_CLOSE_FAILED'
        throw closeError
      }
    })()
    return this.closePromise
  }
}
