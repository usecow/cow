import { createHash, randomBytes, scrypt as nativeScrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(nativeScrypt)
// Fixed scrypt-v1 profile: OWASP's 16 MiB / increased-work configuration.
const passwordOptions = Object.freeze({ N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 })
const hash = (value) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('hex')

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

// Text and quoted HTML attributes only; not JavaScript, CSS, or URL sanitizing.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character])
}

export function form(req) {
  if ((req.header('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    throw new HttpError(415, 'Submit this form as application/x-www-form-urlencoded.')
  }
  try {
    const text = req.body ? new TextDecoder('utf-8', { fatal: true }).decode(req.body()) : req.text()
    // URLSearchParams silently repairs invalid escapes/UTF-8. Validate first
    // so security-sensitive form values are never changed during parsing.
    for (const pair of text.split('&')) {
      for (const part of pair.split('=')) decodeURIComponent(part.replaceAll('+', ' '))
    }
    return new URLSearchParams(text)
  } catch {
    throw Object.assign(new HttpError(400, 'Form contains malformed percent escapes or UTF-8.'), { code: 'COW_INVALID_FORM' })
  }
}

export function field(values, name) {
  if (values.getAll(name).length > 1) throw new HttpError(400, `Duplicate form field: ${name}`)
  const value = values.get(name)
  if (value !== null && value !== undefined && typeof value !== 'string') throw new HttpError(400, `Expected a text form field: ${name}`)
  return value ?? ''
}

export function cookies(req) {
  const result = Object.create(null)
  for (const part of (req.header('cookie') || '').split(';')) {
    const at = part.indexOf('=')
    if (at < 1) continue
    const name = part.slice(0, at).trim()
    // Ambiguous cookies are rejected, not selected by header order.
    if (Object.hasOwn(result, name)) { result[name] = undefined; continue }
    try { result[name] = decodeURIComponent(part.slice(at + 1).trim()) } catch { result[name] = undefined }
  }
  return Object.freeze(result)
}

const cookieOptionNames = new Set(['path', 'domain', 'expires', 'maxAge', 'secure', 'httpOnly', 'sameSite'])

function cookieHeader(name, value, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid cookie options')
  for (const key of Object.keys(options)) {
    if (!cookieOptionNames.has(key)) throw new TypeError(`Unknown cookie option: ${key}`)
  }
  let { path = '/', domain, expires, maxAge, secure = false, httpOnly = true, sameSite = 'Lax' } = options
  if (typeof name !== 'string' || !/^[!#$%&'*+.^_`|~A-Za-z0-9-]+$/.test(name)) throw new TypeError('Invalid cookie name')
  if (typeof secure !== 'boolean' || typeof httpOnly !== 'boolean') throw new TypeError('Cookie flags must be booleans')
  if (!['Lax', 'Strict', 'None'].includes(sameSite)) throw new TypeError('Invalid cookie SameSite')
  if (typeof path !== 'string' || !path.startsWith('/') || /[^\x20-\x7e]|;/.test(path)) throw new TypeError('Invalid cookie path')
  if (domain !== undefined) {
    if (typeof domain !== 'string') throw new TypeError('Invalid cookie domain')
    domain = domain.replace(/^\./, '').toLowerCase()
    if (domain.length > 253 || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      throw new TypeError('Invalid cookie domain; use an ASCII hostname')
    }
  }
  if (expires !== undefined && (!(expires instanceof Date) || !Number.isFinite(expires.getTime()) ||
      expires.getUTCFullYear() < 1601 || expires.getUTCFullYear() > 9999)) throw new TypeError('Invalid cookie expiry')
  if (maxAge !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 0)) throw new TypeError('Invalid cookie lifetime')
  if (sameSite === 'None' && !secure) throw new TypeError('SameSite=None requires a secure cookie')
  if (name.startsWith('__Secure-') && !secure) throw new TypeError('__Secure- cookies require Secure')
  if (name.startsWith('__Host-') && (!secure || path !== '/' || domain !== undefined)) throw new TypeError('__Host- cookies require Secure, Path=/ and no Domain')
  return `${name}=${encodeURIComponent(value)}; Path=${path}${domain === undefined ? '' : `; Domain=${domain}`}; SameSite=${sameSite}${httpOnly ? '; HttpOnly' : ''}${secure ? '; Secure' : ''}${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}${expires === undefined ? '' : `; Expires=${expires.toUTCString()}`}`
}

export function setCookie(res, name, value, options = {}) {
  const cookie = cookieHeader(name, value, options)
  const previous = res.getHeader('set-cookie') || []
  res.setHeader('set-cookie', [...(Array.isArray(previous) ? previous : [previous]), cookie])
}

export function deleteCookie(res, name, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid cookie options')
  setCookie(res, name, '', { ...options, maxAge: 0, expires: new Date(0) })
}

export function secretMatches(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' &&
    timingSafeEqual(Buffer.from(hash(actual), 'hex'), Buffer.from(hash(expected), 'hex'))
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new HttpError(422, 'Use a password between 12 and 256 characters.')
  }
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64, passwordOptions)
  return `scrypt-v1$${salt}$${key.toString('hex')}`
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded || '')
  // Unknown users still pay the normal password-hashing cost.
  const key = await scrypt(password, match?.[1] || '0'.repeat(32), 64, passwordOptions)
  return Boolean(match) && timingSafeEqual(key, Buffer.from(match[2], 'hex'))
}

// Stable storage/cookie names survive the Jin -> Cow rename; do not silently
// abandon an existing application's sessions or create a parallel table.
const sessionSchema = `CREATE TABLE IF NOT EXISTS jin_sessions (
  token_hash TEXT PRIMARY KEY, data TEXT NOT NULL, csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0
); CREATE INDEX IF NOT EXISTS jin_sessions_expiry ON jin_sessions(expires_at)`
const epoch = () => Math.floor(Date.now() / 1000)
const sessionError = (status, code, message) => Object.assign(new HttpError(status, message), { code })
const endedSession = () => sessionError(403, 'COW_SESSION_ENDED', 'This session has ended.')
const sessionColumns = 'data, csrf, expires_at, version'

function sessionData(data) {
  const encoded = JSON.stringify(data)
  if (encoded === undefined) throw new TypeError('Session data must be JSON serializable')
  return encoded
}

// Explicit and bounded; callers may repeat this until it returns less than limit.
export function pruneSessions(db, { limit = 1000 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Session cleanup limit must be a positive integer')
  db.exec(sessionSchema)
  return Number(db.run(`DELETE FROM jin_sessions WHERE token_hash IN (
    SELECT token_hash FROM jin_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT ?
  )`, [epoch(), limit]).changes)
}

// Explicit snapshots and optimistic writes; nothing is implicitly saved at shutdown.
export async function session(db, req, res, options = {}) {
  const { name = 'jin_session', maxAge = 8 * 60 * 60, ...cookieOptions } = options
  const scope = { secure: false, ...cookieOptions }
  const ensureHeaders = () => {
    if (res.headersSent) throw new HttpError(500, 'Set session cookies before committing response headers.')
  }
  ensureHeaders()
  if (!Number.isSafeInteger(maxAge) || maxAge < 1 || epoch() + maxAge > 253_402_300_799) throw new TypeError('Invalid session lifetime')
  if (Object.hasOwn(scope, 'expires')) throw new TypeError('Session expiry is controlled by maxAge and touch()')
  // Validate before creating a record so invalid configuration cannot orphan it.
  cookieHeader(name, '', { ...scope, maxAge })
  db.exec(sessionSchema)
  if (!db.all('PRAGMA table_info(jin_sessions)').some(column => column.name === 'version')) {
    await db.transaction(() => {
      // Another worker may have migrated while this one waited for the write lock.
      if (!db.all('PRAGMA table_info(jin_sessions)').some(column => column.name === 'version')) {
        db.exec('ALTER TABLE jin_sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 0')
      }
    }, { mode: 'immediate' })
  }
  pruneSessions(db, { limit: 100 })
  const now = epoch()
  const supplied = cookies(req)[name]
  let id = /^[a-f0-9]{64}$/.test(supplied || '') ? supplied : null
  let identity = id ? hash(id) : null
  let row = identity ? db.get(`SELECT ${sessionColumns} FROM jin_sessions WHERE token_hash = ? AND expires_at > ?`, [identity, now]) : null
  const sendCookie = () => setCookie(res, name, id, {
    ...scope, maxAge: Math.max(0, row.expires_at - epoch()), expires: new Date(row.expires_at * 1000)
  })
  if (!row) {
    id = token()
    identity = hash(id)
    row = { data: '{}', csrf: token(), expires_at: now + maxAge, version: 0 }
    db.run('INSERT INTO jin_sessions (token_hash, data, csrf, expires_at) VALUES (?, ?, ?, ?)', [identity, row.data, row.csrf, row.expires_at])
    sendCookie()
  }
  let closed = false, busy = false
  const ensureOpen = () => {
    if (closed) throw endedSession()
    if (busy) throw sessionError(409, 'COW_SESSION_BUSY', 'Await the pending session operation before using this session.')
  }
  const currentRow = () => db.get(`SELECT ${sessionColumns} FROM jin_sessions WHERE token_hash = ? AND expires_at > ?`, [identity, epoch()])
  const conflict = () => {
    if (!currentRow()) throw endedSession()
    throw sessionError(409, 'COW_SESSION_CONFLICT', 'This session changed in another request. Refresh it before applying your update again.')
  }
  return Object.freeze({
    get data() { return JSON.parse(row.data) },
    get csrfToken() { return row.csrf },
    get expiresAt() { return row.expires_at },
    refresh() {
      ensureOpen()
      const fresh = currentRow()
      if (!fresh) throw endedSession()
      row = fresh
      return JSON.parse(row.data)
    },
    update(data) {
      ensureOpen()
      const encoded = sessionData(data)
      const updated = db.get(`UPDATE jin_sessions SET data = ?, version = version + 1
        WHERE token_hash = ? AND version = ? AND expires_at > ? RETURNING ${sessionColumns}`,
      [encoded, identity, row.version, epoch()])
      if (!updated) conflict()
      row = updated
    },
    touch() {
      ensureOpen()
      ensureHeaders()
      const updated = db.get(`UPDATE jin_sessions SET expires_at = ?, version = version + 1
        WHERE token_hash = ? AND version = ? AND expires_at > ? RETURNING ${sessionColumns}`,
      [epoch() + maxAge, identity, row.version, epoch()])
      if (!updated) conflict()
      row = updated
      sendCookie()
    },
    verify(values) {
      ensureOpen()
      if (closed || !secretMatches(field(values, 'csrf'), row.csrf) ||
          !currentRow()) {
        throw new HttpError(403, 'This form has expired. Reload the page and try again.')
      }
    },
    async replace(data) {
      ensureOpen()
      ensureHeaders()
      const replacementId = token()
      const replacement = { data: sessionData(data), csrf: token(), expires_at: epoch() + maxAge, version: 0 }
      busy = true
      try {
        await db.transaction(() => {
          const removed = db.run('DELETE FROM jin_sessions WHERE token_hash = ? AND version = ? AND expires_at > ?', [identity, row.version, epoch()])
          if (!removed.changes) conflict()
          db.run('INSERT INTO jin_sessions (token_hash, data, csrf, expires_at) VALUES (?, ?, ?, ?)', [hash(replacementId), replacement.data, replacement.csrf, replacement.expires_at])
        }, { mode: 'immediate' })
        id = replacementId
        identity = hash(id)
        row = replacement
        sendCookie()
      } finally { busy = false }
    },
    destroy() {
      ensureOpen()
      ensureHeaders()
      db.run('DELETE FROM jin_sessions WHERE token_hash = ?', [identity])
      closed = true
      deleteCookie(res, name, scope)
    }
  })
}
