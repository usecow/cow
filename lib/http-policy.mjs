import { validateHeaderName, validateHeaderValue } from 'node:http'

export const TEMPLATE_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
export const READ_METHODS = ['GET', 'HEAD', 'OPTIONS']

export function finalStatus(value) {
  if (!Number.isInteger(value) || value < 200 || value > 599) {
    throw new RangeError(`Invalid HTTP status code: ${value}; Cow requires a final status from 200 to 599`)
  }
  return value
}

// Cow owns buffered-response framing. Applications cannot emit a second
// framing scheme, trailers or an upgrade through ordinary response headers.
export function finalResponse(response, method = 'GET') {
  const status = finalStatus(response.status)
  const body = Buffer.from(response.body || [])
  const headers = Object.create(null)
  const owned = new Set(['content-length', 'transfer-encoding', 'trailer', 'connection', 'keep-alive', 'upgrade'])
  for (const [name, value] of Object.entries(response.headers || {})) {
    const key = name.toLowerCase()
    if (owned.has(key) || value === undefined) continue
    validateHeaderName(key)
    validateHeaderValue(key, value)
    headers[key] = value
  }
  const bodyless = [204, 205, 304].includes(status)
  // A 304 representation length cannot be inferred from its discarded body.
  const length = response.contentLength ?? (response.streamed ? undefined : body.length)
  if (status === 205) headers['content-length'] = '0'
  else if (![204, 304].includes(status) && length !== undefined) headers['content-length'] = String(length)
  return { ...response, status, headers, body: bodyless || method === 'HEAD' ? Buffer.alloc(0) : body }
}

// WHATWG Fetch port-blocking table, checked September 7, 2026:
// https://fetch.spec.whatwg.org/#port-blocking
const BAD_PORTS = new Set([0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
  77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143,
  161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587,
  601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080])
export const isBrowserPort = port => !BAD_PORTS.has(port)

// Only policy, authentication and cookie headers survive a failed response.
// Body metadata, cache validators, redirects and arbitrary success headers do not.
const ERROR_HEADERS = new Set([
  'allow', 'www-authenticate', 'retry-after', 'set-cookie',
  'content-security-policy', 'content-security-policy-report-only',
  'x-content-type-options', 'x-frame-options', 'strict-transport-security',
  'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy',
  'cross-origin-embedder-policy', 'cross-origin-resource-policy',
  'access-control-allow-origin', 'access-control-allow-credentials',
  'access-control-allow-methods', 'access-control-allow-headers',
  'access-control-expose-headers', 'access-control-max-age', 'vary'
])

export function errorHeaders(headers = {}) {
  const result = Object.create(null)
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (!ERROR_HEADERS.has(key) || value === undefined) continue
    try {
      validateHeaderName(key)
      validateHeaderValue(key, value)
      result[key] = value
    } catch { /* Invalid application headers must not break the error path. */ }
  }
  return result
}

export function errorStatus(value) {
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 500
}
