export type PostgresParameters = readonly unknown[] | unknown
export type PostgresRow = Record<string, any>
export interface PostgresOptions {
  /** A postgres:// connection string. `url` is an alias. */
  connectionString?: string
  url?: string
  /** Connections in each worker's pool. Default 5. */
  max?: number
  /** Milliseconds to wait for a connection. Default 10000. */
  connectTimeout?: number
  /** Milliseconds before an idle connection closes. Default 30000. */
  idleTimeout?: number
  /** Server-side statement timeout in milliseconds. Default 0 (none). */
  statementTimeout?: number
  /** Passed to pg's ssl option. */
  ssl?: boolean | Record<string, unknown> | null
}
export interface Postgres {
  readonly inTransaction: boolean
  exec(sql: string): Promise<void>
  run(sql: string, parameters?: PostgresParameters): Promise<{ changes: number; rows: PostgresRow[] }>
  get<Row = PostgresRow>(sql: string, parameters?: PostgresParameters): Promise<Row | undefined>
  all<Row = PostgresRow>(sql: string, parameters?: PostgresParameters): Promise<Row[]>
  query<Row = PostgresRow>(sql: string, parameters?: PostgresParameters): Promise<Row[]>
  transaction<T>(callback: (tx: Postgres) => T | Promise<T>, options?: { isolation?: 'read committed' | 'repeatable read' | 'serializable' }): Promise<T>
  /** Runs each step once, in order, and records it in the cow_migrations table. Resolves to the steps' count, which is now the database's version. */
  migrate(steps: ReadonlyArray<string | ((tx: Postgres) => void | Promise<void>)>): Promise<number>
}
export class CowPostgresError extends Error {
  constructor(message: string, code: string, cause?: unknown)
  code: string
  status: number
}
export function postgres(connectionString: string | URL, options?: Omit<PostgresOptions, 'connectionString' | 'url'>): Promise<Postgres>
export function postgres(options: PostgresOptions): Promise<Postgres>
export default postgres
