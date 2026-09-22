// Minimal sequential adapter for the shared node:test cases. Used ONLY by the
// standalone Bun conformance runner: bun test intercepts intentional unhandled
// rejections in Cow workers, unlike `bun cow.mjs`. Assertions remain unchanged.
export const cases = [], beforeHooks = [], afterHooks = []
export function test(name, options, fn) {
  if (typeof options === 'function') fn = options
  else if (options && Object.keys(options).length) throw new Error(`Unsupported standalone test options: ${name}`)
  cases.push({ name, fn })
}
export const before = fn => beforeHooks.push(fn)
export const after = fn => afterHooks.push(fn)
export default test
