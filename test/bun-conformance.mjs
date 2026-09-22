import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cases, beforeHooks, afterHooks } from './standalone-test-api.mjs'

if (!globalThis.Bun) throw new Error('Run this harness with bun, not bun test or Node')
const files = process.argv.slice(2).map(file => resolve(file))
if (!files.length) throw new Error('Supply explicit test/*.test.mjs files')
const api = new URL('./standalone-test-api.mjs', import.meta.url).href
Bun.plugin({ name: 'cow-standalone-test-import', setup(build) {
  build.onLoad({ filter: /\.test\.mjs$/ }, async ({ path }) => {
    if (!files.includes(resolve(path))) return undefined
    const source = await readFile(path, 'utf8')
    return { loader: 'js', contents: source.replace(/from (['"])node:test\1/g, `from ${JSON.stringify(api)}`) }
  })
} })

let passed = 0, failed = 0
for (const file of files) {
  cases.length = beforeHooks.length = afterHooks.length = 0
  await import(pathToFileURL(file).href)
  try {
    for (const hook of beforeHooks) await hook()
    for (const { name, fn } of cases) {
      const cleanup = [], restores = []
      let failure
      try {
        await fn({ after: hook => cleanup.push(hook), mock: { method(object, key, replacement) {
          const descriptor = Object.getOwnPropertyDescriptor(object, key)
          object[key] = replacement
          restores.push(() => Object.defineProperty(object, key, descriptor))
        } } })
      } catch (error) { failure = error }
      finally {
        // Example fixtures inspect their DB with host node:sqlite too. Those
        // non-Cow handles need the same Bun #40001 finalization workaround.
        await new Promise(resolve => setImmediate(resolve))
        Bun.gc(true)
        for (const hook of cleanup) try { await hook() } catch (error) { failure ||= error }
        for (const restore of restores.reverse()) restore()
      }
      if (failure) { failed++; console.error(`FAIL ${name}`, failure) }
      else { passed++; console.log(`PASS ${name}`) }
    }
  } finally { for (const hook of afterHooks) try { await hook() } catch (error) { failed++; console.error('FAIL suite cleanup', error) } }
}
console.log(`Bun ${Bun.version}: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
