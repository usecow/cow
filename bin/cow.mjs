#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Command, Option } from 'commander'
import { relaunchRuntime, runtimeNames } from '../lib/runtime-launcher.mjs'
import { assertHostSupported, hostRuntime } from '../lib/host-runtime.mjs'

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
const packageInfo = JSON.parse(await readFile(packagePath, 'utf8'))

const program = new Command()
program
  .name('cow')
  .description('Cow, a web runtime for JavaScript and TypeScript pages, fresh on every request')
  .version(packageInfo.version)
  .addOption(new Option('--runtime <name>', 'JavaScript runtime (same Cow site files)').choices(runtimeNames).env('COW_RUNTIME'))
  .argument('[directory]', 'Cow application directory (defaults to current directory)', '.')
  .option('-d, --dir <directory>', 'Cow application directory (overrides the positional argument)')
  .option('--host <host>', 'host to listen on', '127.0.0.1')
  .addOption(new Option('-p, --port <port>', 'port to listen on').default('8000').argParser(Number))
  .addOption(new Option('-w, --workers <count>', 'runtime worker count').argParser(Number))
  .addOption(new Option('--timeout <milliseconds>', 'script execution timeout').default('10000').argParser(Number))
  .addOption(new Option('--max-queue <count>', 'maximum queued requests').default('1024').argParser(Number))
  .addOption(new Option('--queue-timeout <milliseconds>', 'maximum wait for an execution worker').default('10000').argParser(Number))
  .addOption(new Option('--max-requests <count>', 'requests before recycling a worker (0 disables)').default('1000').argParser(Number))
  .addOption(new Option('--memory-limit <megabytes>', 'Node/Nub old-generation memory limit per worker (default: 256)').argParser(Number))
  .addOption(new Option('--shutdown-timeout <milliseconds>', 'total HTTP drain and worker shutdown budget').default('5000').argParser(Number))
  .addOption(new Option('--body-limit <bytes>', 'maximum request body size').default('1048576').argParser(Number))
  .addOption(new Option('--body-timeout <milliseconds>', 'total request body read deadline').default('10000').argParser(Number))
  .addOption(new Option('--stall-timeout <milliseconds>', 'close a request that writes nothing for this long').default('120000').argParser(Number))
  .addOption(new Option('--output-limit <bytes>', 'maximum buffered template response').default('8388608').argParser(Number))
  .addOption(new Option('--buffer-limit <bytes>', 'aggregate admitted HTTP input/output buffer budget').default('16777216').argParser(Number))
  .addOption(new Option('--startup-timeout <milliseconds>', 'worker readiness deadline').default('10000').argParser(Number))
  .addOption(new Option('--restart-delay <milliseconds>', 'initial worker replacement delay').default('100').argParser(Number))
  .addOption(new Option('--restart-max-delay <milliseconds>', 'maximum worker replacement delay').default('5000').argParser(Number))
  .addOption(new Option('--restart-limit <count>', 'consecutive worker recovery retries before failure').default('5').argParser(Number))
  .addOption(new Option('--cache-entries <count>', 'maximum entries per compiler cache').default('256').argParser(Number))
  .addOption(new Option('--cache-bytes <bytes>', 'estimated retained bytes per compiler cache').default('16777216').argParser(Number))
  .addOption(new Option('--resource-limit <count>', 'persistent resource instances per execution worker').default('64').argParser(Number))
  .addOption(new Option('--adapter-limit <count>', 'resource adapter registrations per worker').default('128').argParser(Number))
  .addOption(new Option('--namespace-limit <count>', 'direct external module roots before worker recycling').default('256').argParser(Number))
  .addOption(new Option('--source-limit <bytes>', 'maximum source bytes per page, include or imported module').default('1048576').argParser(Number))
  .addOption(new Option('--compile-timeout <milliseconds>', 'cold compilation execution deadline').default('5000').argParser(Number))
  .addOption(new Option('--compile-max-pending <count>', 'maximum cold compiles including reads and queueing').default('8').argParser(Number))
  .addOption(new Option('--compiled-buffer-limit <bytes>', 'estimated compiled-template bytes retained by admitted requests').default('16777216').argParser(Number))
  .addOption(new Option('--mode <mode>', 'error and runtime policy').choices(['development', 'production']))
  .option('--no-cache', 'disable the development compiler cache')

program.enablePositionalOptions()
program.exitOverride()
program.action(serve)
program.command('check [path]')
  .description('check Cow syntax without running site code (default path: current directory)')
  .option('--json', 'print a machine-readable result')
  .addOption(new Option('--runtime <name>', 'JavaScript runtime').choices(runtimeNames))
  .addOption(new Option('--source-limit <bytes>', 'maximum source bytes per file (default: 1048576)').argParser(Number))
  .action(async (path = '.', options) => {
    try {
      if (await selectRuntime(options.runtime ?? program.opts().runtime)) return
      const { checkPath, printCheckResult } = await import('../lib/check.mjs')
      const result = await checkPath(path, { sourceLimit: Number(options.sourceLimit ?? program.opts().sourceLimit) })
      printCheckResult(result, options)
      process.exitCode = result.exitCode
    } catch (error) {
      if (options.json) console.log(JSON.stringify({ checked: 0, skipped: 0, errors: [{ message: error.message, code: error.code || 'COW_CHECK_INPUT' }], exitCode: 2 }))
      else console.error(error.message)
      process.exitCode = 2
    }
  })

try {
  await program.parseAsync()
} catch (error) {
  if (!error.code?.startsWith('commander.')) console.error(error.stack || error.message)
  process.exitCode = error.exitCode === 0 ? 0 : 2
}

async function serve(directoryArgument, options) {
  if (await selectRuntime(options.runtime)) return
  const { CowApp } = await import('../lib/app.mjs')
  const directory = resolve(options.dir || directoryArgument)
  const app = new CowApp({
    rootDir: directory,
    host: options.host,
    port: options.port,
    workers: options.workers,
    timeout: options.timeout,
    maxQueue: options.maxQueue,
    queueTimeout: options.queueTimeout,
    maxRequestsPerWorker: options.maxRequests,
    memoryLimitMb: options.memoryLimit,
    shutdownTimeout: options.shutdownTimeout,
    bodyLimit: options.bodyLimit,
    bodyTimeout: options.bodyTimeout,
    stallTimeout: options.stallTimeout,
    outputLimit: options.outputLimit,
    bufferLimit: options.bufferLimit,
    startupTimeout: options.startupTimeout,
    restartDelay: options.restartDelay,
    restartMaxDelay: options.restartMaxDelay,
    restartLimit: options.restartLimit,
    cacheEntries: options.cacheEntries,
    cacheBytes: options.cacheBytes,
    resourceLimit: options.resourceLimit,
    adapterLimit: options.adapterLimit,
    namespaceLimit: options.namespaceLimit,
    sourceLimit: options.sourceLimit,
    compileTimeout: options.compileTimeout,
    compileMaxPending: options.compileMaxPending,
    compiledBufferLimit: options.compiledBufferLimit,
    mode: options.mode,
    cache: options.cache
  })

  try {
    const address = await app.start()
    console.log(`Cow serving ${directory} at ${address.url}`)
    const host = hostRuntime()
    console.log(`Runtime: ${host.name} ${host.version}${process.env.COW_RUNTIME_CHILD === 'nub' ? ' (via Nub)' : ''}`)
    if (!host.workerHeapLimit) console.warn(`Cow: ${host.name} has no verified per-worker heap bound; use an OS/container memory limit when needed.`)
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  }

  let stopping = false
  async function stop(signal) {
    if (stopping) return
    stopping = true
    console.log(`\nCow received ${signal}; shutting down`)
    try {
      await app.close()
    } catch (error) {
      console.error(error.stack || error.message)
      process.exitCode = 1
    }
  }

  process.once('SIGINT', () => stop('SIGINT'))
  process.once('SIGTERM', () => stop('SIGTERM'))
}

async function selectRuntime(runtime) {
  if (await relaunchRuntime(runtime, fileURLToPath(import.meta.url), process.argv.slice(2))) return true
  assertHostSupported()
  return false
}
