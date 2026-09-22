import { writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { form } from './web.mjs'
// Explicit package entry avoids Bun's built-in replacement for bare "undici".
import { Response as MultipartResponse } from 'undici/index.js'

const defaults = Object.freeze({ maxFiles: 10, maxFileSize: 1_048_576, maxFields: 100, maxFieldSize: 65_536 })
const failure = (status, code, message) => Object.assign(new Error(message), { status, code })

function limits(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('formData options must be an object')
  const result = { ...defaults }
  for (const key of Object.keys(options)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown formData option: ${key}`)
    if (!Number.isSafeInteger(options[key]) || options[key] < 0) throw new TypeError(`${key} must be a non-negative safe integer`)
    result[key] = options[key]
  }
  return result
}

// Body admission has already bounded the complete wire body. Parse only when
// the page asks. No upload paths, disk spooling, shared registry or native
// adapter is needed: unsaved bytes belong to this request's worker memory.
export function createRequestForm({ body, contentType, assertActive, onCleanup }) {
  let pending, entries, closed = false
  const disposers = []
  function active() {
    assertActive()
    if (closed) throw failure(500, 'COW_REQUEST_ENDED', 'This Cow request has ended')
  }
  onCleanup(() => {
    closed = true
    for (const dispose of disposers) dispose()
    disposers.length = 0
    entries = pending = body = null
  })

  function upload(file) {
    let saving = false
    const { name, type, size } = file
    const available = () => {
      active()
      if (!file) throw failure(500, 'COW_UPLOAD_SAVED', 'This upload has already been saved')
      if (saving) throw failure(500, 'COW_UPLOAD_SAVING', 'This upload is being saved')
    }
    disposers.push(() => { file = null })
    return Object.freeze({
      name, type, size,
      async bytes() {
        available()
        return Buffer.from(await file.arrayBuffer())
      },
      async text() {
        available()
        return file.text()
      },
      async save(destination) {
        available()
        // Never resolve a client filename implicitly or depend on the server's
        // working directory. The site chooses an explicit absolute destination.
        if (typeof destination !== 'string' || !isAbsolute(destination) || destination.includes('\0')) {
          throw new TypeError('Upload save requires an absolute destination path')
        }
        saving = true
        try {
          await writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 })
          file = null
          return destination
        } finally { saving = false }
      }
    })
  }

  async function parse() {
    const mediaType = String(contentType || '').split(';')[0].trim().toLowerCase()
    let values
    if (mediaType === 'application/x-www-form-urlencoded') {
      values = form({ header: () => contentType, body: () => body })
    } else if (mediaType === 'multipart/form-data') {
      try {
        values = await new MultipartResponse(body, { headers: { 'content-type': contentType } }).formData()
      } catch {
        throw failure(400, 'COW_INVALID_MULTIPART', 'Request body is not valid multipart form data')
      }
    } else {
      throw failure(415, 'COW_FORM_CONTENT_TYPE', 'Use multipart/form-data or application/x-www-form-urlencoded')
    }
    active()
    entries = []
    for (const [name, value] of values) {
      if (Buffer.byteLength(name) > 256 || (typeof value !== 'string' && Buffer.byteLength(value.name) > 1024)) {
        throw failure(413, 'COW_FORM_NAME_TOO_LARGE', 'Form field names must fit in 256 UTF-8 bytes and filenames in 1024 UTF-8 bytes')
      }
      entries.push([name, typeof value === 'string' ? value : upload(value)])
    }
    return entries
  }

  return async (options) => {
    active()
    const bound = limits(options)
    pending ||= parse()
    const values = await pending
    active()
    let files = 0, fields = 0
    for (const [, value] of values) {
      const isFile = typeof value !== 'string'
      if (isFile) files++; else fields++
      if (files > bound.maxFiles || fields > bound.maxFields ||
          (isFile ? value.size > bound.maxFileSize : Buffer.byteLength(value) > bound.maxFieldSize)) {
        throw failure(413, 'COW_FORM_LIMIT', 'Form exceeds its file/count/field size limits')
      }
    }
    // A read-only FormData-style view, not a mutable browser FormData instance.
    // Repeated fields stay repeated; bracketed names are literal, not PHP arrays.
    return Object.freeze({
      get(name) { active(); return values.find(entry => entry[0] === String(name))?.[1] ?? null },
      getAll(name) { active(); return values.filter(entry => entry[0] === String(name)).map(entry => entry[1]) },
      has(name) { active(); return values.some(entry => entry[0] === String(name)) },
      entries() { active(); return values.map(entry => [...entry]).values() },
      keys() { active(); return values.map(entry => entry[0]).values() },
      values() { active(); return values.map(entry => entry[1]).values() },
      [Symbol.iterator]() { return this.entries() }
    })
  }
}
