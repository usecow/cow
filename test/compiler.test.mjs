import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CowCompileError, compileSource, tokenize } from '../lib/compiler.mjs'

test('closing tags inside JavaScript lexical values and comments are inert', () => {
  const bodies = [
    'const value = "?>"; echo(value);',
    "const value = 'escaped \\' ?>'; echo(value);",
    'const value = /[?>/]+/; echo(value.source);',
    'if (true) /\\?>/.test("?>");',
    'const n = 12 / 3 / 2; const value = "?>";',
    '/* ?> */ const value = 1; // note\n echo(value);',
    'const value = `outer ?> ${`inner ${"?>"}`} end`; echo(value);',
    'const value = /\\/\\*\\?>/; echo(value.source);'
  ]
  for (const body of bodies) {
    const source = `<?js ${body} ?>tail`
    assert.deepEqual(tokenize(source, 'js'), [{ type: 'code', value: ` ${body} ` }, { type: 'text', value: 'tail' }], body)
    assert.doesNotThrow(() => compileSource(source, { filePath: 'page.jsp', language: 'js' }), body)
  }
  assert.equal(tokenize('<?= "?>" ?>', 'js')[0].value, ' "?>" ')
  assert.doesNotThrow(() => compileSource('<?ts const value: string = "?>" ?><?= value ?>', { filePath: 'page.tsp', language: 'ts' }))
  assert.doesNotThrow(() => compileSource('<?js if (true) { ?>yes<?js } ?>', { filePath: 'page.jsp', language: 'js' }))
})

test('compile errors use original template locations including CRLF and exports', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = ['<h1>Title</h1>', '<?js', 'const valid = 1;', 'const broken = ;', '?>'].join(newline)
    assert.throws(() => compileSource(source, { filePath: 'page.jsp', language: 'js' }),
      (error) => error instanceof CowCompileError && error.line === 4 && error.column === 16)
  }
  assert.throws(() => compileSource('<p>Hello</p>\n<?ts export const x = 1 ?>', { filePath: 'page.tsp', language: 'ts' }),
    (error) => error.line === 2 && error.column === 6 && /cannot declare exports/.test(error.message))
})

test('tokenizes code, HTML, and echo blocks in source order', () => {
  assert.deepEqual(tokenize('<?js const x = 2 ?>value=<?= x ?>', 'js'), [
    { type: 'code', value: ' const x = 2 ' },
    { type: 'text', value: 'value=' },
    { type: 'echo', value: ' x ' }
  ])
})

test('permits a final code block without a closing tag', () => {
  assert.deepEqual(tokenize('<?ts const x: number = 2', 'ts'), [
    { type: 'code', value: ' const x: number = 2' }
  ])
})

test('rejects language tags that do not match the file type', () => {
  assert.throws(
    () => tokenize('<?ts const x = 1 ?>', 'js', 'page.jsp'),
    (error) => error instanceof CowCompileError && /cannot be used/.test(error.message)
  )
})

test('compiles imports outside an async render function', () => {
  const output = compileSource(
    '<?js import value from "./value.mjs" ?>Result: <?= await value() ?>',
    { filePath: 'page.jsp', language: 'js' }
  )

  assert.match(output, /import value from "\.\/value\.mjs"/)
  assert.match(output, /async function __cowRender/)
  assert.match(output, /echo\("Result: "\)/)
  assert.match(output, /await value\(\)/)
})

test('preserves template-literal-looking HTML as inert text', () => {
  const output = compileSource('<p>` ${dangerous}</p>', {
    filePath: 'page.jsp',
    language: 'js'
  })

  assert.ok(output.includes('echo("<p>` ${dangerous}</p>");'))
})

test('seeded lexical combinations preserve delimiters across lookahead boundaries', () => {
  let seed = 0x51a7
  const random = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum }
  const fragments = [
    '"?>"', "'escaped \\' ?>'", '/[?>/]+/', '`outer ?> ${`inner ${"?>"}`} end`',
    '(12 / 3 / 2)', '(() => /\\?>/)', '({value: "☃😀?>"})'
  ]
  for (let n = 0; n < 350; n++) {
    const newline = ['\n', '\r\n'][random(2)]
    const padding = ' '.repeat(random(90))
    const value = fragments[random(fragments.length)]
    const body = `${padding}const value = ${value}; /* ${'?>'.repeat(random(7))} */${newline}// note${newline}if(true) /\\?>/.test("?>");`
    const source = `html<?js${body}?>tail<?= "?>" ?>`
    const tokens = tokenize(source, 'js')
    assert.equal(tokens[1].value, body, `seeded case ${n}`)
    assert.deepEqual(tokens.map(token => token.type), ['text', 'code', 'text', 'echo'])
    assert.doesNotThrow(() => compileSource(source, { filePath: 'fuzz.jsp', language: 'js' }))
  }
})

test('block-heavy templates preserve all blocks and source-map copy boundaries', () => {
  const count = 2048
  const source = '<?js if(true) { ?>' + 'html<?= 1 ?>'.repeat(count) + '<?js } ?>'
  const result = compileSource(source, { filePath: 'many.jsp', language: 'js' })
  assert.equal((result.match(/echo\("html"\)/g) || []).length, count)
  assert.equal((result.match(/echo\(String\(\(1\) \?\? ""\)\)/g) || []).length, count)
})

test('malformed lexical values and missing echo terminators fail with original locations', () => {
  for (const body of ['const s = "unterminated ?>', 'const r = /[unterminated ?>', 'const t = `unterminated ?>', 'const x: = 3;']) {
    const source = `<p>前😀</p>\r\n<?ts ${body}`
    assert.throws(() => compileSource(source, { filePath: 'bad.tsp', language: 'ts' }),
      error => error instanceof CowCompileError && error.line >= 2 && error.column >= 1, body)
  }
  assert.throws(() => compileSource('<p>前😀</p>\n<?= "?>"', { filePath: 'bad.jsp', language: 'js' }),
    error => error instanceof CowCompileError && error.line === 2 && /missing/.test(error.message))
})
