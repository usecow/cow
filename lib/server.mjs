import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import dns from 'node:dns'
import { isIP } from 'node:net'
import { extname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { errorHeaders, errorStatus, finalResponse, isBrowserPort, READ_METHODS } from './http-policy.mjs'
import { httpConnection, requestHost } from './request-metadata.mjs'

const MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.pdf', 'application/pdf'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml; charset=utf-8']
])

const STATUS_TITLES = new Map([
  [400, 'Bad Request'],
  [403, 'Forbidden'],
  [404, 'Not Found'],
  [405, 'Method Not Allowed'],
  [413, 'Payload Too Large'],
  [500, 'Internal Server Error'],
  [503, 'Service Unavailable'],
  [504, 'Gateway Timeout']
])

// Conditional GET (RFC 9110 13.1): If-None-Match wins over If-Modified-Since,
// and ETags compare weakly, ignoring any W/ prefix.
function notModified(headers, etag, mtimeMs) {
  const tags = headers['if-none-match']
  if (tags !== undefined) {
    const strip = tag => tag.trim().replace(/^W\//, '')
    return tags.split(',').some(tag => tag.trim() === '*' || strip(tag) === strip(etag))
  }
  const since = Date.parse(headers['if-modified-since'] ?? '')
  // HTTP dates have whole seconds, so compare at that precision.
  return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function errorDetails(error) {
  const seen = new Set()
  let result = ''
  const visit = (value, label = '', depth = 0) => {
    if (result.length >= 16_384 || depth > 4 || seen.has(value)) return
    seen.add(value)
    const text = `${label}${value?.code ? `[${value.code}] ` : ''}${value?.stack || value?.message || String(value)}\n`
    result += text.slice(0, 16_384 - result.length)
    if (value?.cause !== undefined) visit(value.cause, 'Caused by: ', depth + 1)
    if (Array.isArray(value?.errors)) for (const child of value.errors.slice(0, 8)) visit(child, 'Related error: ', depth + 1)
  }
  visit(error)
  return result.trimEnd()
}

function readBody(req, { limit, timeout, admission, signal }) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    let slab = null
    let slabUsed = 0
    const bodyError = () => Object.assign(new Error(`Request body exceeds the ${limit} byte limit`), {
      status: 413, code: 'COW_BODY_TOO_LARGE'
    })
    const finish = (error) => {
      clearTimeout(timer)
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
      if (error) {
        req.pause()
        reject(error)
      } else resolve(Buffer.concat(chunks, length))
    }
    const onData = chunk => {
      try {
        if (chunk.length > limit - length) throw bodyError()
        admission.reserveBytes(chunk.length)
        // Chunked uploads can deliver a byte per chunk. Retain fixed-size
        // slabs rather than an unbounded number of tiny Buffer objects.
        for (let offset = 0; offset < chunk.length;) {
          if (!slab || slabUsed === slab.length) {
            slab = Buffer.allocUnsafe(Math.min(4096, limit - length))
            slabUsed = 0
            chunks.push(slab)
          }
          const count = Math.min(chunk.length - offset, slab.length - slabUsed)
          chunk.copy(slab, slabUsed, offset, offset + count)
          slabUsed += count
          offset += count
          length += count
          chunks[chunks.length - 1] = slab.subarray(0, slabUsed)
        }
      } catch (error) { finish(error) }
    }
    const onEnd = () => finish()
    const onError = error => finish(error)
    const onAbort = () => finish(signal.reason)
    const timer = setTimeout(() => finish(Object.assign(new Error(`Request body exceeded ${timeout}ms deadline`), {
      status: 408, code: 'COW_BODY_TIMEOUT'
    })), timeout)
    if (signal?.aborted) return onAbort()
    if (Number(req.headers['content-length']) > limit) return finish(bodyError())
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
  })
}

function bodyBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  return Buffer.from(value ?? '')
}

function requestPath(req) {
  try {
    return new URL(req.url, 'http://cow.local').pathname
  } catch {
    return ''
  }
}

export class CowServer {
  constructor({
    host,
    port,
    dispatcher,
    bodyLimit = 1_048_576,
    bodyTimeout = 10_000,
    shutdownTimeout = 5_000,
    mode = 'development',
    healthPath = '/_cow/health',
    statusPath = '/_cow/status',
    logger = console
  }, { createHTTPServer = createServer } = {}) {
    this.host = host
    this.port = port
    this.dispatcher = dispatcher
    this.bodyLimit = bodyLimit
    this.bodyTimeout = bodyTimeout
    this.shutdownTimeout = shutdownTimeout
    this.mode = mode
    this.healthPath = healthPath
    this.statusPath = statusPath
    this.logger = logger
    this.createHTTPServer = createHTTPServer
    this.httpServer = null
    this.closingServer = null
    this.closePromise = null
    this.startPromise = null
    this.listenController = null
    this.activeRequests = 0
    this.startedAt = null
    this.metrics = {
      requests: 0,
      responses: 0,
      errors: 0,
      statusCodes: {}
    }
  }

  async start() {
    if (this.closePromise) throw Object.assign(new Error('Cow HTTP server is closing'), { code: 'COW_SERVER_CLOSING' })
    if (this.startPromise) return this.startPromise
    if (this.httpServer) return this.address()
    const promise = this.#start().finally(() => { if (this.startPromise === promise) this.startPromise = null })
    this.startPromise = promise
    return promise
  }

  async #start() {
    const controller = this.listenController = new AbortController()
    const server = this.httpServer = this.createHTTPServer((req, res) => {
      const requestId = String(req.headers['x-request-id'] || randomUUID())
      res.setHeader('x-request-id', requestId)
      const controller = new AbortController()
      const abort = () => {
        if (!res.writableFinished) controller.abort(Object.assign(new Error('HTTP client disconnected'), {
          status: 499, code: 'COW_REQUEST_CANCELLED'
        }))
      }
      const finished = new Promise(resolve => {
        res.once('finish', resolve)
        res.once('close', resolve)
      })
      res.once('close', abort)
      req.once('aborted', abort)
      // IncomingMessage can emit an error after body-read listeners are gone.
      req.on('error', abort)
      res.on('error', abort)
      let admission
      this.activeRequests += 1
      Promise.resolve().then(() => {
        const diagnostic = [this.healthPath, this.statusPath].includes(requestPath(req))
        if (!diagnostic) admission = this.dispatcher.admit()
        return this.handle(req, res, requestId, { signal: controller.signal, admission })
      })
        .catch((error) => {
          if (!req.complete) {
            res.shouldKeepAlive = false
            res.once('finish', () => req.destroy())
          }
          this.sendError(res, error, requestId)
        })
        .finally(async () => {
          // Hold admission and byte accounting while a slow reader retains the
          // output buffer, not merely until res.end() queues that buffer.
          await finished
          admission?.release()
          res.off('close', abort)
          req.off('aborted', abort)
          this.activeRequests -= 1
          if (this.activeRequests === 0) this.closingServer?.closeIdleConnections?.()
        })
    })

    try {
      // Custom OS ephemeral ranges can contain Fetch-blocked ports. Only port
      // zero opts into retries; never silently replace an explicit port.
      for (let attempt = 0; attempt < 16; attempt++) {
        controller.signal.throwIfAborted()
        await this.#listen(server, controller.signal)
        controller.signal.throwIfAborted()
        if (this.port !== 0 || isBrowserPort(server.address().port)) {
          this.startedAt = Date.now()
          return this.address()
        }
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      }
      throw Object.assign(new Error('Could not select a browser-safe port after 16 attempts; choose an explicit --port'), { code: 'COW_PORT_SELECTION_FAILED' })
    } catch (error) {
      await new Promise(resolve => server.close(() => resolve()))
      if (this.httpServer === server) this.httpServer = null
      throw error
    }
  }

  #listen(server, signal) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        server.off('error', onError)
        server.off('listening', onListening)
        signal.removeEventListener('abort', onAbort)
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const onListening = () => {
        cleanup()
        resolve()
      }
      const onAbort = () => onError(signal.reason)
      server.once('error', onError)
      server.once('listening', onListening)
      signal.addEventListener('abort', onAbort, { once: true })
      const listen = host => {
        if (signal.aborted) return
        try { server.listen({ port: this.port, host, signal }) } catch (error) { onError(error) }
      }
      // Resolve explicitly: compatibility hosts do not all use Node's lookup
      // path or cancel a pending lookup when a listener is closed. Checking the
      // signal here prevents a delayed DNS answer from resurrecting a server.
      if (this.host && !isIP(this.host)) {
        dns.lookup(this.host, { all: true }, (error, addresses) => {
          if (signal.aborted) return
          if (error) onError(error)
          else if (!addresses?.length) onError(new Error(`No addresses found for ${this.host}`))
          else listen(addresses[0].address)
        })
      } else listen(this.host)
    })
  }

  address() {
    const address = this.httpServer?.address()
    if (!address || typeof address === 'string') return null
    const displayHost = address.address === '::' ? 'localhost' : address.address
    const urlHost = displayHost.includes(':') ? `[${displayHost}]` : displayHost
    return { ...address, url: `http://${urlHost}:${address.port}` }
  }

  status() {
    return {
      state: this.httpServer?.listening ? 'listening' : 'stopped',
      mode: this.mode,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      ...this.metrics,
      activeRequests: this.activeRequests,
      application: this.dispatcher.status()
    }
  }

  async handle(req, res, requestId, { signal, admission } = {}) {
    this.metrics.requests += 1
    const connection = httpConnection(req)
    // Node's headers view discards duplicate Host lines. Use the distinct view
    // for validation before reading a body, routing or running a page.
    requestHost(req.headersDistinct || req.headers)
    const pathname = requestPath(req)

    if ([this.healthPath, this.statusPath].includes(pathname)) {
      // Diagnostic requests bypass application admission. Do not retain an
      // unbounded upload or leave unread bytes on a reusable connection.
      if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) {
        res.shouldKeepAlive = false
        res.once('finish', () => req.destroy())
      }
      if (!READ_METHODS.includes(req.method) || req.method === 'OPTIONS') {
        res.setHeader('allow', READ_METHODS.join(', '))
        return this.send(res, req.method === 'OPTIONS' ? 204 : 405, req.method === 'OPTIONS' ? '' : 'Method Not Allowed')
      }
    }

    if (['GET', 'HEAD'].includes(req.method) && pathname === this.healthPath) {
      const runtime = this.dispatcher.runtime.status()
      const compiler = this.dispatcher.compilerRuntime?.status()
      const healthy = runtime.state === 'running' && runtime.readyWorkers > 0 &&
        (!compiler || (compiler.state === 'running' && compiler.readyWorkers > 0))
      return this.sendJson(res, healthy ? 200 : 503, {
        status: healthy ? 'ok' : 'degraded',
        requestId
      })
    }

    if (['GET', 'HEAD'].includes(req.method) && pathname === this.statusPath) {
      return this.sendJson(res, 200, this.status())
    }

    const body = await readBody(req, { limit: this.bodyLimit, timeout: this.bodyTimeout, admission, signal })
    let streaming = false
    const onStream = async message => {
      signal?.throwIfAborted()
      if (res.destroyed || res.writableEnded) throw Object.assign(new Error('HTTP response closed'),{code:'COW_STREAM_CLOSED'})
      if (message.type === 'start') {
        if (streaming) throw new Error('Response stream already started')
        const normalized = finalResponse({...message,streamed:true},req.method)
        for (const [name,value] of Object.entries(normalized.headers)) res.setHeader(name,value)
        if (![204,205,304].includes(normalized.status) && !res.hasHeader('content-type')) res.setHeader('content-type','application/octet-stream')
        res.statusCode = normalized.status
        streaming = true
        res.flushHeaders()
      } else if (message.type === 'chunk' && streaming) {
        const chunk = bodyBuffer(message.body)
        if (chunk.length > 65_536) throw new RangeError('Response stream chunk exceeds its transport limit')
        admission.reserveBytes(chunk.length)
        try {
          await new Promise((resolve,reject)=>res.write(chunk,error=>error ? reject(error) : resolve()))
        } finally {admission.releaseBytes(chunk.length)}
      } else throw new Error('Invalid response stream message')
    }
    const result = await this.dispatcher.dispatch({
      id: requestId,
      url: req.url,
      method: req.method,
      headers: req.headers,
      ...connection,
      body
    }, { signal, admission, onStream })

    if (result.kind === 'file') {
      return this.serveStatic(req, res, result.filePath)
    }

    const response = result.response
    if (response.handledError) this.recordError(response.handledError, requestId)
    if (response.streamed) {
      res.end()
      return this.recordResponse(response.status)
    }
    admission.reserveBytes(response.body?.byteLength || 0)
    for (const [name, value] of Object.entries(response.headers || {})) {
      if (value !== undefined) res.setHeader(name, value)
    }
    if (![204, 205, 304].includes(response.status) && !res.hasHeader('content-type')) {
      res.setHeader('content-type', 'text/html; charset=utf-8')
    }

    // Dispatcher already normalized framing and stripped HEAD/bodyless bytes.
    res.statusCode = response.status
    res.end(bodyBuffer(response.body))
    this.recordResponse(response.status)
  }

  async serveStatic(req, res, filePath) {
    const fileStat = await stat(filePath)
    // Like Apache and nginx, send validators so the browser can re-check a
    // file cheaply. no-cache makes it re-check every time, so an edited file
    // shows on the next load instead of a heuristically cached copy.
    const etag = `W/"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`
    res.setHeader('cache-control', 'no-cache')
    res.setHeader('etag', etag)
    res.setHeader('last-modified', new Date(fileStat.mtimeMs).toUTCString())
    if (notModified(req.headers, etag, fileStat.mtimeMs)) {
      res.statusCode = 304
      res.end()
      return this.recordResponse(304)
    }
    res.statusCode = 200
    res.setHeader('content-length', fileStat.size)
    res.setHeader('content-type', MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream')
    if (req.method === 'HEAD') {
      res.end()
      return this.recordResponse(200)
    }

    // pipeline destroys the source on response close and waits for file closure.
    await pipeline(createReadStream(filePath), res)
    this.recordResponse(200)
  }

  sendJson(res, status, value) {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    this.send(res, status, JSON.stringify(value))
  }

  send(res, status, body, contentType, head = false) {
    if (res.writableEnded || res.destroyed) return
    if (contentType && !res.hasHeader('content-type')) res.setHeader('content-type', contentType)
    const response = finalResponse({ status, headers: res.getHeaders(), body: bodyBuffer(body) }, head || res.req?.method === 'HEAD' ? 'HEAD' : 'GET')
    for (const name of res.getHeaderNames()) res.removeHeader(name)
    for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value)
    res.statusCode = status
    res.end(response.body)
    this.recordResponse(status)
  }

  recordResponse(status) {
    this.metrics.responses += 1
    this.metrics.statusCodes[status] = (this.metrics.statusCodes[status] || 0) + 1
  }

  recordError(error, requestId) {
    const status = errorStatus(error?.status)
    this.metrics.errors += 1
    if (status < 500) return
    try {
      Promise.resolve(this.logger.error?.({
        name: error?.name, message: error?.message, stack: error?.stack,
        code: error?.code, cause: error?.cause, errors: error?.errors, status, requestId
      })).catch(() => {})
    } catch { /* Logging failure must not prevent a safe HTTP response. */ }
  }

  sendError(res, error, requestId) {
    try {
      this.#sendErrorResponse(res, error, requestId)
    } catch {
      // This is the terminal HTTP error boundary. A broken logger, malformed
      // adapter error or failed response write must not become an unhandled
      // rejection that terminates the listening process.
      res.destroy()
    }
  }

  #sendErrorResponse(res, error, requestId) {
    if (res.writableEnded || res.destroyed) return
    if (res.headersSent) {
      this.recordError(error, requestId)
      res.destroy(error)
      return
    }

    const status = errorStatus(error?.status)
    const title = STATUS_TITLES.get(status) || 'Request Failed'
    this.recordError(error, requestId)

    const headers = errorHeaders({ ...res.getHeaders(), ...error?.headers })
    for (const name of res.getHeaderNames()) res.removeHeader(name)
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
    res.setHeader('x-request-id', requestId)
    res.setHeader('cache-control', 'no-store')

    const details = this.mode === 'production'
      ? title
      : errorDetails(error)
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${status} ${title}</title></head><body><h1>${status} ${title}</h1><pre>${escapeHtml(details)}</pre><small>Request ${escapeHtml(requestId)}</small></body></html>`
    this.send(res, status, html, 'text/html; charset=utf-8')
  }

  async close({ deadline = Date.now() + this.shutdownTimeout } = {}) {
    if (this.closePromise) return this.closePromise
    if (!this.httpServer) return
    const server = this.httpServer
    this.httpServer = null
    this.closingServer = server
    if (this.startPromise) this.listenController?.abort(Object.assign(new Error('Cow HTTP startup was cancelled by close'), { code: 'COW_SERVER_CLOSING' }))
    this.closePromise = this.#drain(server, deadline).finally(() => {
      this.closingServer = null
      this.closePromise = null
    })
    return this.closePromise
  }

  async #drain(server, deadline) {
    let forced = false
    const timer = setTimeout(() => {
      forced = true
      server.closeAllConnections()
    }, Math.max(0, deadline - Date.now()))
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve())
        server.closeIdleConnections?.()
      })
      if (forced) {
        const error = new Error('Cow HTTP requests exceeded the application shutdown deadline')
        error.code = 'COW_HTTP_DRAIN_TIMEOUT'
        throw error
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
