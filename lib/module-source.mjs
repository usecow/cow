import { readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import ts from './syntax.mjs'
import { compileCowModule } from './compiler.mjs'

// Node tolerates a UTF-8 BOM in package.json and JSON modules; Windows editors
// and PowerShell commonly write one, so JSON read from disk strips it too.
export const stripBom = source => source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source

// Shared by execution and the non-executing checker. Keep module format and
// transpilation policy here so `cow check` cannot invent a different language.
export function createModulePolicy() {
  const packages = new Map()
  function packageInfo(file) {
    let directory = dirname(file)
    const visited = []
    let info = null
    while (true) {
      if (packages.has(directory)) { info = packages.get(directory); break }
      visited.push(directory)
      try {
        info = { directory, manifest: JSON.parse(stripBom(readFileSync(resolve(directory, 'package.json'), 'utf8'))) }
        break
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    for (const path of visited) packages.set(path, info)
    return info
  }
  return {
    isNative(file) {
      const info = packageInfo(file)
      const entries = info?.manifest.cow?.native
      if (!Array.isArray(entries)) return false
      return entries.some(entry => {
        if (typeof entry !== 'string' || !entry.startsWith('./')) return false
        try { return realpathSync(resolve(info.directory, entry)) === file } catch { return false }
      })
    },
    format(file) {
      const extension = extname(file).toLowerCase()
      if (extension === '.json') return 'json'
      if (extension === '.cjs') return 'commonjs'
      if (extension === '.js' && packageInfo(file)?.manifest.type !== 'module') return 'commonjs'
      if (!['.cow', '.mjs', '.js', '.ts'].includes(extension)) throw Object.assign(new Error(`Unsupported Cow module extension: ${extension}`), { code: 'COW_MODULE_FORMAT_UNSUPPORTED' })
      return 'module'
    }
  }
}

export function prepareModuleSource(source, file, { sourceMap = false } = {}) {
  if (extname(file).toLowerCase() === '.cow') return compileCowModule(source, file)
  const typed = extname(file).toLowerCase() === '.ts'
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, typed ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  function fail(error) {
    const at = parsed.getLineAndCharacterOfPosition(error.start || 0)
    throw Object.assign(new SyntaxError(`${file}:${at.line + 1}:${at.character + 1}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`), {
      code: 'COW_MODULE_SYNTAX', filePath: file, line: at.line + 1, column: at.character + 1
    })
  }
  if (parsed.parseDiagnostics[0]) fail(parsed.parseDiagnostics[0])
  if (!typed) return { code: source }
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, sourceMap, verbatimModuleSyntax: true } })
  const error = result.diagnostics?.find(d => d.category === ts.DiagnosticCategory.Error)
  if (error) fail(error)
  return { code: result.outputText.replace(/\/\/# sourceMappingURL=.*(?:\r?\n)?$/, ''),
    sourceMap: sourceMap ? JSON.parse(result.sourceMapText) : undefined }
}
