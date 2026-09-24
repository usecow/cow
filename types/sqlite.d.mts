export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlParameters = readonly SqlValue[] | Record<string, SqlValue> | SqlValue
export type SqlRow = Record<string, SqlValue>
export interface SQLiteOptions {
  filename?: string | URL
  path?: string | URL
  readOnly?: boolean
  foreignKeys?: boolean
  timeout?: number
  busyTimeout?: number
  readBigInts?: boolean
  returnArrays?: boolean
  allowBareNamedParameters?: boolean
  allowUnknownNamedParameters?: boolean
  doubleQuotedStringLiterals?: boolean
}
export interface SQLite {
  readonly inTransaction: boolean
  exec(sql: string): this
  run(sql: string, parameters?: SqlParameters): { changes: number | bigint; lastInsertRowid: number | bigint }
  get<Row = SqlRow>(sql: string, parameters?: SqlParameters): Row | undefined
  all<Row = SqlRow>(sql: string, parameters?: SqlParameters): Row[]
  query<Row = SqlRow>(sql: string, parameters?: SqlParameters): Row[]
  begin(mode?: 'deferred' | 'immediate' | 'exclusive'): this
  commit(): this
  rollback(): this
  transaction<T>(callback: (database: SQLite) => T | Promise<T>, options?: { mode?: 'deferred' | 'immediate' | 'exclusive' }): Promise<T>
  /** Runs each step once, in order, recorded in PRAGMA user_version. Resolves to the number of steps applied. */
  migrate(steps: ReadonlyArray<string | ((database: SQLite) => void | Promise<void>)>): Promise<number>
}
export class CowSQLiteError extends Error {
  constructor(message: string, code: string, cause?: unknown)
  code: string
  status: number
}
export function sqlite(filename: string | URL, options?: SQLiteOptions): Promise<SQLite>
export function sqlite(options: SQLiteOptions & ({ filename: string | URL } | { path: string | URL })): Promise<SQLite>
export const openSQLite: typeof sqlite
export default sqlite
