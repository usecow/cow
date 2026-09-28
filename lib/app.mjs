import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Dispatcher } from './dispatcher.mjs'
import { CowServer } from './server.mjs'
import { WorkerPool } from './worker-pool.mjs'
import { Compiler } from './compiler.mjs'
import { assertHostSupported, hostRuntime } from './host-runtime.mjs'

export class CowApp {
  constructor(options = {}) {
    this.explicitMemoryLimit = options.memoryLimitMb !== undefined
    this.options = {
      rootDir: resolve(options.rootDir || '.'),
      host: options.host || '127.0.0.1',
      port: options.port === undefined ? 8000 : Number(options.port),
      workers: options.workers === undefined ? undefined : Number(options.workers),
      timeout: options.timeout === undefined ? 10_000 : Number(options.timeout),
      maxQueue: options.maxQueue === undefined ? 1_024 : Number(options.maxQueue),
      queueTimeout: options.queueTimeout === undefined ? 10_000 : Number(options.queueTimeout),
      maxRequestsPerWorker: options.maxRequestsPerWorker === undefined
        ? 1_000
        : Number(options.maxRequestsPerWorker),
      memoryLimitMb: options.memoryLimitMb === undefined ? 256 : Number(options.memoryLimitMb),
      shutdownTimeout: options.shutdownTimeout === undefined ? 5_000 : Number(options.shutdownTimeout),
      bodyLimit: options.bodyLimit === undefined ? 1_048_576 : Number(options.bodyLimit),
      outputLimit: options.outputLimit === undefined ? 8_388_608 : Number(options.outputLimit),
      bufferLimit: options.bufferLimit === undefined ? 16_777_216 : Number(options.bufferLimit),
      bodyTimeout: options.bodyTimeout === undefined ? 10_000 : Number(options.bodyTimeout),
      stallTimeout: options.stallTimeout === undefined ? 120_000 : Number(options.stallTimeout),
      startupTimeout: options.startupTimeout === undefined ? 10_000 : Number(options.startupTimeout),
      restartDelay: options.restartDelay === undefined ? 100 : Number(options.restartDelay),
      restartMaxDelay: options.restartMaxDelay === undefined ? 5_000 : Number(options.restartMaxDelay),
      restartLimit: options.restartLimit === undefined ? 5 : Number(options.restartLimit),
      cacheEntries: options.cacheEntries === undefined ? 256 : Number(options.cacheEntries),
      cacheBytes: options.cacheBytes === undefined ? 16_777_216 : Number(options.cacheBytes),
      resourceLimit: options.resourceLimit === undefined ? 64 : Number(options.resourceLimit),
      adapterLimit: options.adapterLimit === undefined ? 128 : Number(options.adapterLimit),
      namespaceLimit: options.namespaceLimit === undefined ? 256 : Number(options.namespaceLimit),
      sourceLimit: options.sourceLimit === undefined ? 1_048_576 : Number(options.sourceLimit),
      compileTimeout: options.compileTimeout === undefined ? 5_000 : Number(options.compileTimeout),
      compileMaxPending: options.compileMaxPending === undefined ? 8 : Number(options.compileMaxPending),
      compiledBufferLimit: options.compiledBufferLimit === undefined ? 16_777_216 : Number(options.compiledBufferLimit),
      cache: options.cache !== false,
      mode: options.mode || (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
      healthPath: options.healthPath === undefined ? '/_cow/health' : options.healthPath,
      statusPath: options.statusPath === undefined ? '/_cow/status' : options.statusPath,
      logger: options.logger || console
    }
    this.runtime = null
    this.compilerRuntime = null
    this.dispatcher = null
    this.server = null
    this.closePromise = null
    this.initializePromise = null
    this.startPromise = null
    this.generation = 0
    this.closing = false
  }

  #assertGeneration(generation = this.generation) {
    if (this.closing || generation !== this.generation) throw Object.assign(new Error('Cow application startup was cancelled or the application is closing'), {
      status: 503, code: 'COW_APP_CLOSING'
    })
  }

  async initialize() {
    this.#assertGeneration()
    if (this.initializePromise) return this.initializePromise
    if (this.dispatcher) return this
    const promise = this.#initialize(this.generation).finally(() => { if (this.initializePromise === promise) this.initializePromise = null })
    this.initializePromise = promise
    return promise
  }

  async #initialize(generation) {

    assertHostSupported()
    if (this.explicitMemoryLimit && !hostRuntime().workerHeapLimit) {
      throw Object.assign(new Error(`--memory-limit is not supported on ${hostRuntime().name}. Use an OS/container memory limit, or select Node/Nub.`), { code: 'COW_RUNTIME_CAPABILITY' })
    }

    const rootStat = await stat(this.options.rootDir).catch(() => null)
    this.#assertGeneration(generation)
    if (!rootStat?.isDirectory()) {
      throw new Error(`Cow application directory does not exist: ${this.options.rootDir}`)
    }
    if (!Number.isInteger(this.options.port) || this.options.port < 0 || this.options.port > 65535) {
      throw new Error(`Invalid port: ${this.options.port}`)
    }
    for (const [name, minimum] of [
      ['workers', 1],
      ['timeout', 1],
      ['maxQueue', 0],
      ['queueTimeout', 1],
      ['maxRequestsPerWorker', 0],
      ['memoryLimitMb', 16],
      ['shutdownTimeout', 1],
      ['bodyLimit', 0],
      ['outputLimit', 0],
      ['bufferLimit', 0],
      ['bodyTimeout', 1],
      ['stallTimeout', 1],
      ['startupTimeout', 1],
      ['restartDelay', 1],
      ['restartMaxDelay', 1],
      ['restartLimit', 0],
      ['cacheEntries', 0], ['cacheBytes', 0], ['resourceLimit', 1],
      ['adapterLimit', 1], ['namespaceLimit', 1], ['sourceLimit', 1],
      ['compileTimeout', 1], ['compileMaxPending', 1], ['compiledBufferLimit', 1]
    ]) {
      const value = this.options[name]
      if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
        throw new Error(`Invalid ${name}: ${value}`)
      }
    }
    if (!['development', 'production'].includes(this.options.mode)) {
      throw new Error(`Invalid Cow mode: ${this.options.mode}`)
    }

    const compilerLimits = { maxCacheEntries: this.options.cacheEntries, maxCacheBytes: this.options.cacheBytes,
      sourceLimit: this.options.sourceLimit, maxPending: this.options.compileMaxPending }
    const workerOptions = {
      size: this.options.workers,
      timeout: this.options.timeout,
      maxQueue: this.options.maxQueue,
      queueTimeout: this.options.queueTimeout,
      maxRequestsPerWorker: this.options.maxRequestsPerWorker,
      memoryLimitMb: this.options.memoryLimitMb,
      shutdownTimeout: this.options.shutdownTimeout,
      outputLimit: this.options.outputLimit,
      startupTimeout: this.options.startupTimeout,
      restartDelay: this.options.restartDelay,
      restartMaxDelay: this.options.restartMaxDelay,
      restartLimit: this.options.restartLimit,
      compilerLimits,
      resourceLimit: this.options.resourceLimit,
      adapterLimit: this.options.adapterLimit,
      namespaceLimit: this.options.namespaceLimit,
      cache: this.options.cache,
      logger: this.options.logger
    }
    workerOptions.diagnostics = Object.fromEntries(['mode','bodyLimit','bodyTimeout','bufferLimit','compileTimeout','compiledBufferLimit']
      .map(name=>[name,this.options[name]]))
    const runtime = this.runtime = new WorkerPool(workerOptions)
    const compilerRuntime = this.compilerRuntime = new WorkerPool({ ...workerOptions, size: 1, timeout: this.options.compileTimeout,
      maxQueue: this.options.compileMaxPending, maxRequestsPerWorker: 1000, label: 'compiler worker' }, {
      workerURL: new URL('./compiler-worker.mjs', import.meta.url), timeoutCode: 'COW_COMPILE_TIMEOUT'
    })
    try {
      await Promise.all([runtime.start(), compilerRuntime.start()])
      this.#assertGeneration(generation)
    } catch (error) {
      await Promise.allSettled([runtime.close(), compilerRuntime.close()])
      if (this.generation === generation) {
        this.runtime = null
        this.compilerRuntime = null
      }
      this.#assertGeneration(generation)
      throw error
    }
    const compiler = new Compiler({ cache: this.options.cache, ...compilerLimits,
      transform: (source, options, { signal }) => compilerRuntime.run({ source, ...options }, {}, { signal }) })
    this.dispatcher = new Dispatcher({
      rootDir: this.options.rootDir,
      runtime: this.runtime,
      compiler,
      compilerRuntime: this.compilerRuntime,
      bodyLimit: this.options.bodyLimit,
      bufferLimit: this.options.bufferLimit,
      compiledBufferLimit: this.options.compiledBufferLimit,
      cache: this.options.cache
    })
    return this
  }

  async start() {
    this.#assertGeneration()
    if (this.startPromise) return this.startPromise
    if (this.server) return this.address()
    const promise = this.#start(this.generation).finally(() => { if (this.startPromise === promise) this.startPromise = null })
    this.startPromise = promise
    return promise
  }

  async #start(generation) {
    await this.initialize()
    this.#assertGeneration(generation)

    const runtime = this.runtime, compilerRuntime = this.compilerRuntime
    const server = this.server = new CowServer({
      ...this.options,
      dispatcher: this.dispatcher
    })

    try {
      const address = await server.start()
      this.#assertGeneration(generation)
      return address
    } catch (error) {
      await Promise.allSettled([server.close(), runtime.close(), compilerRuntime.close()])
      if (this.generation === generation) {
        this.server = null
        this.dispatcher = null
        this.runtime = null
        this.compilerRuntime = null
      }
      this.#assertGeneration(generation)
      throw error
    }
  }

  address() {
    return this.server?.address() || null
  }

  execute(request, options) {
    this.#assertGeneration()
    if (!this.dispatcher) throw new Error('Cow application has not been initialized')
    return this.dispatcher.dispatch(request, options)
  }

  status() {
    if (this.closing) return { state: 'closing', application: this.dispatcher?.status() || null }
    if (this.server) return this.server.status()
    return {
      state: this.dispatcher ? 'initialized' : 'stopped',
      application: this.dispatcher?.status() || null
    }
  }

  async close() {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.generation++
    if (this.dispatcher) this.dispatcher.accepting = false
    this.closePromise = this.#closeWithinDeadline().finally(() => {
      this.closePromise = null
      this.initializePromise = null
      this.startPromise = null
      this.closing = false
    })
    return this.closePromise
  }

  async #closeWithinDeadline() {
    const deadline = Date.now() + this.options.shutdownTimeout
    const failures = []
    try {
      await this.server?.close({ deadline })
    } catch (error) {
      failures.push(error)
    }
    try {
      const results = await Promise.allSettled([this.runtime?.close({ deadline }), this.compilerRuntime?.close({ deadline })])
      failures.push(...results.filter(result => result.status === 'rejected').map(result => result.reason))
    } finally {
      this.server = null
      this.dispatcher = null
      this.runtime = null
      this.compilerRuntime = null
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      const error = new AggregateError(failures, 'Cow could not shut down cleanly')
      error.code = 'COW_CLOSE_FAILED'
      throw error
    }
  }
}

export async function startCow(options) {
  const app = new CowApp(options)
  await app.start()
  return app
}

export { Compiler, CowCompileError, compileSource, tokenize } from './compiler.mjs'
export { Dispatcher, normalizeRequest } from './dispatcher.mjs'
export { Router, RouteError } from './router.mjs'
export { CowServer } from './server.mjs'
export { RuntimeError, WorkerPool } from './worker-pool.mjs'
