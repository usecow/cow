import { createRequire } from 'node:module'
import { join } from 'node:path'
import { defineResource } from './resource.mjs'

export class CowPostgresError extends Error {
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'CowPostgresError'
    this.code = code
    this.status = code === 'COW_REQUEST_CANCELLED' ? 499 : 500
  }
}

const fail = (message, code, cause) => new CowPostgresError(message, code, cause)

const OPTION_NAMES = new Set(['connectionString', 'url', 'max', 'connectTimeout', 'idleTimeout', 'statementTimeout', 'ssl'])
const ISOLATION_LEVELS = new Map([
  ['read committed', 'READ COMMITTED'],
  ['repeatable read', 'REPEATABLE READ'],
  ['serializable', 'SERIALIZABLE']
])

function normalizeOptions(input, extra) {
  const options = typeof input === 'string' || input instanceof URL
    ? { ...extra, connectionString: String(input) }
    : { ...input, ...extra }
  for (const name of Object.keys(options)) {
    if (!OPTION_NAMES.has(name)) throw new TypeError(`Unknown postgres() option: ${name}`)
  }
  const connectionString = options.connectionString ?? options.url
  if (typeof connectionString !== 'string' || !connectionString) {
    throw new TypeError('postgres() needs a connection string, for example postgres(process.env.DATABASE_URL)')
  }
  const normalized = {
    connectionString,
    max: options.max ?? 5,
    connectTimeout: options.connectTimeout ?? 10_000,
    idleTimeout: options.idleTimeout ?? 30_000,
    statementTimeout: options.statementTimeout ?? 0,
    ssl: options.ssl ?? null
  }
  for (const name of ['max', 'connectTimeout', 'idleTimeout', 'statementTimeout']) {
    const value = normalized[name]
    if (!Number.isSafeInteger(value) || value < (name === 'max' ? 1 : 0)) throw new TypeError(`Invalid postgres() option ${name}: ${value}`)
  }
  return normalized
}

// pg comes from the site, so Cow itself carries no Postgres dependency. Look in
// the site first, then next to Cow, as in a project that installs both.
function loadDriver(root) {
  for (const base of [root && join(root, 'package.json'), import.meta.url]) {
    if (!base) continue
    const require = createRequire(base)
    let resolved
    try {
      resolved = require.resolve('pg')
    } catch {
      continue
    }
    return require(resolved)
  }
  throw fail('cow:postgres needs the pg package. Install it in your site: npm install pg', 'COW_POSTGRES_DRIVER_MISSING')
}

const leaseStates = new WeakMap()

function createFacade(pool, signal) {
  const state = { closed: false, clients: new Set(), savepoints: 0 }

  const ensureActive = () => {
    if (state.closed) throw fail('This Postgres handle belongs to a request that has ended', 'COW_POSTGRES_REQUEST_ENDED')
    if (signal?.aborted) throw fail('The request was cancelled, so Cow runs no further queries', 'COW_REQUEST_CANCELLED')
  }

  const execute = async (target, sql, parameters) => {
    ensureActive()
    if (typeof sql !== 'string') throw new TypeError('SQL must be a string')
    if (parameters === undefined) return target.query(sql)
    return target.query(sql, Array.isArray(parameters) ? parameters : [parameters])
  }

  const handle = (target, client) => {
    const api = Object.freeze({
    async exec(sql) {
      await execute(target, sql)
    },
    async run(sql, parameters) {
      const result = await execute(target, sql, parameters)
      return { changes: result.rowCount ?? 0, rows: result.rows ?? [] }
    },
    async get(sql, parameters) {
      return (await execute(target, sql, parameters)).rows?.[0]
    },
    async all(sql, parameters) {
      return (await execute(target, sql, parameters)).rows ?? []
    },
    async query(sql, parameters) {
      return (await execute(target, sql, parameters)).rows ?? []
    },
    async transaction(callback, { isolation } = {}) {
      ensureActive()
      if (typeof callback !== 'function') throw new TypeError('transaction() requires a callback')
      if (client) {
        // Nested: a savepoint on the transaction's own connection.
        if (isolation !== undefined) throw new TypeError('A nested transaction cannot set its isolation level')
        const name = `cow_${state.savepoints++}`
        await client.query(`SAVEPOINT ${name}`)
        try {
          const result = await callback(handle(client, client))
          await client.query(`RELEASE SAVEPOINT ${name}`)
          return result
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => {})
          throw error
        }
      }
      let level
      if (isolation !== undefined) {
        level = ISOLATION_LEVELS.get(String(isolation).toLowerCase())
        if (!level) throw new TypeError(`Unknown isolation level: ${isolation}`)
      }
      const connection = await pool.connect()
      state.clients.add(connection)
      let broken = false
      try {
        await connection.query(level ? `BEGIN ISOLATION LEVEL ${level}` : 'BEGIN')
        const result = await callback(handle(connection, connection))
        ensureActive()
        await connection.query('COMMIT')
        return result
      } catch (error) {
        if (state.clients.has(connection)) {
          try {
            await connection.query('ROLLBACK')
          } catch {
            broken = true
          }
        }
        throw error
      } finally {
        // When the request ended first, release() already discarded the connection.
        if (state.clients.delete(connection)) connection.release(broken)
      }
    },
    // Runs each step once, in order, and records progress in cow_migrations.
    // An advisory lock serializes workers and other servers on one database.
    async migrate(steps) {
      if (!Array.isArray(steps) || !steps.every(step => typeof step === 'string' || typeof step === 'function')) {
        throw fail('migrate() takes an array of SQL strings or functions', 'COW_POSTGRES_MIGRATION_INVALID')
      }
      const applied = async q => (await q.get('SELECT coalesce(max(version), 0)::int AS version FROM cow_migrations')).version
      const check = version => {
        if (version > steps.length) {
          throw fail(`The database has ${version} migration steps applied, but this code lists ${steps.length}. Is this an older copy of the application?`, 'COW_POSTGRES_MIGRATION_AHEAD')
        }
        return version
      }
      try {
        if (check(await applied(api)) === steps.length) return steps.length
      } catch (error) {
        if (error?.code !== '42P01') throw error // undefined_table: nothing has run yet
      }
      return api.transaction(async tx => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('cow_migrations'))")
        await tx.exec('CREATE TABLE IF NOT EXISTS cow_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
        for (let index = check(await applied(tx)); index < steps.length; index++) {
          if (typeof steps[index] === 'string') await tx.exec(steps[index])
          else await steps[index](tx)
          await tx.run('INSERT INTO cow_migrations (version) VALUES ($1)', [index + 1])
        }
        return steps.length
      })
    },
    get inTransaction() {
      return client ? true : state.clients.size > 0
    }
    })
    return api
  }

  const facade = handle(pool, null)
  leaseStates.set(facade, state)
  return facade
}

const acquirePostgres = defineResource({
  name: 'postgres',

  key(options) {
    return JSON.stringify([options.connectionString, options.max, options.connectTimeout,
      options.idleTimeout, options.statementTimeout, options.ssl])
  },

  async open(options, { root } = {}) {
    const pg = loadDriver(root)
    const pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.max,
      connectionTimeoutMillis: options.connectTimeout,
      idleTimeoutMillis: options.idleTimeout,
      ...(options.statementTimeout ? { statement_timeout: options.statementTimeout } : {}),
      ...(options.ssl === null ? {} : { ssl: options.ssl })
    })
    // An idle connection that the server drops must not crash the worker.
    pool.on('error', () => {})
    return pool
  },

  acquire(pool, { signal }) {
    return createFacade(pool, signal)
  },

  release(facade) {
    const state = leaseStates.get(facade)
    if (!state || state.closed) return
    state.closed = true
    // A transaction the page never awaited: discard its connection, and Postgres
    // rolls the transaction back when the connection closes.
    for (const client of state.clients) client.release(true)
    state.clients.clear()
    leaseStates.delete(facade)
  },

  beforeResponse(facade) {
    if (leaseStates.get(facade)?.clients.size) {
      throw fail('Finish the Postgres transaction before ending the response. Await transaction() first.', 'COW_POSTGRES_RESPONSE_IN_TRANSACTION')
    }
  },

  async close(pool) {
    await pool.end()
  }
})

export async function postgres(connectionStringOrOptions, options = {}) {
  const normalized = normalizeOptions(connectionStringOrOptions, options)
  try {
    return await acquirePostgres(normalized)
  } catch (error) {
    // A missing driver is a setup mistake, so say so instead of a generic open failure.
    if (error?.cause?.code === 'COW_POSTGRES_DRIVER_MISSING') throw error.cause
    throw error
  }
}

export default postgres
