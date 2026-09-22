import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from './syntax.mjs'
import { MappedText, lineStarts, originalOffset, position } from './source-map.mjs'
import { templateFormat } from './template-format.mjs'
import { lexTemplate } from './lexer.mjs'

export class CowCompileError extends Error {
  constructor(message, filePath, line = undefined, column = undefined) {
    const position = line === undefined ? '' : `:${line}:${column}`
    super(`${filePath}${position}: ${message}`)
    this.name = 'CowCompileError'
    this.filePath = filePath
    this.line = line
    this.column = column
  }
}

// Windows editors often save a UTF-8 BOM; it is an encoding artifact, never
// response output or code. Strip it before any offsets are computed.
const stripBom = source => source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source

export function tokenize(source, language, filePath = '<template>', { codeOnly = false } = {}) {
  source = stripBom(source)
  if (!['js', 'ts'].includes(language)) throw new CowCompileError(`Unsupported language ${language}`, filePath)
  const tags = templateFormat(filePath)?.tags.length === 2 ? ['<?js', '<?ts'] : [`<?${language}`]
  const fail = (message, offset) => {
    const at = position(lineStarts(source), offset)
    throw new CowCompileError(message, filePath, at.line, at.column)
  }
  return lexTemplate(source, { language, tags, fail, codeOnly })
}

function formatDiagnostic(diagnostic, filePath, mapped, sourceLines) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || diagnostic.start === undefined) {
    return new CowCompileError(message, filePath)
  }

  const at = position(sourceLines, originalOffset(mapped.spans, diagnostic.start))
  return new CowCompileError(message, filePath, at.line, at.column)
}

function buildModuleSource(tokens, language, filePath, sourceLines) {
  const combined = new MappedText()

  for (const token of tokens) {
    if (token.type === 'text') {
      combined.append(`echo(${JSON.stringify(token.value)});`, token.start)
    } else if (token.type === 'echo') {
      // PHP habit: <?= x; ?> is fine. Trailing comments force the newline
      // before the close, and null/undefined print as nothing, not "undefined".
      const expression = token.value.replace(/[;\s]+$/, '')
      if (!expression) {
        const at = position(sourceLines, token.start)
        throw new CowCompileError('Echo block is empty; write an expression such as <?= title ?>', filePath, at.line, at.column)
      }
      combined.append('echo(String((', token.start)
      combined.append(expression, token.start, true)
      combined.append('\n) ?? ""));', token.start + token.value.length)
    } else {
      combined.append(token.value, token.start, true)
    }
    combined.append('\n', token.start + token.value.length)
  }

  const kind = language === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sourceFile = ts.createSourceFile(filePath, combined.text, ts.ScriptTarget.Latest, true, kind)

  if (sourceFile.parseDiagnostics.length) {
    throw formatDiagnostic(sourceFile.parseDiagnostics[0], filePath, combined, sourceLines)
  }

  const moduleSource = new MappedText()
  const body = []

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      moduleSource.copy(combined, statement.pos, statement.end)
      moduleSource.append('\n')
      continue
    }

    if (ts.isExportDeclaration(statement) || ts.isExportAssignment(statement) ||
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      const at = position(sourceLines, originalOffset(combined.spans, statement.getStart(sourceFile)))
      throw Object.assign(new CowCompileError('Templates cannot declare exports; import a code-only .cow helper instead', filePath, at.line, at.column), { code: 'COW_TEMPLATE_EXPORT' })
    }

    body.push(statement)
  }

  moduleSource.append('export default async function __cowRender(__cow) {\n' +
    'const { req, res, cow, echo, die, h, include, locals, __filename, __dirname, __req, __res } = __cow;\n')
  for (const statement of body) {
    moduleSource.copy(combined, statement.pos, statement.end)
    moduleSource.append('\n')
  }
  moduleSource.append('}\n')
  return moduleSource
}

export function compileTemplate(source, { filePath, language = templateFormat(filePath)?.language }) {
  source = stripBom(source)
  const sourceLines = lineStarts(source)
  const tokens = tokenize(source, language, filePath)
  const moduleSource = buildModuleSource(tokens, language, filePath, sourceLines)
  const transpiled = ts.transpileModule(moduleSource.text, {
    fileName: `${filePath}.${language}`,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: language === 'js',
      sourceMap: true,
      inlineSourceMap: false,
      esModuleInterop: true,
      // Imports run for their side effects even when unused; only explicit
      // `import type` is erased. Never silently drop an author's import.
      verbatimModuleSyntax: true
    }
  })

  const error = transpiled.diagnostics?.find((diagnostic) =>
    diagnostic.category === ts.DiagnosticCategory.Error
  )
  if (error) throw formatDiagnostic(error, filePath, moduleSource, sourceLines)

  return {
    code: transpiled.outputText.replace(/\/\/# sourceMappingURL=.*(?:\r?\n)?$/, ''),
    sourceMap: { payload: JSON.parse(transpiled.sourceMapText), moduleLines: lineStarts(moduleSource.text), spans: moduleSource.spans, sourceLines }
  }
}

export function compileSource(source, options) {
  return compileTemplate(source, options).code
}

// Imports use the same Cow tags and lexical rules as pages, but evaluate as
// ordinary request-local ESM. Whitespace around code tags is not response output.
// HTML/echo fragments belong in include(), never silently discarded by import.
export function compileCowModule(source, filePath) {
  source = stripBom(source)
  const sourceLines = lineStarts(source)
  const mapped = new MappedText()
  for (const token of tokenize(source, 'ts', filePath, { codeOnly: true })) {
    if (token.type === 'code') {
      mapped.append(token.value, token.start, true)
      mapped.append('\n', token.start + token.value.length)
    } else if (token.type === 'echo' || token.value.trim()) {
      const at = position(sourceLines, token.start)
      throw Object.assign(new CowCompileError('Imported .cow helpers must contain only code tags; use include() for HTML or echo blocks', filePath, at.line, at.column), { code: 'COW_MODULE_OUTPUT' })
    }
  }
  const parsed = ts.createSourceFile(filePath, mapped.text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  if (parsed.parseDiagnostics[0]) throw formatDiagnostic(parsed.parseDiagnostics[0], filePath, mapped, sourceLines)
  const result = ts.transpileModule(mapped.text, { fileName: `${filePath}.ts`, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, sourceMap: true, verbatimModuleSyntax: true } })
  const error = result.diagnostics?.find(d => d.category === ts.DiagnosticCategory.Error)
  if (error) throw formatDiagnostic(error, filePath, mapped, sourceLines)
  return { code: result.outputText.replace(/\/\/# sourceMappingURL=.*(?:\r?\n)?$/, ''),
    sourceMap: { payload: JSON.parse(result.sourceMapText), moduleLines: lineStarts(mapped.text), spans: mapped.spans, sourceLines } }
}

export class Compiler {
  constructor({ cache = true, maxCacheEntries = 256, maxCacheBytes = 16_777_216,
    sourceLimit = 1_048_576, maxPending = 8, transform = compileTemplate } = {}) {
    for (const [name, value, minimum] of [['maxCacheEntries', maxCacheEntries, 0],
      ['maxCacheBytes', maxCacheBytes, 0], ['sourceLimit', sourceLimit, 1], ['maxPending', maxPending, 1]]) {
      if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`Invalid ${name}: ${value}`)
    }
    this.cacheEnabled = cache
    this.cache = new Map()
    this.maxCacheEntries = maxCacheEntries
    this.maxCacheBytes = maxCacheBytes
    this.sourceLimit = sourceLimit
    this.maxPending = maxPending
    this.transform = transform
    this.cacheBytes = 0
    this.pending = 0
    this.generation = 0
    this.metrics = { hits: 0, misses: 0, evictions: 0, oversizedEntries: 0 }
  }

  async compile(filePath, { signal } = {}) {
    signal?.throwIfAborted()
    const definition = templateFormat(filePath)
    if (!definition) throw new CowCompileError('Expected a .cow, .jsp or .tsp template', filePath)

    const fileStat = await stat(filePath)
    const cached = this.cache.get(filePath)
    if (
      this.cacheEnabled &&
      cached &&
      cached.mtimeMs === fileStat.mtimeMs &&
      cached.size === fileStat.size
    ) {
      this.metrics.hits++
      this.cache.delete(filePath)
      this.cache.set(filePath, cached)
      return cached.result
    }

    if (fileStat.size > this.sourceLimit) throw this.#sourceError(filePath)
    if (this.pending >= this.maxPending) {
      throw Object.assign(new Error('Cow cold compilation capacity is full'), { status: 503, code: 'COW_COMPILE_BUSY' })
    }
    this.pending++
    this.metrics.misses++
    const generation = this.generation
    try {
      // Stream even after stat: a file growing during a read must not bypass the
      // source limit. At most one extra stream chunk is observed before rejection.
      const chunks = []
      let length = 0
      for await (const chunk of createReadStream(filePath, { signal, highWaterMark: 65_536 })) {
        length += chunk.length
        if (length > this.sourceLimit) throw this.#sourceError(filePath)
        chunks.push(chunk)
      }
      signal?.throwIfAborted()
      const source = Buffer.concat(chunks, length).toString('utf8')
      const { code, sourceMap } = await this.transform(source, { filePath, language: definition.language }, { signal })
      signal?.throwIfAborted()
      const hash = createHash('sha256').update(code).digest('hex').slice(0, 16)
      const identifier = pathToFileURL(filePath)
      identifier.searchParams.set('cow', `${fileStat.mtimeMs}-${fileStat.size}-${hash}`)

      const result = {
        code,
        sourceMap,
        filePath,
        language: definition.language,
        identifier: identifier.href
      }

      // Account independently of caching: queued requests can retain an evicted
      // compiled template, so their admission budget must include this estimate.
      result.estimatedBytes = 512 + 2 * (code.length + result.identifier.length + filePath.length +
          (sourceMap?.payload.mappings?.length || 0)) +
          128 * (sourceMap?.spans.length || 0) +
          8 * ((sourceMap?.moduleLines.length || 0) + (sourceMap?.sourceLines.length || 0)) +
          (sourceMap?.payload.names || []).reduce((sum, name) => sum + 64 + name.length * 2, 0)
      if (this.cacheEnabled && generation === this.generation) {
        this.#delete(filePath)
        const bytes = result.estimatedBytes
        if (bytes <= this.maxCacheBytes && this.maxCacheEntries > 0) {
          while (this.cache.size >= this.maxCacheEntries || this.cacheBytes + bytes > this.maxCacheBytes) {
            this.#delete(this.cache.keys().next().value)
            this.metrics.evictions++
          }
          this.cache.set(filePath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, result, bytes })
          this.cacheBytes += bytes
        } else this.metrics.oversizedEntries++
      }

      return result
    } finally { this.pending-- }
  }

  #sourceError(filePath) {
    return Object.assign(new CowCompileError(`Template exceeds ${this.sourceLimit} source bytes`, filePath), {
      status: 500, code: 'COW_SOURCE_TOO_LARGE'
    })
  }

  #delete(filePath) {
    const entry = this.cache.get(filePath)
    if (!entry) return
    this.cacheBytes -= entry.bytes
    this.cache.delete(filePath)
  }

  status() {
    return { entries: this.cache.size, estimatedBytes: this.cacheBytes, maxEntries: this.maxCacheEntries,
      maxBytes: this.maxCacheBytes, sourceLimit: this.sourceLimit, pending: this.pending,
      maxPending: this.maxPending, ...this.metrics }
  }

  clear() {
    this.generation++
    this.cache.clear()
    this.cacheBytes = 0
  }
}
