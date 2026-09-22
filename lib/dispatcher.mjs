import { Compiler } from './compiler.mjs'
import { Router } from './router.mjs'
import { RuntimeError } from './worker-pool.mjs'
import { finalResponse, READ_METHODS, TEMPLATE_METHODS } from './http-policy.mjs'
import { connectionMetadata, requestHost } from './request-metadata.mjs'
import { findErrorPage, siteErrorInfo, errorPageFailure } from './site-errors.mjs'

function response(status, body = '', headers = {}) {
  return {
    kind: 'response',
    response: {
      status,
      headers,
      body: Buffer.from(body),
      lifecycle: { phase: 'finished', durationMs: 0 }
    }
  }
}

export function normalizeRequest(input = {}) {
  const method = String(input.method || 'GET').toUpperCase()
  const connection = connectionMetadata(input)
  const host = requestHost(input.headers)
  const headers = Object.fromEntries(
    Object.entries(input.headers || {}).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? Object.freeze([...value]) : value])
  )
  let body
  if (Buffer.isBuffer(input.body)) body = input.body
  else if (ArrayBuffer.isView(input.body)) {
    body = Buffer.from(input.body.buffer, input.body.byteOffset, input.body.byteLength)
  } else if (input.body instanceof ArrayBuffer) body = Buffer.from(input.body)
  else body = Buffer.from(input.body ?? '')

  return Object.freeze({
    id: String(input.id || ''),
    url: String(input.url || '/'),
    method,
    headers: Object.freeze(headers),
    ...connection,
    host,
    body
  })
}

export class Dispatcher {
  constructor({ rootDir, runtime, compiler, compilerRuntime, cache = true, bodyLimit = 1_048_576,
    bufferLimit = 16_777_216, compiledBufferLimit = 16_777_216 }) {
    this.router = new Router(rootDir)
    this.rootDir = rootDir
    this.compiler = compiler || new Compiler({ cache })
    this.compilerRuntime = compilerRuntime
    this.runtime = runtime
    this.bodyLimit = bodyLimit
    this.bufferLimit = bufferLimit
    this.bufferedBytes = 0
    this.compiledBufferLimit = compiledBufferLimit
    this.compiledBytes = 0
    this.admissions = new Set()
    this.accepting = true
    this.metrics = {
      dispatches: 0,
      templateRequests: 0,
      staticRequests: 0,
      admissionRejections: 0
    }
  }

  admit() {
    if (!this.accepting || !this.runtime.started || this.runtime.closing || this.runtime.failed ||
        this.admissions.size >= this.runtime.size + this.runtime.maxQueue) {
      this.metrics.admissionRejections += 1
      throw new RuntimeError('Cow request admission capacity is unavailable', {
        status: 503, code: 'COW_ADMISSION_FULL'
      })
    }
    let bytes = 0
    let compiledBytes = 0
    const admission = {
      reserveBytes: (count) => {
        if (!this.admissions.has(admission)) throw new Error('Cow admission has been released')
        if (count > this.bufferLimit - this.bufferedBytes) {
          this.metrics.admissionRejections += 1
          throw new RuntimeError('Cow aggregate request/response buffer budget is full', {
            status: 503, code: 'COW_BUFFER_FULL'
          })
        }
        bytes += count
        this.bufferedBytes += count
      },
      reserveCompiledBytes: (count) => {
        if (!this.admissions.has(admission)) throw new Error('Cow admission has been released')
        if (count > this.compiledBufferLimit - this.compiledBytes) {
          this.metrics.admissionRejections++
          throw new RuntimeError('Cow admitted compiled-template budget is full', {
            status: 503, code: 'COW_COMPILED_BUFFER_FULL'
          })
        }
        compiledBytes += count
        this.compiledBytes += count
      },
      releaseBytes: count => {
        if (!this.admissions.has(admission)) return
        if (!Number.isInteger(count) || count < 0 || count > bytes) throw new RangeError('Invalid admission byte release')
        bytes -= count
        this.bufferedBytes -= count
      },
      release: () => {
        if (!this.admissions.delete(admission)) return
        this.bufferedBytes -= bytes
        this.compiledBytes -= compiledBytes
      }
    }
    this.admissions.add(admission)
    return admission
  }

  async dispatch(input, { signal, admission, onStream } = {}) {
    const ownsAdmission = !admission
    try {
      signal?.throwIfAborted()
      admission ||= this.admit()
      if (!this.admissions.has(admission)) throw new Error('Invalid Cow request admission')
      const request = normalizeRequest(input)
      if (request.body.length > this.bodyLimit) {
        throw new RuntimeError(`Request body exceeds the ${this.bodyLimit} byte limit`, {
          status: 413, code: 'COW_BODY_TOO_LARGE'
        })
      }
      if (ownsAdmission) admission.reserveBytes(request.body.length)
      const result = await this.#dispatch(request, signal, admission, onStream)
      if (result.kind === 'response') result.response = finalResponse(result.response, request.method)
      return result
    } catch (error) {
      // Routing and source I/O can throw the caller's abort reason or a host
      // AbortError before a worker sees the request. Expose one request contract
      // across all phases, retaining the original failure for diagnostics.
      if (signal?.aborted && !(error instanceof RuntimeError &&
          error.code === 'COW_REQUEST_CANCELLED' && error.status === 499)) {
        const cancelled = new RuntimeError('Cow request was cancelled; running writes may already have committed', {
          status: 499, code: 'COW_REQUEST_CANCELLED'
        })
        cancelled.cause = error
        throw cancelled
      }
      throw error
    } finally {
      if (ownsAdmission) admission?.release()
    }
  }

  async #dispatch(input, signal, admission, onStream) {
    // Runtime failures stay in their original VM; never replay through another worker.
    try { return await this.#resolveAndRun(input, signal, admission, onStream) }
    catch (error) {
      if (error?.cowRuntimeFailure || signal?.aborted ||
          ['COW_COMPILED_BUFFER_FULL','COW_COMPILE_BUSY','COW_COMPILE_TIMEOUT'].includes(error?.code) ||
          (error instanceof RuntimeError && error.name === 'RuntimeError')) throw error
      const file = await findErrorPage(this.rootDir).catch(failure => { throw errorPageFailure(error, failure) })
      if (!file) throw error
      try {
        const template = await this.compiler.compile(file, { signal })
        admission.reserveCompiledBytes(template.estimatedBytes || 0)
        return { kind: 'response', response: await this.runtime.run(template, input, { signal, errorInfo: siteErrorInfo(error), onStream }) }
      } catch (failure) { throw errorPageFailure(error, failure) }
    }
  }

  async #resolveAndRun(input, signal, admission, onStream) {
    const request = normalizeRequest(input)
    this.metrics.dispatches += 1

    if (request.url === '*' && request.method === 'OPTIONS') {
      return response(204, '', { allow: TEMPLATE_METHODS.join(', ') })
    }
    const route = await this.router.resolve(request.url)
    signal?.throwIfAborted()
    const methods = route.kind === 'static' ? READ_METHODS : TEMPLATE_METHODS
    if (!methods.includes(request.method)) {
      return response(405, 'Method Not Allowed', {
        allow: methods.join(', '),
        'content-type': 'text/plain; charset=utf-8'
      })
    }

    if (request.method === 'OPTIONS') {
      return response(204, '', {
        allow: methods.join(', ')
      })
    }

    if (route.kind === 'static') {
      this.metrics.staticRequests += 1
      return { kind: 'file', filePath: route.filePath }
    }

    this.metrics.templateRequests += 1
    const template = await this.compiler.compile(route.filePath, { signal })
    signal?.throwIfAborted()
    admission.reserveCompiledBytes(template.estimatedBytes || 0)
    return {
      kind: 'response',
      response: await this.runtime.run(template, request, { signal, errorRoot: this.rootDir, onStream })
        .catch(error => { error.cowRuntimeFailure = true; throw error })
    }
  }

  status() {
    return {
      ...this.metrics,
      compilerCacheEntries: this.compiler.cache.size,
      compiler: this.compiler.status(),
      compilerRuntime: this.compilerRuntime?.status(),
      admittedRequests: this.admissions.size,
      admissionLimit: this.runtime.size + this.runtime.maxQueue,
      bufferedBytes: this.bufferedBytes,
      bufferLimit: this.bufferLimit,
      compiledBytes: this.compiledBytes,
      compiledBufferLimit: this.compiledBufferLimit,
      runtime: this.runtime.status()
    }
  }
}
