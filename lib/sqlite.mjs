import { DatabaseSync } from 'node:sqlite'
import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineResource } from './resource.mjs'

const DEFAULT_TIMEOUT = 5_000
const TRANSACTION_MODES = new Set(['DEFERRED', 'IMMEDIATE', 'EXCLUSIVE'])
const OPTION_NAMES = new Set([
  'filename',
  'path',
  'readOnly',
  'foreignKeys',
  'timeout',
  'busyTimeout',
  'readBigInts',
  'returnArrays',
  'allowBareNamedParameters',
  'allowUnknownNamedParameters',
  'doubleQuotedStringLiterals'
])
const leaseStates = new WeakMap()

export class CowSQLiteError extends Error {
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'CowSQLiteError'
    this.code = code
    this.status = 500
  }
}

function fail(message, code, cause) {
  return new CowSQLiteError(message, code, cause)
}

function booleanOption(value, fallback, name) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw fail(`SQLite option ${name} must be a boolean`, 'COW_SQLITE_OPTIONS_INVALID')
  }
  return value
}

function timeoutOption(options) {
  if (options.timeout !== undefined && options.busyTimeout !== undefined) {
    throw fail(
      'Use either SQLite option timeout or busyTimeout, not both',
      'COW_SQLITE_OPTIONS_INVALID'
    )
  }

  const value = options.timeout ?? options.busyTimeout ?? DEFAULT_TIMEOUT
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw fail(
      'SQLite timeout must be an integer between 0 and 2147483647 milliseconds',
      'COW_SQLITE_OPTIONS_INVALID'
    )
  }
  return value
}

function filenameOption(value) {
  let filename = value
  if (filename && typeof filename === 'object' && typeof filename.href === 'string') {
    filename = filename.href
  }
  if (typeof filename !== 'string' || filename.length === 0) {
    throw fail('sqlite() requires a database filename', 'COW_SQLITE_OPTIONS_INVALID')
  }

  if (filename.startsWith('file:')) {
    try {
      filename = fileURLToPath(filename)
    } catch (cause) {
      throw fail('SQLite filename must be a valid file URL', 'COW_SQLITE_OPTIONS_INVALID', cause)
    }
  }

  return filename === ':memory:' ? filename : resolve(filename)
}

function normalizeOptions(filenameOrOptions, additionalOptions) {
  let input
  if (
    typeof filenameOrOptions === 'string' ||
    (filenameOrOptions && typeof filenameOrOptions === 'object' &&
      typeof filenameOrOptions.href === 'string')
  ) {
    input = { ...(additionalOptions || {}), filename: filenameOrOptions }
  } else if (filenameOrOptions && typeof filenameOrOptions === 'object') {
    if (additionalOptions && Object.keys(additionalOptions).length > 0) {
      throw fail(
        'SQLite options must be passed in one object when filename is part of that object',
        'COW_SQLITE_OPTIONS_INVALID'
      )
    }
    input = { ...filenameOrOptions }
  } else {
    throw fail('sqlite() requires a filename or options object', 'COW_SQLITE_OPTIONS_INVALID')
  }

  for (const name of Object.keys(input)) {
    if (!OPTION_NAMES.has(name)) {
      throw fail(`Unknown SQLite option: ${name}`, 'COW_SQLITE_OPTIONS_INVALID')
    }
  }
  if (input.filename !== undefined && input.path !== undefined) {
    throw fail(
      'Use either SQLite option filename or path, not both',
      'COW_SQLITE_OPTIONS_INVALID'
    )
  }

  return {
    filename: filenameOption(input.filename ?? input.path),
    readOnly: booleanOption(input.readOnly, false, 'readOnly'),
    foreignKeys: booleanOption(input.foreignKeys, true, 'foreignKeys'),
    timeout: timeoutOption(input),
    readBigInts: booleanOption(input.readBigInts, false, 'readBigInts'),
    returnArrays: booleanOption(input.returnArrays, false, 'returnArrays'),
    allowBareNamedParameters: booleanOption(
      input.allowBareNamedParameters,
      true,
      'allowBareNamedParameters'
    ),
    allowUnknownNamedParameters: booleanOption(
      input.allowUnknownNamedParameters,
      false,
      'allowUnknownNamedParameters'
    ),
    doubleQuotedStringLiterals: booleanOption(
      input.doubleQuotedStringLiterals,
      false,
      'doubleQuotedStringLiterals'
    )
  }
}

function sqlText(sql) {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw fail('SQLite SQL must be a non-empty string', 'COW_SQLITE_SQL_INVALID')
  }
  return sql
}

function transactionMode(value = 'deferred') {
  const mode = String(value).toUpperCase()
  if (!TRANSACTION_MODES.has(mode)) {
    throw fail(
      'SQLite transaction mode must be deferred, immediate, or exclusive',
      'COW_SQLITE_TRANSACTION_MODE_INVALID'
    )
  }
  return mode
}

function requestAborted() {
  const error = fail('The Cow request has ended', 'COW_SQLITE_REQUEST_ENDED')
  error.status = 499
  return error
}

function ensureActive(state) {
  if (state.closed) throw fail('This SQLite request handle is closed', 'COW_SQLITE_LEASE_CLOSED')
  if (state.signal?.aborted) throw requestAborted()
  const execution = state.execution.getStore()
  const owner = state.transactions.findLast((entry) => entry.managed)?.owner
  if (execution?.ended) throw fail('This SQLite transaction callback has ended', 'COW_SQLITE_TRANSACTION_ENDED')
  if (owner && owner !== execution) {
    throw fail('Await each SQLite transaction; do not use the same handle concurrently', 'COW_SQLITE_TRANSACTION_CONCURRENT')
  }
}

function managedSql(state, sql) {
  const text = sqlText(sql)
  if (state.transactions.some((entry) => entry.managed)) {
    const unquoted = text.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    if (/(?:^|;)\s*(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(unquoted)) {
      throw fail('Do not issue transaction-control SQL inside transaction(); use its callback and nested transaction() instead', 'COW_SQLITE_TRANSACTION_STATE_INVALID')
    }
  }
  return text
}

function prepare(state, sql) {
  ensureActive(state)
  const statement = state.database.prepare(managedSql(state, sql))
  const configure = (method, value, fallback) => {
    if (typeof statement[method] === 'function') statement[method](value)
    else if (value !== fallback) {
      throw fail(
        `This Node.js version does not support SQLite option ${method}`,
        'COW_SQLITE_OPTION_UNSUPPORTED'
      )
    }
  }
  configure('setReadBigInts', state.options.readBigInts, false)
  configure('setReturnArrays', state.options.returnArrays, false)
  configure('setAllowBareNamedParameters', state.options.allowBareNamedParameters, true)
  if (typeof statement.setAllowUnknownNamedParameters === 'function') {
    statement.setAllowUnknownNamedParameters(state.options.allowUnknownNamedParameters)
  } else if (state.options.allowUnknownNamedParameters) {
    throw fail(
      'This Node.js version does not support SQLite option allowUnknownNamedParameters',
      'COW_SQLITE_OPTION_UNSUPPORTED'
    )
  }
  return statement
}

function isNamedParameters(value) {
  return value !== null &&
    typeof value === 'object' &&
    !ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
}

function executeStatement(state, method, sql, parameters) {
  const statement = prepare(state, sql)
  let result
  try {
    if (parameters === undefined) result = statement[method]()
    else if (Array.isArray(parameters)) result = statement[method](...parameters)
    else if (isNamedParameters(parameters)) {
      result = statement[method](Object.fromEntries(Object.entries(parameters)))
    } else result = statement[method](parameters)

    if (method === 'all' && !state.options.returnArrays) {
      return result.map((row) => ({ ...row }))
    }
    if ((method === 'get' || method === 'run') && result && !Array.isArray(result)) {
      return { ...result }
    }
    return result
  } finally {
    // Newer implementations support eager finalization; older Node versions
    // retain statements until collection or database close.
    if (typeof statement.close === 'function') statement.close()
  }
}

function rollbackOpenTransaction(database) {
  if (typeof database.isTransaction === 'boolean' && !database.isTransaction) return
  try {
    database.exec('ROLLBACK')
  } catch (error) {
    if (/no transaction is active/i.test(error?.message || '')) return
    throw error
  }
}

function finishTransaction(state, action) {
  // Internal unwind must also be able to cancel unawaited nested callbacks.
  const entry = state.transactions.at(-1)

  if (!entry) {
    state.database.exec(action === 'commit' ? 'COMMIT' : 'ROLLBACK')
    return
  }

  if (entry.type === 'transaction') {
    state.database.exec(action === 'commit' ? 'COMMIT' : 'ROLLBACK')
  } else if (action === 'commit') {
    state.database.exec(`RELEASE SAVEPOINT ${entry.name}`)
  } else {
    state.database.exec(`ROLLBACK TO SAVEPOINT ${entry.name}; RELEASE SAVEPOINT ${entry.name}`)
  }
  state.transactions.pop()
  if (entry.owner) entry.owner.ended = true
}

function rollbackToDepth(state, depth, cause) {
  const errors = []
  while (state.transactions.length > depth) {
    try {
      finishTransaction(state, 'rollback')
    } catch (error) {
      errors.push(error)
      state.transactions.pop()
    }
  }

  if (errors.length > 0) {
    const error = new AggregateError(
      [cause, ...errors],
      'SQLite transaction failed and could not be completely rolled back'
    )
    error.code = 'COW_SQLITE_ROLLBACK_FAILED'
    error.status = 500
    error.cause = cause
    throw error
  }
}

function createFacade(database, options, signal) {
  const state = {
    database,
    options,
    signal,
    closed: false,
    execution: new AsyncLocalStorage(),
    transactions: [],
    nextSavepoint: 1
  }
  let facade

  const begin = (mode = 'deferred') => {
    ensureActive(state)
    const normalizedMode = transactionMode(mode)
    const hasManagedTransaction = state.transactions.length > 0
    const hasNativeTransaction = typeof database.isTransaction === 'boolean'
      ? database.isTransaction
      : hasManagedTransaction

    if (!hasNativeTransaction) {
      database.exec(`BEGIN ${normalizedMode}`)
      state.transactions.push({ type: 'transaction' })
    } else {
      const name = `cow_${state.nextSavepoint++}`
      database.exec(`SAVEPOINT ${name}`)
      state.transactions.push({ type: 'savepoint', name })
    }
    return facade
  }

  facade = {
    exec(sql) {
      ensureActive(state)
      database.exec(managedSql(state, sql))
      return facade
    },

    run(sql, parameters) {
      return executeStatement(state, 'run', sql, parameters)
    },

    get(sql, parameters) {
      return executeStatement(state, 'get', sql, parameters)
    },

    all(sql, parameters) {
      return executeStatement(state, 'all', sql, parameters)
    },

    query(sql, parameters) {
      return executeStatement(state, 'all', sql, parameters)
    },

    begin(mode) {
      if (state.transactions.some((entry) => entry.managed)) {
        throw fail('Use nested transaction() inside a managed transaction', 'COW_SQLITE_TRANSACTION_STATE_INVALID')
      }
      return begin(mode)
    },

    commit() {
      ensureActive(state)
      if (state.transactions.some((entry) => entry.managed)) {
        throw fail('Do not manually commit a managed SQLite transaction', 'COW_SQLITE_TRANSACTION_STATE_INVALID')
      }
      finishTransaction(state, 'commit')
      return facade
    },

    rollback() {
      ensureActive(state)
      if (state.transactions.some((entry) => entry.managed)) {
        throw fail('Do not manually roll back a managed SQLite transaction', 'COW_SQLITE_TRANSACTION_STATE_INVALID')
      }
      finishTransaction(state, 'rollback')
      return facade
    },

    async transaction(callback, { mode = 'deferred' } = {}) {
      if (typeof callback !== 'function') {
        throw fail('SQLite transaction requires a callback', 'COW_SQLITE_TRANSACTION_INVALID')
      }

      ensureActive(state)
      const depth = state.transactions.length
      begin(mode)
      const owner = { ended: false }
      Object.assign(state.transactions.at(-1), { managed: true, owner })
      return state.execution.run(owner, async () => {
        try {
          const result = await callback(facade)
          ensureActive(state)
          if (state.transactions.length !== depth + 1) {
            throw fail('Await nested SQLite transactions before finishing their parent', 'COW_SQLITE_TRANSACTION_STATE_INVALID')
          }
          finishTransaction(state, 'commit')
          return result
        } catch (cause) {
          rollbackToDepth(state, depth, cause)
          throw cause
        } finally {
          owner.ended = true
        }
      })
    }
  }

  Object.defineProperty(facade, 'inTransaction', {
    enumerable: true,
    get() {
      ensureActive(state)
      return typeof database.isTransaction === 'boolean'
        ? database.isTransaction
        : state.transactions.length > 0
    }
  })

  Object.freeze(facade)
  leaseStates.set(facade, state)
  return facade
}

const acquireSQLite = defineResource({
  name: 'sqlite',

  key(options) {
    return JSON.stringify([
      options.filename,
      options.readOnly,
      options.foreignKeys,
      options.timeout,
      options.readBigInts,
      options.returnArrays,
      options.allowBareNamedParameters,
      options.allowUnknownNamedParameters,
      options.doubleQuotedStringLiterals
    ])
  },

  open(options) {
    let database
    try {
      database = new DatabaseSync(options.filename, {
        readOnly: options.readOnly,
        enableForeignKeyConstraints: options.foreignKeys,
        enableDoubleQuotedStringLiterals: options.doubleQuotedStringLiterals,
        allowExtension: false
      })
      if (typeof database.isTransaction !== 'boolean') {
        throw fail('Cow SQLite requires Node.js 22.16 or newer with DatabaseSync.isTransaction', 'COW_SQLITE_RUNTIME_UNSUPPORTED')
      }
      database.exec(`PRAGMA busy_timeout = ${options.timeout}`)
      return database
    } catch (cause) {
      try {
        database?.close()
      } catch {}
      throw cause
    }
  },

  acquire(database, { options, signal }) {
    database.exec(`
      PRAGMA foreign_keys = ${options.foreignKeys ? 'ON' : 'OFF'};
      PRAGMA busy_timeout = ${options.timeout};
    `)
    return createFacade(database, options, signal)
  },

  release(facade) {
    const state = leaseStates.get(facade)
    if (!state || state.closed) return
    state.closed = true
    state.transactions.length = 0
    rollbackOpenTransaction(state.database)
    leaseStates.delete(facade)
  },

  beforeResponse(facade) {
    if (facade.inTransaction) {
      throw fail('Finish the SQLite transaction before ending the response. Await transaction(), or explicitly commit or roll back first.', 'COW_SQLITE_RESPONSE_IN_TRANSACTION')
    }
  },

  async close(database) {
    rollbackOpenTransaction(database)
    if (database.isOpen !== false) database.close()
    if (globalThis.Bun) {
      // Bun #40001: node:sqlite close leaves prepared statements holding the
      // connection. Cow never exposes them, so after their stack unwinds a full
      // collection releases them deterministically (including Windows locks).
      // This runs on resource eviction/shutdown, not on each request/query.
      await new Promise(resolve => setImmediate(resolve))
      Bun.gc(true)
    }
  }
})

export async function sqlite(filenameOrOptions, options = {}) {
  return acquireSQLite(normalizeOptions(filenameOrOptions, options))
}

export const openSQLite = sqlite
export default sqlite
