// Host details stay outside the request VM. Cow syntax and module semantics do
// not depend on which executable runs the server.
export const runtimeMinimums = Object.freeze({ node: '22.16.0', bun: '1.4.2', deno: '2.9.6' })

export function hostRuntime() {
  const name = globalThis.Bun ? 'bun' : globalThis.Deno ? 'deno' : 'node'
  return {
    name,
    version: name === 'bun' ? Bun.version : name === 'deno' ? Deno.version.deno : process.versions.node,
    engine: name === 'bun' ? 'JavaScriptCore' : 'V8',
    // Do not advertise Node's worker heap bound on compatibility implementations.
    workerHeapLimit: name === 'node'
  }
}

export function assertHostSupported(host = hostRuntime()) {
  const minimum = runtimeMinimums[host.name]
  const actual = host.version.split(/[.-]/).slice(0, 3).map(Number)
  const required = minimum.split('.').map(Number)
  const comparison = actual.reduce((result, n, i) => result || Math.sign(n - required[i]), 0)
  if (comparison < 0) throw Object.assign(new Error(`Cow requires ${host.name} ${minimum} or newer; found ${host.version}. Select another runtime with --runtime.`), { code: 'COW_RUNTIME_VERSION' })
}

export function workerHostOptions(memoryLimitMb) {
  return hostRuntime().name === 'node' ? {
    execArgv: ['--no-warnings', '--experimental-vm-modules'],
    resourceLimits: { maxOldGenerationSizeMb: memoryLimitMb }
  } : {}
}
