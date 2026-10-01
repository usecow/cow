import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire, isBuiltin } from 'node:module'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { createModulePolicy, prepareModuleSource, stripBom } from './module-source.mjs'

// Resolution may use Node; evaluation of ordinary code must never use its
// process-wide module cache. All maps below belong to exactly one request.
export function createRequestLoader({ context, sourceLimit, sourceModule, syntheticModule, nativeModule, nativeRequire, wrapNative, registerSourceMap = () => {} }) {
  const commonjs = new Map()
  const { isNative, format } = createModulePolicy()

  function readSource(file) {
    if (statSync(file).size > sourceLimit) throw Object.assign(new Error(`Module source exceeds ${sourceLimit} bytes: ${file}. Raise --source-limit, or keep large data in a file the page reads`), { code: 'COW_SOURCE_TOO_LARGE' })
    const source = readFileSync(file, 'utf8')
    if (Buffer.byteLength(source) > sourceLimit) throw Object.assign(new Error(`Module source exceeds ${sourceLimit} bytes: ${file}. Raise --source-limit, or keep large data in a file the page reads`), { code: 'COW_SOURCE_TOO_LARGE' })
    return source
  }

  function requireFrom(specifier, file) {
    if (isBuiltin(specifier)) return nativeRequire(specifier.startsWith('node:') ? specifier : `node:${specifier}`)
    const resolved = realpathSync(createRequire(pathToFileURL(file)).resolve(specifier))
    if (isNative(resolved)) throw Object.assign(new Error('Native Cow adapters must be imported with ESM import'), { code: 'COW_NATIVE_REQUIRE_UNSUPPORTED' })
    if (format(resolved) === 'module') throw Object.assign(new Error(`CommonJS require cannot load ESM; use import(): ${resolved}`), { code: 'ERR_REQUIRE_ESM' })
    return loadCommonJS(resolved).exports
  }

  function loadCommonJS(file) {
    if (commonjs.has(file)) {
      const cached = commonjs.get(file)
      if ('error' in cached) throw cached.error
      return cached.module
    }
    const module = vm.runInContext('({ exports: {}, loaded: false })', context)
    module.id = module.filename = file
    const entry = { module }
    commonjs.set(file, entry) // Cycles see partial exports, never another request.
    try {
      const source = readSource(file)
      if (format(file) === 'json') module.exports = vm.runInContext(`JSON.parse(${JSON.stringify(stripBom(source))})`, context)
      else {
        const require = specifier => requireFrom(specifier, file)
        require.resolve = specifier => createRequire(pathToFileURL(file)).resolve(specifier)
        const wrapper = vm.compileFunction(source.replace(/^#![^\n]*/, ''), ['exports', 'require', 'module', '__filename', '__dirname'], {
          parsingContext: context, filename: file,
          importModuleDynamically: async (specifier, _script, attributes) => {
            const module = await sourceModule.dynamicImport(specifier, pathToFileURL(file).href, attributes)
            return globalThis.Bun ? module.namespace : module
          }
        })
        wrapper.call(module.exports, module.exports, wrapNative(require, true), module, file, dirname(file))
      }
      module.loaded = true
      return module
    } catch (error) { entry.error = error; throw error }
  }

  return {
    async load(file, identifier) {
      if (isNative(file)) {
        if (new URL(identifier).search || new URL(identifier).hash) throw Object.assign(new Error('Native adapter entry points cannot have query strings or fragments'), { code: 'COW_NATIVE_IDENTITY' })
        return nativeModule(identifier)
      }
      const kind = format(file)
      if (kind === 'commonjs' || kind === 'json') {
        if (new URL(identifier).search || new URL(identifier).hash) throw Object.assign(new Error('CommonJS and JSON imports use file identity, without query strings or fragments'), { code: 'COW_MODULE_IDENTITY' })
        const value = loadCommonJS(file).exports
        return syntheticModule(identifier, kind === 'json' ? { default: value } : { ...value, default: value })
      }
      const { code, sourceMap } = prepareModuleSource(readSource(file), file, { sourceMap: true })
      if (sourceMap) registerSourceMap({ filePath: file, identifier, sourceMap: sourceMap.payload ? sourceMap : { payload: sourceMap } })
      return sourceModule(code, identifier)
    }
  }
}
