export interface CsvOptions {
  delimiter?: string
  maxLength?: number
  maxRows?: number
  maxColumns?: number
  maxFieldLength?: number
}
export class CsvError extends SyntaxError {
  constructor(message: string, line: number, column: number)
  readonly code: 'COW_CSV_SYNTAX'
  readonly line: number
  readonly column: number
}
export function parseCsv(text: string, options?: CsvOptions): string[][]
export function stringifyCsv(rows: readonly (readonly (string | number | boolean | bigint | null)[])[], options?: CsvOptions): string
