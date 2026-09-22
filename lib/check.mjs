import { createReadStream } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { SourceMap } from 'node:module'
import vm from 'node:vm'
import { parse } from 'acorn'
import { hostRuntime } from './host-runtime.mjs'
import { compileCowModule, compileTemplate } from './compiler.mjs'
import { createModulePolicy, prepareModuleSource } from './module-source.mjs'
import { originalOffset, position } from './source-map.mjs'
import { templateExtensions, templateFormat } from './template-format.mjs'

const extensions = new Set([...templateExtensions, '.mjs', '.js', '.cjs', '.ts'])
const ignoredDirectories = new Set(['node_modules', 'data', 'cache'])
const supported = file => extensions.has(extname(file).toLowerCase()) && !/\.d\.ts$/i.test(file)

async function readSource(file, size, limit) {
  const tooLarge = () => Object.assign(new Error(`Source exceeds ${limit} bytes (use --source-limit to change the limit)`), { code: 'COW_SOURCE_TOO_LARGE' })
  if (size > limit) throw tooLarge()
  const chunks = []
  let bytes = 0
  for await (const chunk of createReadStream(file, { highWaterMark: 65_536 })) {
    bytes += chunk.length
    if (bytes > limit) throw tooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, bytes).toString('utf8')
}

function nativeSyntax(code, kind) {
  if (hostRuntime().name !== 'node') {
    // These hosts have no Node-compatible --check command. Acorn supplies early
    // errors and precise positions; the host VM then confirms engine syntax.
    // Neither parser evaluates source, follows imports, or invokes site hooks.
    try {
      parse(code, { ecmaVersion: 'latest', sourceType: kind === 'module' ? 'module' : 'script',
        allowReturnOutsideFunction: kind === 'commonjs', locations: true })
    } catch (error) {
      if (!error.loc) throw error
      return { line: error.loc.line, column: error.loc.column + 1, message: error.message.replace(/ \(\d+:\d+\)$/, '') }
    }
    try {
      if (kind === 'module') new vm.SourceTextModule(code)
      else vm.compileFunction(code, ['exports', 'require', 'module', '__filename', '__dirname'])
    } catch (error) {
      throw Object.assign(new Error(`Host syntax parser: ${error.message}`), { code: 'COW_CHECK_PARSER' })
    }
    return null
  }
  // No files, loaders, preloads, coverage or compiler-cache output. The child
  // receives source on stdin and only parses it; it never loads its imports.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^NODE_|^FORCE_COLOR$/i.test(key)))
  env.NODE_DISABLE_COMPILE_CACHE = '1'
  // Node's spawn implementation forwards parent coverage even with an explicit
  // env, unless this key is present. Empty disables that inherited output.
  env.NODE_V8_COVERAGE = ''
  env.NO_COLOR = '1'
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '--check', `--input-type=${kind}`], {
      env, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe']
    })
    let stderr = '', failed
    const timer = setTimeout(() => {
      failed = Object.assign(new Error('Syntax parser exceeded its 10 second deadline'), { code: 'COW_CHECK_TIMEOUT' })
      child.kill()
    }, 10_000)
    child.once('error', error => { failed = error })
    // Syntax rejection can close stdin before all source bytes are accepted.
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') failed = error })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (stderr.length > 4_194_304) {
        failed = Object.assign(new Error('Syntax parser diagnostic exceeded its output limit'), { code: 'COW_CHECK_OUTPUT_LIMIT' })
        child.kill()
      }
    })
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer)
      if (failed) return reject(failed)
      if (exitCode === 0) return resolveResult(null)
      const location = /(?:^|\n)\[stdin\]:(\d+)\r?\n[^\n]*\n([^\n]*)/.exec(stderr)
      const message = location && /(?:^|\n)SyntaxError: ([^\r\n]*)/.exec(stderr.slice(location.index + location[0].length))
      if (!message || !location) return reject(Object.assign(new Error(`Syntax parser failed${signal ? ` (${signal})` : ''}: ${stderr.trim().slice(0, 2000)}`), { code: 'COW_CHECK_PARSER' }))
      const caret = location[2].indexOf('^')
      if (caret < 0 && message[1] === 'Unexpected end of input') {
        const lines = code.split(/\r\n|[\r\n\u2028\u2029]/)
        return resolveResult({ line: lines.length, column: lines.at(-1).length + 1, message: message[1] })
      }
      resolveResult({ line: Number(location[1]), column: caret < 0 ? 1 : caret + 1, message: message[1] })
    })
    child.stdin.end(code)
  })
}

function sourceLocation(error, sourceMap, template) {
  if (!sourceMap) return { line: error.line, column: error.column }
  const payload = template ? sourceMap.payload : sourceMap
  const entry = new SourceMap(payload).findEntry(error.line - 1, error.column - 1)
  if (entry.originalLine === undefined) return { line: 1, column: 1 }
  if (!template) return { line: entry.originalLine + 1, column: entry.originalColumn + 1 }
  const offset = (sourceMap.moduleLines[entry.originalLine] || 0) + entry.originalColumn
  return position(sourceMap.sourceLines, originalOffset(sourceMap.spans, offset))
}

export async function checkPath(target = '.', { sourceLimit = 1_048_576 } = {}) {
  if (!Number.isSafeInteger(sourceLimit) || sourceLimit < 1) throw new TypeError('sourceLimit must be a positive safe integer')
  const result = { target: resolve(target), checked: 0, skipped: 0, errors: [], exitCode: 0 }
  const policy = createModulePolicy()
  const report = (file, error, operational = false) => {
    const line = error.line, column = error.column
    const prefix = `${file}${line === undefined ? '' : `:${line}:${column}`}: `
    const message = error.message?.startsWith(prefix) ? error.message.slice(prefix.length) : error.message || String(error)
    result.errors.push({ file, ...(line === undefined ? {} : { line, column }), code: error.code || (operational ? 'COW_CHECK_INPUT' : 'COW_SYNTAX'), message })
    result.exitCode = Math.max(result.exitCode, operational ? 2 : 1)
  }
  async function visit(file, explicit = false) {
    let stat
    try {
      stat = await lstat(file)
      if (stat.isSymbolicLink()) {
        if (!explicit) { result.skipped++; return }
        return visit(await realpath(file), true)
      }
      if (stat.isDirectory()) {
        const entries = await readdir(file, { withFileTypes: true })
        entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        for (const entry of entries) {
          if (entry.name.startsWith('.') || (entry.isDirectory() && ignoredDirectories.has(entry.name))) { result.skipped++; continue }
          await visit(join(file, entry.name))
        }
        return
      }
      if (!stat.isFile() || !supported(file)) {
        if (explicit) throw new Error('Expected a .cow, .jsp, .tsp, .mjs, .js, .cjs or .ts source file (not a declaration file)')
        result.skipped++
        return
      }
    } catch (error) { report(file, error, true); return }

    result.checked++
    let source, kind
    const template = templateFormat(file)
    try {
      source = await readSource(file, stat.size, sourceLimit)
      kind = template ? 'module' : policy.format(file)
    } catch (error) { report(file, error, true); return }
    let compiled
    try {
      try {
        compiled = template ? compileTemplate(source, { filePath: file, language: template.language })
          : kind === 'module' ? prepareModuleSource(source, file, { sourceMap: true }) : { code: source }
      } catch (error) {
        // With no import graph to execute, a code-only Cow file may be a helper.
        // Keep page-only syntax (e.g. return) valid without guessing from its name.
        if (extname(file).toLowerCase() !== '.cow' || error.code !== 'COW_TEMPLATE_EXPORT') throw error
        compiled = compileCowModule(source, file)
      }
    } catch (error) { report(file, error); return }
    try {
      const failure = await nativeSyntax(compiled.code, kind)
      if (failure) report(file, { ...failure, ...sourceLocation(failure, compiled.sourceMap, template) })
    } catch (error) { report(file, error, true) }
  }
  // Match the runtime's canonical-path package scope, including an explicitly
  // selected file underneath a directory symlink. No recursive symlink following.
  try { await visit(await realpath(result.target), true) }
  catch (error) { report(result.target, error, true) }
  if (!result.checked && !result.errors.length) report(result.target, new Error('No supported source files found'), true)
  return result
}

export function printCheckResult(result, { json = false, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (json) { stdout.write(`${JSON.stringify(result, null, 2)}\n`); return }
  for (const error of result.errors) {
    const at = error.line === undefined ? error.file : `${error.file}:${error.line}:${error.column}`
    stderr.write(`${at}: ${error.message} [${error.code}]\n`)
  }
  stdout.write(`Checked ${result.checked} file${result.checked === 1 ? '' : 's'}: ${result.errors.length ? `${result.errors.length} error${result.errors.length === 1 ? '' : 's'}` : 'no syntax errors'}. Skipped ${result.skipped} entries.\n`)
}
