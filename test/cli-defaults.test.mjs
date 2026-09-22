import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../bin/cow.mjs', import.meta.url))
const exec = promisify(execFile)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cow-default-site-'))
  const children = new Set()
  t.after(async () => {
    await Promise.all([...children].map(child => child.stop()))
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  })
  await mkdir(join(root, 'other site'))
  await writeFile(join(root, 'index.cow'), 'current directory')
  await writeFile(join(root, 'other site', 'index.cow'), 'explicit directory')
  return {
    root,
    async start(args = []) {
      const childProcess = spawn(process.execPath, [cli, ...args, '--runtime', 'node', '--port', '0', '--workers', '1'], {
        cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, COW_RUNTIME_CHILD: '' }
      })
      let output = ''
      const closed = new Promise(resolve => childProcess.once('close', resolve))
      const child = {
        async stop() {
          if (childProcess.exitCode === null && childProcess.signalCode === null) childProcess.kill('SIGTERM')
          const force = setTimeout(() => childProcess.kill('SIGKILL'), 5_000)
          try { await closed } finally { clearTimeout(force); children.delete(child) }
        }
      }
      children.add(child)
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`CLI startup timed out: ${output}`)), 20_000)
        const fail = error => { clearTimeout(timer); reject(error) }
        childProcess.once('error', fail)
        childProcess.once('exit', code => fail(new Error(`CLI exited ${code}: ${output}`)))
        const data = chunk => {
          output += chunk
          const match = /at (http:\/\/[^\s]+)/.exec(output)
          if (match) { clearTimeout(timer); resolve(match[1]) }
        }
        childProcess.stdout.on('data', data)
        childProcess.stderr.on('data', data)
      })
      return { ...child, url }
    }
  }
}

test('cow serves the working directory by default and respects explicit directory selection', async t => {
  const f = await fixture(t)
  for (const [args, expected] of [[[], 'current directory'], [['other site'], 'explicit directory'],
    [['missing-site', '--dir', 'other site'], 'explicit directory']]) {
    const server = await f.start(args)
    try {
      const response = await fetch(server.url, { signal: AbortSignal.timeout(10_000) })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), expected)
    } finally { await server.stop() }
  }
})

test('embedded CowApp uses the same working-directory default without requiring src/', async t => {
  const f = await fixture(t)
  const script = `import {CowApp} from ${JSON.stringify(new URL('../lib/app.mjs', import.meta.url).href)};
    const app=new CowApp({workers:1});
    try { await app.initialize(); console.log((await app.execute({url:'/'})).response.body.toString()); }
    finally { await app.close(); }`
  const { stdout } = await exec(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: f.root, windowsHide: true, timeout: 30_000
  })
  assert.equal(stdout.trim(), 'current directory')
})
