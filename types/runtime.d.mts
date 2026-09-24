/// <reference path="./cow.d.mts" />
/** Types for Cow page bindings. These are not globals in imported helper modules. */
export type HeaderValue = string | string[] | undefined | null
export interface Bytes extends Uint8Array { toString(encoding?: string): string }
export type StreamChunk = string | ArrayBuffer | ArrayBufferView
export interface SiteError {
  readonly name: string; readonly message: string; readonly status: number
  readonly code?: string; readonly stack?: string
  readonly headers: Readonly<Record<string, string | string[]>>
  readonly cause?: SiteError; readonly errors?: readonly SiteError[]
}
export interface Upload {
  readonly name: string
  readonly type: string
  readonly size: number
  bytes(): Promise<Bytes>
  text(): Promise<string>
  /** Explicit absolute destination; refuses overwrite and consumes the upload. */
  save(destination: string): Promise<string>
}
export interface FormOptions { maxFiles?: number; maxFields?: number; maxFileSize?: number; maxFieldSize?: number }
export interface FormValues extends Iterable<[string, string | Upload]> {
  get(name: string): string | Upload | null
  getAll(name: string): (string | Upload)[]
  has(name: string): boolean
  entries(): IterableIterator<[string, string | Upload]>
  keys(): IterableIterator<string>
  values(): IterableIterator<string | Upload>
}
export interface CowRequest {
  id(): string
  url(): string
  method(): string
  address(): string | null
  scheme(): 'http' | 'https' | null
  host(): string | null
  headers(): Readonly<Record<string, HeaderValue>>
  header(name: string): HeaderValue
  params(): Readonly<Record<string, string>>
  get(name: string): string | undefined
  getAll(name: string): string[]
  body(): Bytes
  text(): string
  json(): unknown
  formData(options?: FormOptions): Promise<FormValues>
}
export interface CowResponse {
  readonly statusCode: number
  readonly phase: 'buffering' | 'committed' | 'finished'
  readonly headersSent: boolean
  readonly finished: boolean
  status(code: number): this
  setHeader(name: string, value: string | number | readonly string[]): this
  header(name: string, value: string | number | readonly string[]): this
  getHeader(name: string): string | string[] | undefined
  removeHeader(name: string): this
  type(value: string): this
  write(value?: unknown): this
  commit(): this
  /** Currently commits metadata only; it is not a streaming write. */
  flush(): Promise<void>
  /** Terminal output. Await it; HTTP streams with backpressure, embedded execution buffers unless given onStream. */
  stream(source: Iterable<StreamChunk> | AsyncIterable<StreamChunk>): Promise<never>
  /** Explicit absolute file path; defaults to application/octet-stream. Authorize access first. */
  sendFile(path: string): Promise<never>
  download(path: string, filename?: string): Promise<never>
  end(value?: unknown): never
  send(value?: unknown): never
  json(): this
  json(value: unknown): never
  redirect(location: string, status?: number): never
}
export interface CowContext {
  readonly requestId: string
  readonly signal: AbortSignal
  onCleanup(callback: () => void | Promise<void>): void
  defer(callback: () => void | Promise<void>): void
  track<T>(promise: PromiseLike<T>): Promise<T>
  /** Terminal, no-store diagnostic page. Omits environment, paths and request values. */
  info(options?: { format?: 'html' | 'json' }): never
}
export interface TemplateContext<Locals = Record<string, unknown>> {
  req: CowRequest
  res: CowResponse
  cow: CowContext
  locals: Locals
  /** Writes values exactly as given, without escaping. */
  echo(...values: unknown[]): void
  /** Escapes text for HTML. `<?= ?>` prints the result as-is, so it is escaped once. */
  h(value: unknown): string
  /** Marks trusted HTML so `<?= ?>` prints it as-is instead of escaping it. */
  raw(value: unknown): string
  die(): never
  include(path: string, locals?: Record<string, unknown>): Promise<void>
  __filename: string
  __dirname: string
}
