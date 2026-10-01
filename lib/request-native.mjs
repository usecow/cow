import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const supported = new Set(['node:assert', 'node:assert/strict', 'node:buffer', 'node:crypto', 'node:fs',
  'node:fs/promises', 'node:os', 'node:path', 'node:path/posix', 'node:path/win32', 'node:process',
  'node:querystring', 'node:timers', 'node:timers/promises', 'node:url', 'node:util', 'node:util/types'])

// A copy, so diagnostics cannot mutate the runtime's supported-entry policy.
export const requestBuiltinNames = () => [...supported].sort()

function unsupported(name) {
  throw Object.assign(new Error(`${name} is not a request-scoped Cow API. Use a native resource adapter for worker-level capabilities.`), { code: 'COW_NATIVE_API_UNSUPPORTED' })
}

// Drivers can retain this handle, but cleanup detaches the request closure.
function callbackHandle(entry) {
  return function (...args) { return entry.invoke?.(this, args) }
}

// This is an API/lifetime boundary, not a hostile-code sandbox. Native objects
// are viewed through request-owned wrappers; shared namespaces, functions and
// prototypes cannot be patched by page code. Values produced by a call remain
// mutable. Native adapters are trusted code and own their resource cleanup.
export function createRequestNative({ context, assertActive, observe, callbackError, isClosed, timers, fetch }) {
  const views = new WeakMap()
  const originals = new WeakMap()
  const callbacks = new WeakMap()
  const callbackEntries = new Set()
  const builtinViews = new Map()
  const objectURLUnsupported = () => unsupported('URL object-URL registry')
  const intrinsic = vm.runInContext('({Object,Function,Array,Promise,Error,TypeError,RangeError,Map,Set,Date,RegExp,ArrayBuffer,DataView,Uint8Array,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array})', context)
  const intrinsicMap = new Map()
  for (const [name, value] of Object.entries(intrinsic)) {
    intrinsicMap.set(globalThis[name], value)
    intrinsicMap.set(globalThis[name].prototype, value.prototype)
  }
  intrinsicMap.set(Object.getPrototypeOf(Uint8Array), Object.getPrototypeOf(intrinsic.Uint8Array))
  intrinsicMap.set(Object.getPrototypeOf(Uint8Array.prototype), Object.getPrototypeOf(intrinsic.Uint8Array.prototype))

  const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function')
  const unwrap = value => originals.get(value) || value
  function argument(value, seen = new Map()) {
    if (!isObject(value)) return value
    if (originals.has(value)) {
      const original = originals.get(value)
      // Passing a promise to a native consumer (including cow.track) consumes
      // the outward promise too; do not report that bridge as unhandled.
      if (original instanceof Promise && value instanceof intrinsic.Promise) value.catch(() => {})
      return original
    }
    if (typeof value === 'function') return callback(value)
    // A driver checks instanceof Date in its own realm, so hand it one.
    if (value instanceof intrinsic.Date) return new Date(intrinsic.Date.prototype.getTime.call(value))
    if (seen.has(value)) return seen.get(value)
    // Options and parameter lists may contain wrapped buffers, URLs or callbacks.
    if (Array.isArray(value) || Object.getPrototypeOf(value) === intrinsic.Object.prototype || Object.getPrototypeOf(value) === null) {
      const copy = Array.isArray(value) ? [] : (Object.getPrototypeOf(value) === null ? Object.create(null) : {})
      seen.set(value, copy)
      for (const key of Reflect.ownKeys(value)) if (key !== 'length') Object.defineProperty(copy, key, {
        value: argument(value[key], seen), enumerable: true, writable: true, configurable: true
      })
      return copy
    }
    return value
  }

  function callback(fn) {
    if (!callbacks.has(fn)) {
      const entry = { invoke(receiver, args) {
        if (isClosed()) return
        const result = Reflect.apply(fn, wrap(receiver), args.map(value => wrap(value)))
        // A native consumer may await/catch this result (for example a
        // transaction callback). Fire-and-forget APIs report errors explicitly.
        if (result && typeof result.then === 'function') observe(result)
        return argument(result)
      } }
      callbackEntries.add(entry)
      callbacks.set(fn, callbackHandle(entry))
    }
    return callbacks.get(fn)
  }

  function runCallback(fn, args = []) {
    try {
      const result = fn(...args)
      if (result && typeof result.then === 'function') observe(Promise.resolve(result).catch(callbackError))
      return result
    } catch (error) { callbackError(error) }
  }

  function wrap(value, readOnly = false) {
    if (!isObject(value)) return value
    if (value === URL.createObjectURL || value === URL.revokeObjectURL) return wrap(objectURLUnsupported, true)
    if (originals.has(value)) return value
    if (intrinsicMap.has(value)) return intrinsicMap.get(value)
    // Application objects which a native API returns are already request-owned.
    if (value instanceof intrinsic.Object) return value
    if (views.has(value)) return views.get(value)
    if (value instanceof Promise) {
      observe(value)
      const promise = new intrinsic.Promise((resolve, reject) => value.then(item => resolve(wrap(item)), error => reject(wrap(error))))
      // Do not attach a dummy rejection handler here: an ignored outward
      // promise must reach the request's unhandled-rejection checkpoint.
      views.set(value, promise)
      originals.set(promise, value)
      return promise
    }
    // Dates are data too: a timestamp column or a file's mtime arrives as a
    // request Date, so instanceof, methods and JSON behave normally.
    if (value instanceof Date) return new intrinsic.Date(Date.prototype.getTime.call(value))
    const prototype = Object.getPrototypeOf(value)
    if (!readOnly && (Array.isArray(value) || prototype === Object.prototype || prototype === null)) {
      // Data (rows, arrays, JSON) belongs to the request. Copy it into its realm
      // so normal operations such as Object.freeze and instanceof still work.
      const copy = Array.isArray(value) ? new intrinsic.Array() : (prototype === null ? Object.create(null) : new intrinsic.Object())
      views.set(value, copy)
      for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === 'length') continue
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
        Object.defineProperty(copy, key, { configurable: true, enumerable: descriptor.enumerable, writable: true, value: wrap(value[key]) })
      }
      if (Object.isFrozen(value)) Object.freeze(copy)
      return copy
    }
    const callable = typeof value === 'function'
    const target = callable ? function () {}.bind(null) : (Array.isArray(value) ? [] : Object.create(null))
    const protectedValue = readOnly || callable
    const deny = () => { throw wrap(new TypeError('Cow native namespaces, functions and prototypes are read-only')) }
    const proxy = new Proxy(target, {
      get(_target, key) {
        try { return wrap(Reflect.get(value, key, value), protectedValue || key === 'prototype') }
        catch (error) { throw wrap(error) }
      },
      set(_target, key, item) { if (protectedValue) return deny(); return Reflect.set(value, key, argument(item), value) },
      defineProperty(_target, key, descriptor) {
        if (protectedValue) return deny()
        const next = { ...descriptor }
        if ('value' in next) next.value = argument(next.value)
        return Reflect.defineProperty(value, key, next)
      },
      deleteProperty(_target, key) { if (protectedValue) return deny(); return Reflect.deleteProperty(value, key) },
      setPrototypeOf: deny,
      preventExtensions: deny,
      getPrototypeOf() { return wrap(Object.getPrototypeOf(value), true) },
      has(_target, key) { return key in value },
      ownKeys() { return Reflect.ownKeys(value) },
      getOwnPropertyDescriptor(_target, key) {
        if (Array.isArray(target) && key === 'length') return { ...Reflect.getOwnPropertyDescriptor(target, key), value: value.length }
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
        if (!descriptor) return undefined
        return { configurable: true, enumerable: descriptor.enumerable, writable: !protectedValue, value: wrap(Reflect.get(value, key, value), protectedValue || key === 'prototype') }
      },
      apply(_target, receiver, args) {
        assertActive()
        try { return wrap(Reflect.apply(value, unwrap(receiver), args.map(item => argument(item)))) }
        catch (error) { throw wrap(error) }
      },
      construct(_target, args) {
        assertActive()
        try { return wrap(Reflect.construct(value, args.map(item => argument(item)))) }
        catch (error) { throw wrap(error) }
      }
    })
    views.set(value, proxy)
    originals.set(proxy, value)
    return proxy
  }

  // Process data is a snapshot, not the execution worker's mutable process.
  const processView = vm.runInContext('({})', context)
  Object.assign(processView, {
    env: vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(process.env))})`, context),
    argv: vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(process.argv))})`, context),
    versions: wrap({ ...process.versions }, true), version: process.version, platform: process.platform,
    arch: process.arch, pid: process.pid, cwd: wrap(() => process.cwd()),
    hrtime: wrap(process.hrtime), uptime: wrap(() => process.uptime()),
    // Explicit exit is a failed request: the pool replaces the worker, no replay.
    exit: wrap(code => process.exit(code)),
    nextTick: wrap((fn, ...args) => queueMicrotask(() => { if (!isClosed()) runCallback(fn, args) }))
  })

  function builtin(name) {
    if (builtinViews.has(name)) return builtinViews.get(name)
    if (!supported.has(name)) return unsupported(name)
    let value
    if (name === 'node:process') value = processView
    else if (name === 'node:timers') value = { ...timers }
    else if (name === 'node:timers/promises') {
      value = { setTimeout: (delay, result, options) => require(name).setTimeout(delay, argument(result), argument(options)),
        setImmediate: (result, options) => require(name).setImmediate(argument(result), argument(options)) }
    } else {
      const original = require(name)
      value = Object.fromEntries(Object.getOwnPropertyNames(original).map(key => [key, original[key]]))
      if (name === 'node:os') value.setPriority = () => unsupported('node:os.setPriority')
      if (name === 'node:buffer') {
        for (const key of ['setDefaultEncoding', 'resolveObjectURL']) if (key in value) value[key] = () => unsupported(`node:buffer.${key}`)
      }
      if (name === 'node:fs' || name === 'node:fs/promises') {
        // Long-lived handles/watchers/streams need an adapter that owns closure.
        for (const key of ['watch', 'watchFile', 'unwatchFile', 'createReadStream', 'createWriteStream', 'ReadStream', 'WriteStream', 'FileReadStream', 'FileWriteStream', 'open', 'openSync', 'opendir', 'opendirSync']) {
          if (key in value) value[key] = () => unsupported(`${name}.${key}`)
        }
        if (name === 'node:fs') {
          value.promises = builtin('node:fs/promises').default
          for (const [key, fn] of Object.entries(value)) {
            if (typeof fn !== 'function' || /Sync$/.test(key) || /^[A-Z]/.test(key)) continue
            if (['watch', 'watchFile', 'unwatchFile', 'createReadStream', 'createWriteStream', 'open', 'opendir'].includes(key)) continue
            value[key] = (...args) => {
              const last = args.at(-1)
              if (typeof last !== 'function') return fn(...args)
              let done
              observe(new Promise(resolve => { done = resolve }))
              args[args.length - 1] = (...results) => { try { return runCallback(last, results) } finally { done() } }
              try { return fn(...args) } catch (error) { done(); throw error }
            }
          }
        }
      }
      if (name === 'node:crypto') {
        for (const key of ['setEngine', 'setFips', 'secureHeapUsed']) if (key in value) value[key] = () => unsupported(`${name}.${key}`)
        for (const key of ['scrypt', 'pbkdf2', 'randomBytes', 'randomFill', 'generateKey', 'generateKeyPair', 'hkdf', 'sign', 'verify']) {
          if (typeof value[key] !== 'function') continue
          const fn = value[key]
          value[key] = (...args) => {
            const last = args.at(-1)
            if (typeof last !== 'function') return fn(...args)
            let done
            observe(new Promise(resolve => { done = resolve }))
            args[args.length - 1] = (...results) => { try { return runCallback(last, results) } finally { done() } }
            try { return fn(...args) } catch (error) { done(); throw error }
          }
        }
      }
    }
    const defaultExport = name === 'node:process' ? value : wrap(value, true)
    const namespace = Object.fromEntries(Object.keys(value).map(key => [key, name === 'node:process' ? value[key] : wrap(value[key], true)]))
    namespace.default = defaultExport
    builtinViews.set(name, namespace)
    return namespace
  }

  const globals = { process: processView, ...timers, fetch,
    Buffer, AbortController, AbortSignal, Blob, FormData, Headers, Request, Response,
    TextDecoder, TextEncoder, URL, URLSearchParams, structuredClone, console, performance,
    crypto: require('node:crypto').webcrypto,
    queueMicrotask: fn => queueMicrotask(() => { if (!isClosed()) runCallback(fn) }) }
  for (const [name, value] of Object.entries(globals)) context[name] = name === 'process' ? value : wrap(value, true)
  // Proxied native byte views still follow the normal binary predicates.
  intrinsic.ArrayBuffer.isView = wrap(value => ArrayBuffer.isView(unwrap(value)))
  return { wrap, unwrap, builtin, close() {
    for (const entry of callbackEntries) entry.invoke = null
    callbackEntries.clear()
  } }
}
