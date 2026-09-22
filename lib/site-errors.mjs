import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { errorHeaders, errorStatus } from './http-policy.mjs'
import { templateExtensions } from './template-format.mjs'

export async function findErrorPage(rootDir) {
  if (!rootDir) return null
  for (const name of templateExtensions.map(extension => '_error' + extension)) {
    const file = resolve(rootDir, name)
    try { if ((await stat(file)).isFile()) return file }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
  }
  return null
}

// A serializable diagnostic snapshot, never executable exception objects.
export function siteErrorInfo(error, headers, depth = 0, seen = new Set()) {
  if (depth > 4 || seen.has(error)) return { name: 'Error', message: '[additional details omitted]', status: 500, headers: {} }
  seen.add(error)
  return {
    name: String(error?.name || 'Error').slice(0, 128),
    message: String(error?.message || error).slice(0, 8192),
    code: typeof error?.code === 'string' ? error.code.slice(0, 128) : undefined,
    status: errorStatus(error?.status),
    stack: typeof error?.stack === 'string' ? error.stack.slice(0, 16384) : undefined,
    headers: errorHeaders(headers || error?.headers || {}),
    cause: error?.cause === undefined ? undefined : siteErrorInfo(error.cause, undefined, depth + 1, seen),
    errors: Array.isArray(error?.errors) ? error.errors.slice(0, 8).map(value => siteErrorInfo(value, undefined, depth + 1, seen)) : undefined
  }
}

export function errorPageFailure(original, failure) {
  return Object.assign(new AggregateError([original, failure], 'Cow site error page failed', { cause: original }), {
    code: 'COW_ERROR_HANDLER_FAILED', status: 500
  })
}
