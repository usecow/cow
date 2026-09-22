import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { assertHostSupported, hostRuntime, workerHostOptions } from '../lib/host-runtime.mjs'
import { runtimeCommand } from '../lib/runtime-launcher.mjs'

test('runtime commands preserve paths/arguments and select a real host without a shell', () => {
  const args = ['a site & echo no', '--port', '0']
  for (const runtime of ['node', 'bun', 'nub', 'deno']) {
    const result = runtimeCommand(runtime, 'Cow path/entry.mjs', args, { [`COW_${runtime.toUpperCase()}`]: process.execPath })
    assert.equal(result.executable, process.execPath)
    assert.deepEqual(result.args.slice(-4), ['Cow path/entry.mjs', ...args])
    if (runtime === 'deno') assert.deepEqual(result.args.slice(0, 5), ['run', '--allow-all', '--no-check', '--no-config', '--node-modules-dir=manual'])
    if (runtime === 'nub') assert.equal(result.args[0], '--node')
  }
  assert.throws(() => runtimeCommand('missing', 'x', []), /Unknown Cow runtime/)
  assert.throws(() => runtimeCommand('bun', 'x', [], { COW_BUN: join(tmpdir(), 'cow-no-such-executable-729174.exe') }), { code: 'COW_RUNTIME_NOT_FOUND' })
})

test('runtime version gates and advertised worker bounds follow the actual engine', () => {
  for (const [name, version] of [['node', '22.16.0'], ['node', '24.0.0'], ['bun', '1.4.2'], ['deno', '2.9.6']]) assert.doesNotThrow(() => assertHostSupported({ name, version }))
  for (const [name, version] of [['node', '22.15.0'], ['bun', '1.3.10'], ['deno', '2.0.0']]) assert.throws(() => assertHostSupported({ name, version }), { code: 'COW_RUNTIME_VERSION' })
  assert.equal(!!workerHostOptions(256).resourceLimits, hostRuntime().workerHeapLimit)
})

test('CLI runtime selection preserves checker exit codes and missing-runtime errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cow-runtime-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'syntax.cow')
  await writeFile(file, '<?js const broken = ;')
  const exec = promisify(execFile), cli = new URL('../bin/cow.mjs', import.meta.url)
  const { fileURLToPath } = await import('node:url')
  await assert.rejects(exec(process.execPath, [fileURLToPath(cli), 'check', file, '--runtime', 'node']), e => e.code === 1 && e.stderr.includes('syntax.cow'))
  await assert.rejects(exec(process.execPath, [fileURLToPath(cli), '--runtime', 'bun', 'check', file], {
    env: { ...process.env, COW_RUNTIME_CHILD: '', COW_BUN: join(root, 'missing.exe') }
  }), e => e.code === 2 && e.stderr.includes('Cannot find'))
})
