import { realpath, stat } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { resolve as resolveModule } from 'import-meta-resolve'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { parentPort, workerData } from 'node:worker_threads'
import { createRequestLoader } from './request-loader.mjs'
import { createRequestNative } from './request-native.mjs'
import { Compiler } from './compiler.mjs'
import { templateStack } from './source-map.mjs'
import { escapeHtml } from './web.mjs'
import { createRequestForm } from './uploads.mjs'
import { connectionMetadata, requestHost } from './request-metadata.mjs'
import { errorHeaders, finalStatus } from './http-policy.mjs'
import { findErrorPage, siteErrorInfo, errorPageFailure } from './site-errors.mjs'
import { openOutputFile } from './file-output.mjs'
import { infoSnapshot, sendInfo } from './info.mjs'
import {
  __assertResponseReady,
  __closeWorkerResources,
  __observeResourceStatus,
  __resourceStatus,
  __runWithResourceRequest
} from './resource.mjs'

__observeResourceStatus((resources) => {
  parentPort.postMessage({ type: 'resource-status', resources })
})

const namespaceCache = new Map()
// Standard-library imports belong to the running Cow installation, including
// when launched globally or from npx. Other packages remain site-relative.
// `cow:` is the canonical page spelling, like `node:` and `bun:`; the package
// subpaths stay as aliases because host scripts resolve them through npm.
const helperModules = [
  ['web', './web.mjs'], ['sqlite', './sqlite.mjs'], ['resource', './resource.mjs'],
  ['csv', './csv.mjs'], ['runtime', './runtime-types.mjs']
]
const bundledModules = new Map(helperModules.flatMap(([name, file]) => [
  [`cow:${name}`, new URL(file, import.meta.url).href],
  [`@cowlang/cow/${name}`, new URL(file, import.meta.url).href]
]))
const includeCompiler = new Compiler({ cache: workerData?.cache !== false, ...workerData?.compilerLimits })
const namespaceLimit = workerData?.namespaceLimit ?? 256
let recycleRequested = false

function workerState() {
  return { includeCache: includeCompiler.status(), namespaces: namespaceCache.size, namespaceLimit,
    recycleRequired: recycleRequested || __resourceStatus().recycleRequired }
}

// Every callback, loader and cleanup hook closes over its original request.
// Native adapters may retain callbacks after rendering; they must never see
// another request's context or register work with its cleanup scope.
function createExecutionScope() {
  let context
  let moduleCache
  let moduleLoads
  let evaluations
  let linkQueue
  let activeResources
  let native
  let loader
  let templateMaps = new Map()

  const nativeTimers = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate
  }

  class CowResponseFinished extends Error {}

  function assertActive() {
    if (!activeResources || activeResources.closed) {
      const error = new Error('This Cow request has ended')
      error.code = 'COW_REQUEST_ENDED'
      throw error
    }
  }

  function trackWork(factory) {
    if (!activeResources?.accepting) {
      const error = new Error('This Cow request is no longer accepting asynchronous work')
      error.code = 'COW_REQUEST_ENDED'
      return Promise.reject(error)
    }
    const pending = activeResources.pending
    const work = Promise.resolve().then(factory)
    pending.add(work)
    work.then(() => pending.delete(work), () => pending.delete(work))
    return work
  }

  function observe(work) {
    assertActive()
    const pending = activeResources.pending
    pending.add(work)
    work.then(() => pending.delete(work), () => pending.delete(work))
    return work
  }

  function callbackError(error) {
    error = native?.unwrap(error) || error
    if (!activeResources.callbackErrors.includes(error)) activeResources.callbackErrors.push(error)
  }

  const unhandledRejection = (reason, promise) => activeResources.unhandled.set(promise, reason)
  // Deno's Node event passes (reason, promise); Node and Bun pass (promise).
  const rejectionHandled = (...args) => activeResources.unhandled.delete(args.at(-1))

  async function drainPending() {
    do {
      while (activeResources.pending.size) await Promise.allSettled([...activeResources.pending])
      // Node reports unhandled rejections after the microtask checkpoint. Keep
      // them attached to this request before returning/reusing its worker.
      await new Promise(resolve => nativeTimers.setImmediate(resolve))
    } while (activeResources.pending.size)
  }

  function takeAsyncError() {
    const unhandled = [...activeResources.unhandled.values()]
    const callbacks = activeResources.callbackErrors.splice(0)
    activeResources.unhandled.clear()
    if (!unhandled.length && !callbacks.length) return null
    const error = new AggregateError([...callbacks, ...unhandled], unhandled.length
      ? 'Cow unhandled promise rejection; await asynchronous operations or handle their errors'
      : 'Cow asynchronous callback failed')
    error.code = unhandled.length ? 'COW_UNHANDLED_REJECTION' : 'COW_ASYNC_CALLBACK_FAILED'
    return error
  }

  async function drainWork() {
    activeResources.accepting = false
    while (activeResources.pending.size) {
      await Promise.allSettled([...activeResources.pending])
    }
    // A failed graph evaluation may reject before a sibling's top-level await
    // settles. VM status 'evaluated' also covers pending async evaluation. Ask
    // each already-started module for its evaluation promise; never start a
    // merely linked module that the failed graph did not execute.
    await Promise.allSettled([...moduleCache.values()]
      .filter(module => ['evaluating', 'evaluated', 'errored'].includes(module.status))
      // Some hosts throw synchronously when re-observing an errored module.
      // Settle that already-recorded failure without inventing a cleanup error.
      .map(async module => { await module.evaluate() }))
    await drainPending()
    const error = takeAsyncError()
    if (error) throw error
  }

  function trackedTimer(kind, handler, delay, args) {
    assertActive()
    const collection = activeResources?.[kind]
    let handle
    const callback = (...callbackArgs) => {
      if (kind !== 'intervals') collection?.delete(handle)
      if (activeResources.closed) return
      try {
        const result = handler(...callbackArgs)
        if (result && typeof result.then === 'function') observe(Promise.resolve(result).catch(callbackError))
      } catch (error) { callbackError(error) }
    }
    if (kind === 'immediates') handle = nativeTimers.setImmediate(callback, ...args)
    else if (kind === 'intervals') handle = nativeTimers.setInterval(callback, delay, ...args)
    else handle = nativeTimers.setTimeout(callback, delay, ...args)
    collection?.add(handle)
    return handle
  }

  function clearTrackedTimer(handle, kind, nativeClear) {
    activeResources?.[kind].delete(handle)
    nativeTimers[nativeClear](handle)
  }

  function trackedFetch(input, init = {}) {
    assertActive()

    const controller = new AbortController()
    activeResources.controllers.add(controller)
    // undefined inherits Request.signal; an explicit null removes that signal,
    // and an explicit AbortSignal overrides it, just as native fetch does.
    const callerSignal = init?.signal === undefined && input instanceof Request
      ? input.signal
      : init?.signal
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal
    const pending = fetch(input, { ...init, signal })
    // Mark fire-and-forget requests as observed while preserving rejection for callers.
    pending.catch(() => {})
    return pending
  }

  function createSandbox() {
    const sandbox = {
      setTimeout: (handler, delay, ...args) => trackedTimer('timeouts', handler, delay, args),
      clearTimeout: (handle) => clearTrackedTimer(handle, 'timeouts', 'clearTimeout'),
      setInterval: (handler, delay, ...args) => trackedTimer('intervals', handler, delay, args),
      clearInterval: (handle) => clearTrackedTimer(handle, 'intervals', 'clearInterval'),
      setImmediate: (handler, ...args) => trackedTimer('immediates', handler, undefined, args),
      clearImmediate: (handle) => clearTrackedTimer(handle, 'immediates', 'clearImmediate')
    }
    return sandbox
  }

  function beginRequest() {
    templateMaps = new Map()
    activeResources = {
      accepting: true,
      closed: false,
      pending: new Set(),
      callbackErrors: [],
      unhandled: new Map(),
      timeouts: new Set(),
      intervals: new Set(),
      immediates: new Set(),
      controllers: new Set(),
      cleanups: [],
      requestController: new AbortController()
    }
    moduleCache = new Map()
    moduleLoads = new Map()
    evaluations = new WeakMap()
    linkQueue = Promise.resolve()
    const timers = createSandbox()
    context = vm.createContext({}, { name: 'cow-request' })
    vm.runInContext('globalThis.global = globalThis', context)
    native = createRequestNative({ context, assertActive, observe, callbackError,
      isClosed: () => activeResources.closed, timers, fetch: trackedFetch })
    createSourceModule.dynamicImport = (specifier, identifier, attributes) => trackWork(() => dynamicImport(specifier, { identifier }, attributes))
      .catch(error => { throw native.wrap(error) })
    loader = createRequestLoader({ context, sourceLimit: workerData?.compilerLimits?.sourceLimit ?? 1_048_576,
      sourceModule: createSourceModule, syntheticModule: createSyntheticModule,
      nativeModule: loadNativeModule, wrapNative: native.wrap,
      nativeRequire: name => { reserveNamespace(name); return native.builtin(name).default },
      registerSourceMap: source => templateMaps.set(source.identifier, source) })
    process.on('unhandledRejection', unhandledRejection)
    process.on('rejectionHandled', rejectionHandled)
  }

  async function cleanupRequest() {
    if (!activeResources) return
    const resources = activeResources
    const errors = []
    for (const handle of resources.timeouts) nativeTimers.clearTimeout(handle)
    for (const handle of resources.intervals) nativeTimers.clearInterval(handle)
    for (const handle of resources.immediates) nativeTimers.clearImmediate(handle)
    for (const controller of resources.controllers) controller.abort()
    resources.requestController.abort()
    for (const cleanup of resources.cleanups.reverse()) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error)
      }
    }
    // Cleanup may itself issue accepted filesystem/native operations.
    await drainPending()
    const asyncError = takeAsyncError()
    if (asyncError) errors.push(asyncError)
    // Cleanup callbacks are allowed to use timers, but none may escape the request.
    for (const handle of resources.timeouts) nativeTimers.clearTimeout(handle)
    for (const handle of resources.intervals) nativeTimers.clearInterval(handle)
    for (const handle of resources.immediates) nativeTimers.clearImmediate(handle)
    resources.closed = true
    process.off('unhandledRejection', unhandledRejection)
    process.off('rejectionHandled', rejectionHandled)
    native.close()
    resources.timeouts.clear()
    resources.intervals.clear()
    resources.immediates.clear()
    resources.controllers.clear()
    resources.cleanups.length = 0
    moduleCache.clear()
    moduleLoads.clear()
    evaluations = null
    linkQueue = null
    context = null
    return errors
  }

  function errorData(error, headers, depth = 0, seen = new Set()) {
    if (depth > 4 || seen.has(error)) return { name: 'Error', message: '[additional error details omitted]' }
    seen.add(error)
    // A rejected value may be a revoked request facade, or have throwing
    // getters/toString. Reporting it must never crash a worker during cleanup.
    const read = key => { try { return error?.[key] } catch { return undefined } }
    const primitive = value => ['string', 'number', 'boolean', 'bigint'].includes(typeof value) ? String(value) : undefined
    const message = primitive(read('message')) || primitive(error) || 'Non-serializable rejected value'
    const stack = read('stack'), cause = read('cause'), items = read('errors')
    const serializedCause = cause === undefined ? undefined : errorData(cause, undefined, depth + 1, seen)
    let errors
    try { if (Array.isArray(items)) errors = items.slice(0, 8).map(item => errorData(item, undefined, depth + 1, seen)) } catch {}
    return {
      name: primitive(read('name')) || 'Error',
      message: message.slice(0, 8192),
      stack: templateStack(typeof stack === 'string' ? stack.slice(0, 16384) : undefined, templateMaps),
      code: primitive(read('code')),
      status: typeof read('status') === 'number' ? read('status') : undefined,
      headers: errorHeaders(headers),
      cause: serializedCause,
      errors
    }
  }

  function createSyntheticModule(identifier, namespace) {
    const names = Object.keys(namespace)

    return new vm.SyntheticModule([...names], function initialize() {
      for (const name of names) {
        this.setExport(name, namespace[name])
      }
    }, { context, identifier })
  }

  async function existingModulePath(url) {
    const originalPath = fileURLToPath(url)
    const candidates = extname(originalPath)
      ? [originalPath]
      : [
          originalPath,
          `${originalPath}.cow`,
          `${originalPath}.mjs`,
          `${originalPath}.js`,
          `${originalPath}.ts`,
          `${originalPath}.cjs`,
          `${originalPath}.json`,
          resolve(originalPath, 'index.cow'),
          resolve(originalPath, 'index.mjs'),
          resolve(originalPath, 'index.js'),
          resolve(originalPath, 'index.ts')
        ]

    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isFile()) return await realpath(candidate)
      } catch {}
    }

    throw new Error(`Cannot resolve module ${url.href}`)
  }

  function validateAttributes(attributes, json) {
    for (const [name, value] of Object.entries(attributes)) {
      if (name !== 'type' || value !== 'json') throw Object.assign(new TypeError(`Unsupported import attribute: ${name}=${value}`), { code: 'ERR_IMPORT_ATTRIBUTE_UNSUPPORTED' })
    }
    if (attributes.type === 'json' && !json) throw Object.assign(new TypeError('JSON import attribute requires a JSON module'), { code: 'ERR_IMPORT_ATTRIBUTE_TYPE_INCOMPATIBLE' })
  }

  async function loadExternalModule(specifier, referencingModule, attributes) {
    if (specifier.startsWith('cow:') && !bundledModules.has(specifier)) {
      throw Object.assign(new Error(`Unknown Cow module ${specifier}; expected one of ${helperModules.map(([name]) => `cow:${name}`).join(', ')}`), { code: 'COW_MODULE_UNKNOWN' })
    }
    let resolvedSpecifier = bundledModules.get(specifier) ?? specifier
    if (resolvedSpecifier === specifier && !specifier.startsWith('node:')) {
      const base = new URL(referencingModule.identifier)
      base.search = ''
      base.hash = ''
      resolvedSpecifier = resolveModule(specifier, base.href)
    }

    const resolvedUrl = new URL(resolvedSpecifier)
    if (!['node:', 'file:'].includes(resolvedUrl.protocol)) throw Object.assign(new Error(`Unsupported Cow module URL: ${resolvedUrl.protocol}`), { code: 'COW_MODULE_URL_UNSUPPORTED' })
    if (resolvedUrl.protocol === 'file:') return loadFileModule(resolvedUrl, attributes)
    validateAttributes(attributes, false)
    return loadOnce(resolvedSpecifier, () => loadNativeModule(resolvedSpecifier))
  }

  function reserveNamespace(identifier) {
    if (namespaceCache.has(identifier)) return
    if (namespaceCache.size >= namespaceLimit) {
      recycleRequested = true
      throw Object.assign(new Error(`Worker native module limit (${namespaceLimit}) reached; reduce imports or raise namespaceLimit`), { status: 503, code: 'COW_MODULE_LIMIT' })
    }
    namespaceCache.set(identifier, null)
    if (namespaceCache.size >= namespaceLimit) recycleRequested = true
  }

  async function loadNativeModule(identifier) {
    reserveNamespace(identifier)
    if (identifier.startsWith('node:')) return createSyntheticModule(identifier, native.builtin(identifier))
    let pending = namespaceCache.get(identifier)
    if (!pending) {
      pending = import(identifier)
      namespaceCache.set(identifier, pending)
    }
    const namespace = await pending
    // Definitions retain callbacks for the worker lifetime. Only native adapter
    // code can define them; ordinary imports must not retain a request closure.
    const facade = Object.fromEntries(Object.keys(namespace).filter(name => !name.startsWith('__')).map(name => [name,
      name === 'defineResource' ? native.wrap(() => { throw Object.assign(new Error('defineResource belongs in a declared native adapter entry point'), { code: 'COW_RESOURCE_DEFINITION_SCOPE' }) }, true) : native.wrap(namespace[name], true)]))
    return createSyntheticModule(identifier, facade)
  }

  function loadOnce(identifier, factory) {
    if (moduleCache.has(identifier)) return Promise.resolve(moduleCache.get(identifier))
    if (!moduleLoads.has(identifier)) {
      const cache = moduleCache
      moduleLoads.set(identifier, Promise.resolve().then(factory).then(module => {
        cache.set(identifier, module)
        return module
      }))
    }
    return moduleLoads.get(identifier)
  }

  async function loadFileModule(url, attributes) {
    const filePath = await existingModulePath(url)
    const extension = extname(filePath).toLowerCase()
    validateAttributes(attributes, extension === '.json')
    const identifierUrl = pathToFileURL(filePath)
    // The graph is already fresh per request. Timestamp query strings are not
    // needed and must not erase user-supplied URL identity.
    identifierUrl.search = url.search
    identifierUrl.hash = url.hash
    const identifier = identifierUrl.href

    return loadOnce(identifier, () => loader.load(filePath, identifier))
  }

  async function linkModule(specifier, referencingModule, extra = {}) {
    const attributes = extra.attributes || extra.assert || {}
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) {
      const base = new URL(referencingModule.identifier)
      const target = specifier.startsWith('file:')
        ? new URL(specifier)
        : new URL(specifier, base)
      return loadFileModule(target, attributes)
    }

    return loadExternalModule(specifier, referencingModule, attributes)
  }

  async function dynamicImport(specifier, referencingModule, attributes) {
    const module = await linkModule(specifier, referencingModule, { attributes })
    await evaluateModule(module)
    return module
  }

  async function evaluateModule(module) {
    // Serialize root linking, not module loading or evaluation. VM linking
    // traverses static cycles itself; independently linking overlapping graphs
    // while a dependency is still 'linking' can fail even with a shared cache.
    const linked = linkQueue.then(async () => {
      if (module.status === 'unlinked') await module.link(linkModule)
    })
    linkQueue = linked.catch(() => {})
    await linked
    if (!evaluations.has(module)) evaluations.set(module, module.evaluate())
    await evaluations.get(module)
  }

  function createSourceModule(source, identifier) {
    let module
    module = new vm.SourceTextModule(source + `\n//# sourceURL=${identifier}\n`, {
      context,
      identifier,
      initializeImportMeta(meta) {
        meta.url = identifier
      },
      importModuleDynamically(specifier, referencingModule, attributes) {
        return trackWork(() => dynamicImport(specifier, module, attributes)).catch(error => { throw native.wrap(error) })
      }
    })
    return module
  }

  function createRequest(data) {
    const { remoteAddress, scheme } = connectionMetadata(data)
    const host = requestHost(data.headers)
    const headers = Object.fromEntries(
      Object.entries(data.headers || {}).map(([name, value]) => [name.toLowerCase(), value])
    )
    const parsedUrl = new URL(data.url, 'http://cow.local')
    const body = Buffer.from(data.body || [])
    const firstValues = new Map()
    for (const [name, value] of parsedUrl.searchParams) {
      if (!firstValues.has(name)) firstValues.set(name, value)
    }
    const params = Object.freeze(Object.fromEntries(firstValues))
    let parsedJson

    return Object.freeze({
      id: () => data.id,
      url: () => data.url,
      method: () => data.method,
      address: () => remoteAddress,
      scheme: () => scheme,
      host: () => host,
      headers: () => Object.freeze({ ...headers }),
      header: (name) => headers[String(name).toLowerCase()],
      params: () => params,
      get: (name) => parsedUrl.searchParams.get(name) ?? undefined,
      getAll: (name) => parsedUrl.searchParams.getAll(name),
      body: () => Buffer.from(body),
      text: () => body.toString('utf8'),
      formData: createRequestForm({ body, contentType: headers['content-type'], assertActive,
        onCleanup: cleanup => activeResources.cleanups.push(cleanup) }),
      json: () => {
        try {
          if (parsedJson === undefined) parsedJson = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
        } catch {
          throw Object.assign(new Error('Request body is not valid UTF-8 JSON'), { status: 400, code: 'COW_INVALID_JSON' })
        }
        return parsedJson
      }
    })
  }

  function normalizeBody(value) {
    value = native.unwrap(value)
    if (value === undefined || value === null) return Buffer.alloc(0)
    if (Buffer.isBuffer(value)) return value
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return Buffer.from(value)
    return Buffer.from(String(value))
  }

  function createResponse(task) {
    const errorInfo = task.errorInfo
    const outputLimit = workerData?.outputLimit ?? 8_388_608
    let slab = null
    let slabUsed = 0
    const state = {
      phase: 'buffering',
      status: errorInfo?.status || 200,
      headers: errorInfo ? { ...errorHeaders(errorInfo.headers), 'cache-control': 'no-store' } : {},
      chunks: [],
      bytes: 0,
      error: null
    }

    const ensureMutable = (operation) => {
      if (state.phase !== 'buffering') {
        const error = new Error(`Cannot ${operation} after response headers are committed`)
        error.code = 'COW_HEADERS_COMMITTED'
        throw error
      }
    }
    const commit = () => {
      if (state.phase === 'buffering') state.phase = 'committed'
    }
    const append = (value) => {
      if (state.streaming) throw Object.assign(new Error('Cannot mix buffered writes with an active stream'),{code:'COW_STREAM_ACTIVE'})
      value = native.unwrap(value)
      if (state.error) throw state.error
      if (state.phase === 'finished') {
        const error = new Error('Cannot write after the response is finished')
        error.code = 'COW_RESPONSE_FINISHED'
        throw error
      }
      const binary = Buffer.isBuffer(value) || ArrayBuffer.isView(value) || Object.prototype.toString.call(value) === '[object ArrayBuffer]'
      const text = binary ? null : String(value ?? '')
      const length = binary ? value.byteLength : Buffer.byteLength(text)
      if (length > outputLimit - state.bytes) {
        state.error = new Error(`Response body exceeds the ${outputLimit} byte output limit`)
        state.error.code = 'COW_RESPONSE_TOO_LARGE'
        state.error.status = 500
        throw state.error
      }
      if (!length) return
      const buffer = normalizeBody(binary ? value : text)
      // Fixed-size slabs bound both bytes and chunk bookkeeping, including
      // millions of single-byte writes. Copy now so later buffer mutation is safe.
      for (let offset = 0; offset < buffer.length;) {
        if (!slab || slabUsed === slab.length) {
          slab = Buffer.allocUnsafe(Math.min(65_536, outputLimit - state.bytes))
          slabUsed = 0
          state.chunks.push(slab)
        }
        const count = Math.min(buffer.length - offset, slab.length - slabUsed)
        buffer.copy(slab, slabUsed, offset, offset + count)
        slabUsed += count
        offset += count
        state.bytes += count
        state.chunks[state.chunks.length - 1] = slab.subarray(0, slabUsed)
      }
    }
    const assertReady = () => {
      // Failure output may precede release/rollback. Success still needs guards.
      if (!errorInfo || state.status < 400) __assertResponseReady()
    }
    const finish = (value, replace = false) => {
      if (state.streaming) throw Object.assign(new Error('Await the active response stream before ending output'),{code:'COW_STREAM_ACTIVE'})
      assertReady()
      if (replace) {
        state.chunks = []
        state.bytes = 0
        slab = null
        slabUsed = 0
      }
      if (value !== undefined) append(value)
      commit()
      state.phase = 'finished'
      throw new CowResponseFinished()
    }

    const transfer = message => new Promise((resolve,reject) => {
      assertActive()
      const port = task.streamPort
      const onClose = () => { cleanup(); reject(Object.assign(new Error('Response stream closed'),{code:'COW_STREAM_CLOSED'})) }
      const onMessage = value => {
        cleanup()
        if (value.ok) resolve()
        else reject(Object.assign(new Error(value.error.message),value.error))
      }
      const cleanup = () => {port.off('message',onMessage);port.off('close',onClose)}
      port.once('message',onMessage);port.once('close',onClose)
      try {port.postMessage(message)} catch(error) {cleanup();reject(error)}
    })
    const stream = async (source, contentLength) => {
      ensureMutable('start a stream')
      assertReady()
      source = native.unwrap(source)
      if (typeof source === 'string' || source === null || !source ||
          (typeof source[Symbol.asyncIterator] !== 'function' && typeof source[Symbol.iterator] !== 'function')) {
        throw new TypeError('res.stream requires an iterable or async iterable of strings or bytes')
      }
      const iterator = source[Symbol.asyncIterator]?.() || source[Symbol.iterator]()
      state.chunks = [];state.bytes = 0;slab = null;slabUsed = 0
      state.contentLength = contentLength
      commit()
      state.streaming = true
      let started = false
      const start = async () => {
        assertReady()
        if (started || !task.streamPort) return
        // This flag is shared with the outer task, including its error page.
        // Once a sink is offered headers, never attempt a second response.
        task.streamState.started = true
        await transfer({type:'start',status:state.status,headers:state.headers,contentLength})
        started = true
      }
      try {
        if (task.request.method !== 'HEAD' && ![204,205,304].includes(state.status)) {
          while (true) {
            const next = await iterator.next()
            if (next.done) break
            const value = native.unwrap(next.value)
            if (typeof value !== 'string' && !ArrayBuffer.isView(value) && Object.prototype.toString.call(value) !== '[object ArrayBuffer]') {
              throw new TypeError('Response stream chunks must be strings or bytes')
            }
            const chunk = normalizeBody(value)
            if (!task.streamPort) {
              state.streaming = false
              try {append(chunk)} finally {state.streaming = true}
              continue
            }
            for (let offset=0;offset<chunk.length;offset+=65_536) {
              assertReady()
              await start()
              await transfer({type:'chunk',body:chunk.subarray(offset,offset+65_536)})
            }
          }
        }
        await start()
        state.streamed = Boolean(task.streamPort)
      } catch (error) {
        state.error = error
        throw error
      } finally {
        try {await iterator.return?.()} finally {state.streaming = false}
      }
      state.phase = 'finished'
      throw new CowResponseFinished()
    }
    const sendFile = async (path, download = false, filename) => {
      ensureMutable('send a file')
      assertReady()
      const file = await openOutputFile(path, download, filename)
      try {
        for (const [name,value] of Object.entries(file.headers)) response.setHeader(name,value)
        if (!response.getHeader('content-type')) response.type('application/octet-stream')
        return await stream(file.source,file.size)
      } finally {await file.close()}
    }

    const response = {
      status(code) {
        ensureMutable('set status')
        const value = Number(code)
        state.status = finalStatus(value)
        return response
      },
      setHeader(name, value) {
        ensureMutable('set headers')
        const key = String(name).toLowerCase()
        const header = Array.isArray(value) ? value.map(String) : String(value)
        validateHeaderName(key)
        validateHeaderValue(key, header)
        state.headers[key] = header
        return response
      },
      header(name, value) {
        return response.setHeader(name, value)
      },
      getHeader(name) {
        return state.headers[String(name).toLowerCase()]
      },
      removeHeader(name) {
        ensureMutable('remove headers')
        delete state.headers[String(name).toLowerCase()]
        return response
      },
      type(value) {
        const aliases = {
          html: 'text/html; charset=utf-8',
          json: 'application/json; charset=utf-8',
          text: 'text/plain; charset=utf-8'
        }
        return response.setHeader('content-type', aliases[value] || value)
      },
      write(value = '') {
        commit()
        append(value)
        return response
      },
      commit() {
        commit()
        return response
      },
      async flush() {
        commit()
      },
      stream(source) { return stream(source) },
      sendFile(path) { return sendFile(path) },
      download(path, filename) { return sendFile(path,true,filename) },
      end(value) {
        finish(value)
      },
      send(value = '') {
        finish(value, true)
      },
      json(value) {
        if (arguments.length > 0) assertReady()
        response.type('json')
        if (arguments.length === 0) return response
        finish(JSON.stringify(value), true)
      },
      redirect(location, status = 302) {
        assertReady()
        response.status(status)
        response.setHeader('location', location)
        finish('', true)
      }
    }

    Object.defineProperties(response, {
      statusCode: { get: () => state.status },
      phase: { get: () => state.phase },
      headersSent: { get: () => state.phase !== 'buffering' },
      finished: { get: () => state.phase === 'finished' }
    })

    return { response: Object.freeze(response), state, finish, append, commit, assertReady }
  }

  async function executeTemplate(task, startedAt) {
    templateMaps.set(task.template.identifier, task.template)
    const module = moduleCache.get(task.template.identifier) || createSourceModule(task.template.code, task.template.identifier)
    moduleCache.set(task.template.identifier, module)
    await evaluateModule(module)

    const render = module.namespace.default
    if (typeof render !== 'function') throw new Error('Compiled Cow template has no render function')

    const req = createRequest(task.request)
    const { response: res, state, finish, append, commit, assertReady } = createResponse(task)
    task.responseHeaders = state.headers
    const onCleanup = (callback) => {
      if (typeof callback !== 'function') throw new TypeError('cow.onCleanup requires a function')
      assertActive()
      if (!activeResources.accepting) {
        const error = new Error('Cannot register cleanup after rendering has ended')
        error.code = 'COW_REQUEST_ENDED'
        throw error
      }
      activeResources.cleanups.push(callback)
    }
    const cow = Object.freeze({
      requestId: task.request.id,
      signal: activeResources.requestController.signal,
      onCleanup,
      defer: onCleanup,
      info: options => sendInfo(res, options, infoSnapshot({worker:workerData,compiler:includeCompiler,
        modules:moduleCache.size,resources:__resourceStatus()})),
      track: (promise) => trackWork(() => promise)
    })
    // Like PHP's echo of null: absent values print nothing, never "undefined".
    const echo = (...values) => append(values.map((value) => value == null ? '' : String(value)).join(' '))
    const die = () => finish()
    const rawRequest = native.wrap({
      _url: task.request.url,
      _params: req.params(),
      _headers: task.request.headers,
      _body: Buffer.from(task.request.body || [])
    })
    const rawResponse = vm.runInContext('({ _statusCode: null, _headers: {} })', context)

    const renderPage = async (template, renderer, locals = {}, depth = 0) => {
      if (depth > 32) throw new Error('Cow template include depth exceeds 32')
      await renderer({
        req: native.wrap(req, true), res: native.wrap(res, true), cow: native.wrap(cow, true),
        echo: native.wrap(echo), die: native.wrap(die), h: native.wrap(escapeHtml), locals,
        include: native.wrap((path, values = {}) => trackWork(async () => {
          const target = new URL(String(path), pathToFileURL(template.filePath))
          if (target.protocol !== 'file:') throw new TypeError('include() requires a local template path')
          const child = await includeCompiler.compile(fileURLToPath(target))
          templateMaps.set(child.identifier, child)
          let childModule = moduleCache.get(child.identifier)
          if (!childModule) {
            childModule = createSourceModule(child.code, child.identifier)
            moduleCache.set(child.identifier, childModule)
          }
          await evaluateModule(childModule)
          await renderPage(child, childModule.namespace.default, values, depth + 1)
        })),
        __filename: template.filePath,
        __dirname: dirname(template.filePath),
        __req: rawRequest,
        __res: rawResponse
      })
    }

    try {
      await renderPage(task.template, render, task.errorInfo ? { error: native.wrap(task.errorInfo, true) } : {})
    } catch (error) {
      if (!(native.unwrap(error) instanceof CowResponseFinished)) throw error
    }

    if (rawResponse._statusCode !== null && state.phase === 'buffering') state.status = finalStatus(rawResponse._statusCode)
    if (state.error) throw state.error
    if (state.streaming) throw Object.assign(new Error('Response streams must be awaited'),{code:'COW_STREAM_NOT_AWAITED'})
    assertReady()
    if (state.phase === 'buffering') Object.assign(state.headers, rawResponse._headers)
    commit()
    state.phase = 'finished'

    return {
      status: state.status,
      headers: state.headers,
      body: Buffer.concat(state.chunks),
      ...(state.streamed ? {streamed:true} : {}),
      ...(state.contentLength === undefined ? {} : {contentLength:state.contentLength}),
      ...(task.errorInfo ? { handledError: task.errorInfo } : {}),
      lifecycle: {
        phase: state.phase,
        durationMs: performance.now() - startedAt
      }
    }
  }

  async function execute(task) {
    const startedAt = performance.now()
    beginRequest()
    task.streamState = {started:false}
    let primaryError, outcomeError = task.errorInfo

    const renderAndDrain = async renderTask => {
      let result, failure, failed = false
      try { result = await executeTemplate(renderTask, startedAt) }
      catch (error) { failure = error; failed = true }
      try { await drainWork() }
      catch (error) {
        failure = failed ? new AggregateError([failure, error], 'Cow rendering and asynchronous cleanup failed', { cause: failure }) : error
        failed = true
      }
      if (failed) throw failure
      return result
    }

    try {
      return await __runWithResourceRequest({
        request: task.request,
        signal: activeResources.requestController.signal,
        getOutcomeError: () => outcomeError
      }, async () => {
        try {
          return await renderAndDrain(task)
        } catch (error) {
          outcomeError = error || new Error(`Request threw ${String(error)}`)
          if (task.errorInfo || task.streamState.started || activeResources.requestController.signal.aborted) throw error
          const file = await findErrorPage(task.errorRoot).catch(failure => { throw errorPageFailure(error, failure) })
          if (!file) throw error
          let errorTask
          try {
            const template = await includeCompiler.compile(file)
            activeResources.accepting = true
            errorTask = { ...task, template, errorInfo: siteErrorInfo(errorData(error), task.responseHeaders) }
            return await renderAndDrain(errorTask)
          } catch (failure) { throw errorPageFailure(error, failure) }
          finally { if (errorTask?.responseHeaders) task.responseHeaders = errorTask.responseHeaders }
        }
      })
    } catch (error) {
      primaryError = error
      throw error
    } finally {
      const cleanupErrors = await cleanupRequest()
      if (cleanupErrors?.length) {
        const error = new AggregateError(primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors],
          'One or more Cow request cleanup hooks failed', primaryError === undefined ? undefined : { cause: primaryError })
        error.code = 'COW_CLEANUP_FAILED'
        throw error
      }
    }
  }

  return { execute, errorData }
}

parentPort.on('message', async (task) => {
  const { execute, errorData } = createExecutionScope()
  if (task?.type === 'shutdown') {
    let error
    try {
      await __closeWorkerResources()
    } catch (failure) {
      error = errorData(failure)
    }
    parentPort.postMessage({
      type: 'shutdown-complete',
      error,
      resources: __resourceStatus()
    })
    return
  }

  try {
    parentPort.postMessage({
      id: task.id,
      ok: true,
      result: await execute(task),
      workerState: workerState(),
      resources: __resourceStatus()
    })
  } catch (error) {
    parentPort.postMessage({
      id: task.id,
      ok: false,
      error: errorData(error, task.responseHeaders),
      workerState: workerState(),
      resources: __resourceStatus()
    })
  } finally {
    task.streamPort?.close()
  }
})

parentPort.postMessage({ type: 'ready', resources: __resourceStatus() })
