// Run with Node. Each CLI launches the selected real runtime, not Node workers
// behind a Bun/Deno-branded wrapper. No installs/downloads happen in this test.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../bin/cow.mjs', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'cow-runtime-matrix-space &-'))
const runtimes = process.argv.slice(2)
if (!runtimes.length) runtimes.push('node', 'bun', 'nub', 'deno')
const helper = '<?ts export let state: number = 0; export const next = () => ++state;'
const page = `<?js
import {sqlite} from 'cow:sqlite';
import {next} from './_helpers.cow';
if(req.get('info')) cow.info({format:'json'});
if(req.get('fail')) { Promise.reject(new Error('matrix unhandled')); }
const db=await sqlite(new URL('./_data.sqlite',import.meta.url));
db.exec('CREATE TABLE IF NOT EXISTS swaps (n INTEGER)');
const n=await db.transaction(()=>{db.run('INSERT INTO swaps VALUES (1)');return db.get('SELECT COUNT(*) AS n FROM swaps').n});
res.json({n,fresh:next()});`
await writeFile(join(root, 'index.cow'), page)
await writeFile(join(root, '_helpers.cow'), helper)
const lexerPage = '<?= {valueOf(){return 10}} / 2 ?><?js const n = {valueOf(){ ?>value=<?ts return 12; }} / 3; echo(n); ?>'
await writeFile(join(root, 'lexer.cow'), lexerPage)
let child, output = '', count = 0
async function stop() {
  if (!child || child.exitCode !== null) return
  const processToStop = child
  const exited = new Promise(resolve => processToStop.once('exit', resolve))
  // Windows does not deliver POSIX signals to JS. Stop ONLY this test-owned
  // process tree, including the selected runtime child, to avoid orphan servers.
  if (process.platform === 'win32') await exec('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'], { windowsHide: true })
  else processToStop.kill('SIGTERM')
  await exited
  child = null
}
try {
  for (const runtime of runtimes) {
    output = ''
    child = spawn(process.execPath, [cli, root, '--runtime', runtime, '--port', '0', '--workers', '1'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COW_RUNTIME_CHILD: '' }
    })
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 20_000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited ${code}: ${output}`)) })
      const data = chunk => { output += chunk; const match = /at (http:\/\/[^\s]+)/.exec(output); if (match) { clearTimeout(timer); resolve(match[1]) } }
      child.stdout.on('data', data); child.stderr.on('data', data)
    })
    const get = path => fetch(url + path, { signal: AbortSignal.timeout(10_000) })
    const info = await (await get('/?info=1')).json()
    assert.equal(info.runtime.host, runtime === 'nub' ? 'node' : runtime, output)
    for (let n = 0; n < 2; n++) {
      const response = await get('/')
      assert.equal(response.status, 200, await response.clone().text())
      assert.deepEqual(await response.json(), { n: ++count, fresh: 1 })
    }
    assert.equal((await get('/_helpers.cow')).status, 404)
    const lexed = await get('/lexer')
    assert.equal(lexed.status, 200)
    assert.equal(await lexed.text(), '5value=4')
    assert.equal((await get('/?fail=1')).status, 500)
    count++ // The explicit committed SQLite write is not replayed or undone.
    const status = await (await get('/_cow/status')).json()
    assert.ok(status)
    await stop()
    const checked = await exec(process.execPath, [cli, 'check', root, '--runtime', runtime, '--json'], {
      env: { ...process.env, COW_RUNTIME_CHILD: '' }, windowsHide: true, timeout: 20_000
    })
    assert.equal(JSON.parse(checked.stdout).exitCode, 0)
    assert.equal(await readFile(join(root, 'index.cow'), 'utf8'), page)
    assert.equal(await readFile(join(root, '_helpers.cow'), 'utf8'), helper)
    assert.equal(await readFile(join(root, 'lexer.cow'), 'utf8'), lexerPage)
    console.log(`PASS ${runtime}: actual ${info.runtime.host} ${info.runtime.hostVersion}; unchanged files, lexer regressions, fresh helpers, SQLite continuity, errors, private files and CLI check`)
  }
} finally {
  await stop()
  assert.equal(dirname(root), tmpdir())
  assert.ok(root.split(/[\\/]/).at(-1).startsWith('cow-runtime-matrix-'))
  await rm(root, { recursive: true, force: true, maxRetries: 3 })
}
