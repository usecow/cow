import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const directory = new URL('./data/', import.meta.url)
await mkdir(directory, { recursive: true })
const filename = new URL('./data/setup-key', import.meta.url)
try {
  await writeFile(filename, randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 })
} catch (error) {
  if (error.code !== 'EEXIST') throw error
}
const db = new DatabaseSync(new URL('./data/forum.sqlite', import.meta.url))
const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='forum_users'").get()
const installed = exists && db.prepare("SELECT 1 FROM forum_users WHERE role='admin'").get()
db.close()
if (!installed) {
  console.log('Open /install to create your forum administrator.')
  console.log(`Setup key: ${(await readFile(filename, 'utf8')).trim()}`)
  console.log('Keep this key private. It cannot unlock an installed forum.')
}
