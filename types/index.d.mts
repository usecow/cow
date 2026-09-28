/// <reference path="./cow.d.mts" />
import type { HeaderValue, Bytes, SiteError } from './runtime.d.mts'
export type { CowRequest, CowResponse, CowContext, TemplateContext, Upload, FormValues, SiteError, StreamChunk } from './runtime.d.mts'
export interface RequestInput {
  id?: string; url?: string; method?: string; headers?: Record<string, HeaderValue>
  body?: string | ArrayBuffer | ArrayBufferView
  remoteAddress?: string | null; scheme?: 'http' | 'https' | null
}
export interface NormalizedRequest {
  readonly id: string; readonly url: string; readonly method: string
  readonly headers: Readonly<Record<string, HeaderValue>>; readonly body: Bytes
  readonly remoteAddress: string | null; readonly scheme: 'http' | 'https' | null; readonly host: string | null
}
export interface ExecutionResponse { status: number; headers: Record<string, string | string[]>; body: Uint8Array; streamed?: boolean; contentLength?: number; handledError?: SiteError; lifecycle: { phase: string; durationMs: number } }
export type StreamMessage = { type: 'start'; status: number; headers: Record<string, string | string[]>; contentLength?: number } | { type: 'chunk'; body: Uint8Array }
export interface ExecutionOptions { signal?: AbortSignal; onStream?: (message: StreamMessage) => void | Promise<void> }
export type DispatchResult = { kind: 'response'; response: ExecutionResponse } | { kind: 'file'; filePath: string }
export interface Address { address: string; family: string; port: number; url: string }
export interface CowAppOptions {
  rootDir?: string; host?: string; port?: number; workers?: number; timeout?: number
  maxQueue?: number; queueTimeout?: number; maxRequestsPerWorker?: number; memoryLimitMb?: number
  shutdownTimeout?: number; bodyLimit?: number; outputLimit?: number; bufferLimit?: number; bodyTimeout?: number
  stallTimeout?: number
  startupTimeout?: number; restartDelay?: number; restartMaxDelay?: number; restartLimit?: number
  cacheEntries?: number; cacheBytes?: number; resourceLimit?: number; adapterLimit?: number; namespaceLimit?: number
  sourceLimit?: number; compileTimeout?: number; compileMaxPending?: number; compiledBufferLimit?: number
  cache?: boolean; mode?: 'development' | 'production'; healthPath?: string | false; statusPath?: string | false
  logger?: { error?(entry: unknown): unknown }
}
export class CowApp {
  constructor(options?: CowAppOptions)
  runtime: WorkerPool | null
  compilerRuntime: WorkerPool | null
  dispatcher: Dispatcher | null
  server: CowServer | null
  initialize(): Promise<this>
  start(): Promise<Address>
  address(): Address | null
  execute(request: RequestInput, options?: ExecutionOptions): Promise<DispatchResult>
  status(): Record<string, unknown>
  close(): Promise<void>
}
export function startCow(options?: CowAppOptions): Promise<CowApp>
export function normalizeRequest(input?: RequestInput): NormalizedRequest
export class RuntimeError extends Error { constructor(message: string, details?: Record<string, unknown>); status?: number; code?: string; errors?: RuntimeError[] }
export class CowCompileError extends Error { constructor(message: string, filePath: string, line?: number, column?: number); filePath: string; line?: number; column?: number }
export class RouteError extends Error { constructor(status: number, message: string); status: number }
export interface CompileOptions { filePath: string; language?: 'js' | 'ts' }
export interface CompiledTemplate extends CompileOptions { code: string; identifier: string; estimatedBytes?: number; sourceMap?: unknown }
export interface CompilerOptions { cache?: boolean; maxCacheEntries?: number; maxCacheBytes?: number; sourceLimit?: number; maxPending?: number }
export function compileSource(source: string, options: CompileOptions): string
export function tokenize(source: string, language: 'js' | 'ts', filePath?: string): { type: 'text' | 'code' | 'echo'; value: string; readonly start: number }[]
export class Compiler {
  constructor(options?: CompilerOptions)
  compile(filePath: string, options?: { signal?: AbortSignal }): Promise<CompiledTemplate>
  clear(): void
  status(): Record<string, number>
}
export class Router {
  constructor(rootDir: string)
  resolve(url: string): Promise<{ kind: 'static' | 'template'; filePath: string }>
  publicPath(filePath: string, staticFile?: boolean): Promise<string>
}
export class WorkerPool {
  constructor(options?: Omit<CowAppOptions, 'workers'> & { size?: number; compilerLimits?: CompilerOptions })
  start(): Promise<void>
  run(template: CompiledTemplate, request: NormalizedRequest, options?: ExecutionOptions): Promise<ExecutionResponse>
  status(): Record<string, unknown> & { workersSpawned: number }
  close(options?: { deadline?: number }): Promise<void>
}
export class Dispatcher {
  constructor(options: { rootDir: string; runtime: WorkerPool; compiler?: Compiler; compilerRuntime?: WorkerPool; cache?: boolean; bodyLimit?: number; bufferLimit?: number; compiledBufferLimit?: number })
  compiler: Compiler
  dispatch(input: RequestInput, options?: ExecutionOptions): Promise<DispatchResult>
  status(): Record<string, unknown>
}
export class CowServer {
  constructor(options: CowAppOptions & { dispatcher: Dispatcher })
  start(): Promise<Address>
  address(): Address | null
  status(): Record<string, unknown>
  close(options?: { deadline?: number }): Promise<void>
}
