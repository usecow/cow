import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'

const exec = promisify(execFile)

test('forum Secure-cookie settings give COW variables precedence over JIN fallbacks', async () => {
  const configURL = new URL('../site/_config.cow', import.meta.url).href
  const page = `<?js res.json((await import(${JSON.stringify(configURL)})).default.secureCookies);`
  const source = `import {CowApp} from ${JSON.stringify(new URL('../../../lib/app.mjs', import.meta.url).href)};
    import {mkdtemp,writeFile,rm} from 'node:fs/promises'; import {tmpdir} from 'node:os'; import {join} from 'node:path';
    const root=await mkdtemp(join(tmpdir(),'cow-config-check-'));
    const app=new CowApp({rootDir:root,workers:1});
    try {await writeFile(join(root,'index.cow'),${JSON.stringify(page)}); await app.initialize();
      console.log((await app.execute({url:'/'})).response.body.toString());}
    finally {try {await app.close()} finally {await rm(root,{recursive:true,force:true})}}`
  const clean = { ...process.env }
  for (const key of Object.keys(clean)) if (/^(?:COW|JIN)_FORUM_SECURE_COOKIES$/i.test(key)) delete clean[key]
  for (const [settings, expected] of [
    [{}, false],
    [{ JIN_FORUM_SECURE_COOKIES: '1' }, true],
    [{ COW_FORUM_SECURE_COOKIES: '1' }, true],
    [{ JIN_FORUM_SECURE_COOKIES: '1', COW_FORUM_SECURE_COOKIES: '0' }, false],
    [{ JIN_FORUM_SECURE_COOKIES: '0', COW_FORUM_SECURE_COOKIES: '1' }, true]
  ]) {
    const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', source], { env: { ...clean, ...settings }, windowsHide: true })
    assert.equal(JSON.parse(stdout), expected)
  }
})
