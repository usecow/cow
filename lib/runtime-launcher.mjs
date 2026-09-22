import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, extname, isAbsolute, resolve } from 'node:path'
import { hostRuntime } from './host-runtime.mjs'

export const runtimeNames = Object.freeze(['node', 'bun', 'nub', 'deno'])

function findExecutable(command, env) {
  const directories = isAbsolute(command) || /[/\\]/.test(command) ? [''] : (env.PATH || env.Path || '').split(delimiter)
  const suffixes = process.platform === 'win32' && !extname(command) ? ['.exe', '.cmd', ''] : ['']
  for (const directory of directories) for (const suffix of suffixes) {
    const candidate = resolve(directory, command + suffix)
    if (existsSync(candidate)) return candidate
  }
  throw Object.assign(new Error(`Cannot find ${command}. Install the runtime and put it on PATH, or set COW_NODE, COW_BUN, COW_NUB or COW_DENO to its executable.`), { code: 'COW_RUNTIME_NOT_FOUND' })
}

function executableCommand(command, env) {
  const executable = findExecutable(command, env)
  if (process.platform !== 'win32' || extname(executable).toLowerCase() !== '.cmd') return [executable, []]
  // npm installs .cmd shims on Windows. Resolve their quoted executable/script
  // target, never feed user directory names or CLI arguments through cmd.exe.
  const shim = readFileSync(executable, 'utf8')
  const targets = [...shim.matchAll(/"%dp0%[\\/]([^"\r\n]+)"/g)].map(match => resolve(dirname(executable), match[1]))
  const binary = targets.find(target => /\.exe$/i.test(target) && !/[\\/]node\.exe$/i.test(target) && existsSync(target))
  if (binary) return [binary, []]
  const script = targets.find(target => /[\\/]@nubjs[\\/]nub[\\/]bin[\\/]nub$/.test(target) && existsSync(target))
  if (script) return [hostRuntime().name === 'node' ? process.execPath : findExecutable('node', env), [script]]
  throw Object.assign(new Error(`Cannot safely launch the wrapper ${executable}. Set the matching COW_NODE, COW_BUN, COW_NUB or COW_DENO variable to the runtime's .exe file.`), { code: 'COW_RUNTIME_WRAPPER' })
}

export function runtimeCommand(runtime, entry, args, env = process.env) {
  if (!runtimeNames.includes(runtime)) throw new TypeError(`Unknown Cow runtime: ${runtime}`)
  const [executable, prefix] = executableCommand(env[`COW_${runtime.toUpperCase()}`] || runtime, env)
  const flags = runtime === 'deno' ? ['run', '--allow-all', '--no-check', '--no-config', '--node-modules-dir=manual']
    : runtime === 'nub' ? ['--node'] : []
  return { executable, args: [...prefix, ...flags, entry, ...args] }
}

// Returns true when a child handled the action; the original process only
// forwards signals/exit status. No site files or configuration are changed.
export async function relaunchRuntime(runtime, entry, args) {
  if (!runtime) return false
  const current = hostRuntime().name
  if (process.env.COW_RUNTIME_CHILD === runtime) {
    if ((runtime === 'nub' ? 'node' : runtime) !== current) throw new Error(`Selected ${runtime}, but its executable started ${current}`)
    return false
  }
  const override = process.env[`COW_${runtime.toUpperCase()}`]
  if (runtime === current && (!override || resolve(override) === process.execPath)) return false
  const command = runtimeCommand(runtime, entry, args)
  const child = spawn(command.executable, command.args, {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, COW_RUNTIME_CHILD: runtime }
  })
  const stop = signal => { if (child.exitCode === null) child.kill(signal) }
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    process.exitCode = await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => done(code ?? (signal === 'SIGINT' ? 130 : 143)))
    })
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
  return true
}
