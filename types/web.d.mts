import type { CowRequest, CowResponse, FormValues } from './runtime.d.mts'
import type { SQLite } from './sqlite.d.mts'
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export class HttpError extends Error { constructor(status: number, message: string); status: number }
export function escapeHtml(value: unknown): string
/** Marks trusted HTML so `<?= ?>` prints it as-is instead of escaping it. */
export function raw(value: unknown): string
export function form(request: CowRequest): URLSearchParams
export function field(values: URLSearchParams | FormValues, name: string): string
export function cookies(request: CowRequest): Readonly<Record<string, string | undefined>>
export interface CookieOptions {
  path?: string
  domain?: string
  expires?: Date
  maxAge?: number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
}
export function setCookie(response: CowResponse, name: string, value: string, options?: CookieOptions): void
export function deleteCookie(response: CowResponse, name: string, options?: CookieOptions): void
export function secretMatches(actual: unknown, expected: unknown): boolean
export function hashPassword(password: string): Promise<string>
export function verifyPassword(password: string, encoded: string | null | undefined): Promise<boolean>
export interface SessionOptions extends Omit<CookieOptions, 'expires'> { name?: string }
export interface Session<Data = Record<string, JsonValue>> {
  readonly data: Data
  readonly csrfToken: string
  readonly expiresAt: number
  update(data: Data): void
  refresh(): Data
  touch(): void
  verify(values: URLSearchParams | FormValues): void
  replace(data: Data): Promise<void>
  destroy(): void
}
/** Data describes application-owned stored JSON; it is not runtime validation. */
export function session<Data = Record<string, JsonValue>>(database: SQLite, request: CowRequest, response: CowResponse, options?: SessionOptions): Promise<Session<Data>>
export function pruneSessions(database: SQLite, options?: { limit?: number }): number
