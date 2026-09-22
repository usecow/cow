import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { checkPath } from '../lib/check.mjs'

const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../bin/cow.mjs', import.meta.url))

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cow-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = async (name, source) => {
    const file = join(root, name)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source)
    return file
  }
  const run = async (...args) => {
    try { return { code: 0, ...await exec(process.execPath, [cli, ...args], { cwd: root, windowsHide: true, timeout: 20_000 }) } }
    catch (error) { if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr } }
  }
  await write('package.json', '{"type":"module"}')
  return { root, write, run }
}

test('check scans private templates and helpers without executing imports, configuration or site code', async t => {
  const f = await fixture(t)
  const marker = JSON.stringify(join(f.root, '_executed'))
  const dangerous = `import {writeFileSync} from 'node:fs'; writeFileSync(${marker},'bad'); throw new Error('do not run');`
  await f.write('index.jsp', `<?js ${dangerous} await import('missing-package'); ?>`)
  await f.write('_partials/view.tsp', '<?ts const x: number = "not a type check"; ?><?= x ?>')
  await f.write('_helper.mjs', dangerous)
  await f.write('_helper.ts', `export const value: number = 1; ${dangerous}`)
  await f.write('cow.config.mjs', dangerous)
  await f.write('_old.cjs', `require('node:fs').writeFileSync(${marker},'bad'); return;`)
  const before = (await readdir(f.root, { recursive: true })).sort()
  const result = await f.run('check', '.', '--json')
  assert.equal(result.code, 0, result.stderr || result.stdout)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).checked, 6)
  assert.deepEqual((await readdir(f.root, { recursive: true })).sort(), before)
  await assert.rejects(readFile(join(f.root, '_executed')), { code: 'ENOENT' })
})

test('check defaults to the current directory and accepts a single filename with spaces', async t => {
  const f = await fixture(t)
  await f.write('page with spaces.jsp', '<?js if(true) { ?>Hello<?= "?>" ?><?js } ?>')
  for (const args of [['check'], ['check', 'page with spaces.jsp']]) {
    const result = await f.run(...args)
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /Checked 1 file: no syntax errors/)
    assert.doesNotMatch(result.stdout, /Cow serving/)
  }
})

test('template and helper syntax errors retain original CRLF locations and all files are checked', async t => {
  const f = await fixture(t)
  const template = await f.write('bad.jsp', '<h1>😀</h1>\r\n<?js\r\nconst valid=1;\r\nconst broken = ;\r\n?>')
  const typed = await f.write('_bad.ts', 'export const valid=1;\r\nexport const broken: number = ;')
  await f.write('good.jsp', 'valid')
  const run = await f.run('check', '.', '--json')
  const result = JSON.parse(run.stdout)
  assert.equal(run.code, 1)
  assert.equal(result.checked, 3)
  assert.deepEqual(result.errors.map(e => [e.file, e.line, e.column]), [[typed, 2, 31], [template, 4, 16]])
  const human = await f.run('check', 'bad.jsp')
  assert.equal(human.code, 1)
  assert.ok(human.stderr.includes(`${template}:4:16:`), human.stderr)
})

test('V8 early errors and transformed TSP errors map to the original source', async t => {
  const f = await fixture(t)
  await f.write('duplicate.jsp', '<p>before</p>\n<?js\nconst thing=1;\nconst thing=2;\n?>')
  await f.write('duplicate.tsp', '<p>before</p>\n<?ts\nconst thing: number=1;\nconst thing: number=2;\n?>')
  await f.write('_duplicate.ts', 'export const thing: number=1;\nexport const thing: number=2;')
  const result = await checkPath(f.root)
  assert.equal(result.exitCode, 1)
  assert.deepEqual(result.errors.map(e => [e.line, e.column]), [[2, 14], [4, 7], [4, 7]])
  for (const error of result.errors) assert.match(error.message, /already been declared/)
})

test('JS format follows package scope, CJS permits return, and ESM rejects unresolved local exports', async t => {
  const f = await fixture(t)
  await f.write('esm.js', 'import "missing"; export default await Promise.resolve(1);')
  await f.write('common/package.json', '{"type":"commonjs"}')
  await f.write('common/good.js', 'module.exports=1; return;')
  await f.write('common/bad.js', 'import value from "missing";')
  await f.write('bad-export.mjs', 'export { nonexistent };')
  await f.write('bad.cjs', 'const exports = 1;')
  const result = await checkPath(f.root)
  assert.equal(result.checked, 5)
  assert.equal(result.errors.length, 3)
  assert.equal(result.exitCode, 1)
  assert.ok(result.errors.some(e => e.file.endsWith('bad-export.mjs') && /not defined/.test(e.message)))
  assert.ok(result.errors.some(e => e.file.endsWith('bad.cjs') && /already been declared/.test(e.message)))
})

test('check skips dependency/data/cache/dot trees, declarations and recursive symlinks', async t => {
  const f = await fixture(t)
  await f.write('site/index.jsp', 'hello')
  await f.write('site/_private/ok.jsp', 'private')
  for (const directory of ['node_modules', 'data', 'cache', '.git']) await f.write(`site/${directory}/bad.jsp`, '<?js const broken=; ?>')
  await f.write('site/_types.d.ts', 'export declare const x: number;')
  await f.write('outside/bad.jsp', '<?js const broken=; ?>')
  await symlink(join(f.root, 'outside'), join(f.root, 'site', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = await checkPath(join(f.root, 'site'))
  assert.equal(result.exitCode, 0)
  assert.equal(result.checked, 2)
  assert.equal(result.skipped, 6)
  const explicit = await checkPath(join(f.root, 'site', 'linked', 'bad.jsp'))
  assert.equal(explicit.exitCode, 1)
  assert.equal(explicit.checked, 1)
})

test('check distinguishes missing/empty/unsupported input and source limits from syntax errors', async t => {
  const f = await fixture(t)
  await mkdir(join(f.root, 'empty'))
  await f.write('text.txt', 'not code')
  await f.write('large.jsp', 'x'.repeat(65))
  for (const args of [['check', 'missing'], ['check', 'empty'], ['check', 'text.txt'], ['check', 'large.jsp', '--source-limit', '64'], ['check', '--source-limit', 'NaN'], ['check', '--source-limit', '0']]) {
    const result = await f.run(...args, '--json')
    assert.equal(result.code, 2, JSON.stringify(result))
    assert.equal(JSON.parse(result.stdout).exitCode, 2)
  }
  assert.equal((await f.run('check', 'large.jsp', '--source-limit', '65')).code, 0)
})

test('check preserves CLI help/version and rejects invalid command options without starting a server', async t => {
  const f = await fixture(t)
  assert.match((await f.run('--help')).stdout, /check/)
  assert.match((await f.run('check', '--help')).stdout, /without running site code/)
  assert.match((await f.run('--version')).stdout, /^\d+\.\d+\.\d+/)
  for (const args of [['check', '--unknown'], ['check', 'a', 'b']]) assert.equal((await f.run(...args)).code, 2)
})

test('static JSON import attributes and template export rejection match the pinned compiler', async t => {
  const f = await fixture(t)
  await f.write('attributes.tsp', '<?ts import data from "./missing.json" with { type: "json" }; const value: number=data.value; ?><?= value ?>')
  await f.write('export.jsp', '<h1>Title</h1>\n<?js export const x=1; ?>')
  const result = await checkPath(f.root)
  assert.equal(result.checked, 2)
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].line, 2)
  assert.match(result.errors[0].message, /Templates cannot declare exports/)
})

test('parser subprocesses do not inherit preloads or write coverage/compiler-cache files', async t => {
  const f = await fixture(t)
  const marker = join(f.root, '_preload-ran')
  const preload = await f.write('preload.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');`)
  const file = await f.write('index.jsp', '<?js echo("hello"); ?>')
  const changes = { NODE_OPTIONS: `--require "${preload}"`, NODE_V8_COVERAGE: join(f.root, 'coverage'), NODE_COMPILE_CACHE: join(f.root, 'compiler-cache') }
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]))
  try {
    Object.assign(process.env, changes)
    assert.equal((await checkPath(file)).exitCode, 0)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  for (const path of [marker, changes.NODE_V8_COVERAGE, changes.NODE_COMPILE_CACHE]) await assert.rejects(lstat(path), { code: 'ENOENT' }, path)
})

test('incomplete CommonJS locates EOF and operational errors take precedence over syntax failures', async t => {
  const f = await fixture(t)
  const source = 'function unfinished() {'
  const file = await f.write('unfinished.cjs', source)
  let result = await checkPath(file)
  assert.equal(result.exitCode, 1)
  assert.equal(result.errors[0].column, source.length + 1)
  await f.write('malformed/package.json', '{')
  await f.write('malformed/helper.js', 'module.exports=1;')
  result = await checkPath(f.root)
  assert.equal(result.checked, 2)
  assert.equal(result.errors.length, 2)
  assert.equal(result.exitCode, 2)
})
