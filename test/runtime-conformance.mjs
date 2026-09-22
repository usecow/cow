// Node orchestration; test processes use the explicitly selected runtime.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runtimeCommand } from '../lib/runtime-launcher.mjs'

const files = [
  'async-semantics', 'cow-helpers', 'cow-pages', 'compiler', 'lexer', 'csv',
  'import-compatibility', 'request-contract', 'resource-lifecycle', 'sqlite',
  'retention', 'runtime-bounds', 'embedding-lifecycle', 'streaming', 'uploads',
  'info', 'source-maps', 'host-compatibility', 'mininews', 'news', 'forum', 'http-contract',
  'standard-library', 'sessions', 'site-errors', 'request-metadata', 'web', 'safety'
].map(name => fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url)))
const runtime = process.argv[2]
if (!['bun', 'deno'].includes(runtime)) throw new Error('Use: node test/runtime-conformance.mjs bun|deno (npm test covers Node)')
const command = runtime === 'bun'
  ? runtimeCommand(runtime, fileURLToPath(new URL('./bun-conformance.mjs', import.meta.url)), files)
  : runtimeCommand(runtime, files[0], files.slice(1))
if (runtime === 'deno') command.args[0] = 'test'
const child = spawn(command.executable, command.args, { stdio: 'inherit', windowsHide: true })
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
