// Text CSV, not a spreadsheet evaluator. Cells always parse as strings.
const defaults = { delimiter: ',', maxLength: 16_777_216, maxRows: 100_000, maxColumns: 10_000, maxFieldLength: 1_048_576 }

function options(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid CSV options')
  for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown CSV option: ${key}`)
  const result = { ...defaults, ...input }
  if (typeof result.delimiter !== 'string' || result.delimiter.length !== 1 || /["\r\n\uFEFF]/.test(result.delimiter)) {
    throw new TypeError('CSV delimiter must be one character other than quote, newline or BOM')
  }
  for (const key of ['maxLength', 'maxRows', 'maxColumns', 'maxFieldLength']) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 1) throw new TypeError(`CSV ${key} must be a positive integer`)
  }
  return result
}

function limit(message) { throw Object.assign(new RangeError(message), { code: 'COW_CSV_LIMIT' }) }

export class CsvError extends SyntaxError {
  constructor(message, line, column) {
    super(`${message} at CSV line ${line}, column ${column}`)
    this.name = 'CsvError'
    this.code = 'COW_CSV_SYNTAX'
    this.line = line
    this.column = column
  }
}

export function parseCsv(text, input) {
  const settings = options(input)
  if (typeof text !== 'string') throw new TypeError('CSV input must be text; decode bytes explicitly')
  if (text.length > settings.maxLength) limit('CSV input exceeds maxLength')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows = []
  let row = [], field = '', quoted = false, closedQuote = false, pending = false, line = 1, column = 1
  const append = value => {
    if (field.length + value.length > settings.maxFieldLength) limit('CSV field exceeds maxFieldLength')
    field += value
  }
  const finishField = () => {
    if (row.length >= settings.maxColumns) limit('CSV row exceeds maxColumns')
    row.push(field); field = ''; closedQuote = false
  }
  const finishRow = () => {
    finishField()
    if (rows.length >= settings.maxRows) limit('CSV input exceeds maxRows')
    rows.push(row); row = []; pending = false
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    pending = true
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { append('"'); i++; column++ }
        else { quoted = false; closedQuote = true }
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && text[i + 1] === '\n') { append('\r\n'); i++ }
        else append(char)
        line++; column = 0
      } else append(char)
    } else if (char === settings.delimiter) finishField()
    else if (char === '\r' || char === '\n') {
      finishRow()
      if (char === '\r' && text[i + 1] === '\n') i++
      line++; column = 0
    } else if (closedQuote) throw new CsvError('Unexpected text after a closing quote', line, column)
    else if (char === '"') {
      if (field.length) throw new CsvError('Quote inside an unquoted field', line, column)
      quoted = true
    } else append(char)
    column++
  }
  if (quoted) throw new CsvError('Unterminated quoted field', line, column)
  if (pending) finishRow()
  return rows
}

export function stringifyCsv(rows, input) {
  const settings = options(input)
  if (!Array.isArray(rows)) throw new TypeError('CSV rows must be an array of arrays')
  if (rows.length > settings.maxRows) limit('CSV output exceeds maxRows')
  let output = ''
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) throw new TypeError('Each CSV row must be a nonempty array')
    if (row.length > settings.maxColumns) limit('CSV row exceeds maxColumns')
    for (let i = 0; i < row.length; i++) {
      const value = row[i]
      if (value !== null && !['string', 'number', 'boolean', 'bigint'].includes(typeof value)) throw new TypeError('CSV cells must be strings, numbers, booleans, bigint or null')
      const text = value === null ? '' : String(value)
      if (text.length > settings.maxFieldLength) limit('CSV field exceeds maxFieldLength')
      const encoded = text === '' || text.startsWith('\uFEFF') || text.includes(settings.delimiter) || /["\r\n]/.test(text)
        ? `"${text.replaceAll('"', '""')}"` : text
      const chunk = (i === 0 ? '' : settings.delimiter) + encoded
      if (output.length + chunk.length + 2 > settings.maxLength) limit('CSV output exceeds maxLength')
      output += chunk
    }
    output += '\r\n'
  }
  return output
}
