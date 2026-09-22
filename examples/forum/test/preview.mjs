// Disposable browser-QA site; never touches the user's example databases.
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CowApp } from '../../../lib/app.mjs'

const project = fileURLToPath(new URL('../../../', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'cow-forum-preview-'))
const setupKey = randomBytes(24).toString('hex')
await cp(join(project, 'examples/forum/site'), join(root, 'site'), { recursive: true })
await mkdir(join(root, 'data'))
await writeFile(join(root, 'data/setup-key'), setupKey)
const installed = join(root, 'node_modules/@cowlang/cow')
await mkdir(installed, { recursive: true })
await cp(join(project, 'package.json'), join(installed, 'package.json'))
await cp(join(project, 'lib'), join(installed, 'lib'), { recursive: true })
const app = new CowApp({ rootDir: join(root, 'site'), host: '127.0.0.1', port: 0, workers: 2 })
const address = await app.start()
console.log(JSON.stringify({ url: address.url, setupKey, root }))
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await app.close()
  if (dirname(root) === tmpdir() && root.split(/[\\/]/).at(-1).startsWith('cow-forum-preview-')) {
    await rm(root, { recursive: true, force: true })
  }
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
