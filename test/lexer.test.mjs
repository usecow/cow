import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileCowModule, compileSource, CowCompileError, tokenize } from '../lib/compiler.mjs'

async function render(source, filePath = 'lexer.cow') {
  const code = compileSource(source, { filePath })
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  let output = ''
  await module.default({ echo(value) { output += value } })
  return output
}

test('echo blocks use expression context for object/function division', async () => {
  for (const file of ['page.cow', 'page.jsp', 'page.tsp']) {
    assert.equal(await render('<?= { valueOf() { return 10; } } / 2 ?>', file), '5')
    assert.equal(await render('<?= { valueOf: () => 12 } / 3 ?>', file), '4')
    assert.equal(await render('<?= {} / 2 ?>', file), 'NaN')
    assert.equal(await render('<?= function() {} / 2 ?>', file), 'NaN')
    assert.equal(await render('<?= async function() {} / 2 ?>', file), 'NaN')
  }
})

test('slash context survives HTML, echo blocks and mixed Cow code tags', async () => {
  const source = '<?js const n = { valueOf() { ?>value=<?= 1 ?><?ts return 10; } } / 2; echo(n); ?>'
  assert.equal(await render(source), 'value=15')
  assert.equal(await render('<?js const n = function() { ?>unused<?js } / 2; echo(n); ?>'), 'NaN')
  assert.equal(await render('<?js if (true) { ?>yes<?js } /[?>]/.test(">"); ?>'), 'yes')
  assert.equal(await render('<?js let n = 12 ?><?js / 3; echo(n); ?>'), '4')
})

test('code-only helper tags share syntax context without adding output statements', async () => {
  const source = '<?ts export const n = { valueOf() { ?>\r\n<?js return 10; } } / 2;'
  const { code } = compileCowModule(source, 'helper.cow')
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  assert.equal(module.n, 5)
})

test('slash goals cover control flow, expressions and TypeScript syntax', async () => {
  const samples = [
    ['<?js if (true) /[?>]/.test(">"); ?>ok', 'ok'],
    ['<?js function f() {} /[?>]/.test(">"); ?>ok', 'ok'],
    ['<?js class C {} /[?>]/.test(">"); ?>ok', 'ok'],
    ['<?js const n = (() => 12)() / 3; ?><?= n ?>', '4'],
    ['<?js let n = 12; n /= 3; ?><?= n ?>', '4'],
    ['<?js const f = <T>(x: T) => /[?>]/.test(String(x)); ?><?= f(">") ?>', 'true'],
    ['<?ts const n = <number>12 / 3; ?><?= n ?>', '4'],
    ['<?ts const n: number = 12; ?><?= n! / 3 ?>', '4'],
    ['<?= { pattern: /[?>]/ }.pattern.source ?>', '[?>]'],
    ['<?= /[?>]/.test(">") ? 12 / 3 : 0 ?>', '4'],
    ['<?js outer: while (true) { break outer\n/[?>]/.test(">"); } ?>ok', 'ok'],
    ['<?js function* f() { yield /[?>]/.source; } ?><?= f().next().value ?>', '[?>]'],
    ['<?js for (const c of /[?>]/.source) { echo(c); } ?>', '[?>]']
  ]
  for (const [source, expected] of samples) assert.equal(await render(source), expected, source)
})

test('nested templates, strings, comments and regexes protect tag-looking text', async () => {
  const samples = [
    ['<?= `outer ${ /[?>]/.test(">") ? `inner ?>` : "no" }` ?>', 'outer inner ?>'],
    ['<?= `a ${ { x: `b ${ /[?>]/.source }` }.x } c` ?>', 'a b [?>] c'],
    ['<?js /* ?> <?js */ const x = "?>"; echo(x); // ?>tail', '?>tail'],
    ['<?js const r = /["\x27`?>/]+/; echo(r.test(">")); ?>tail', 'truetail'],
    [String.raw`<?js const r = /\/\*?>/; echo(r.source); ?>`, String.raw`\/\*?>`],
    ['<?= "<?js ?>" ?>tail', '<?js ?>tail']
  ]
  for (const [source, expected] of samples) assert.equal(await render(source), expected, source)
})

test('tokens retain original offsets and existing delimiter rules', () => {
  const source = '前😀\r\n<?= { valueOf() { return 10 } } / 2 ?>tail'
  const tokens = tokenize(source, 'ts', 'locations.cow')
  assert.deepEqual(tokens.map(t => t.type), ['text', 'echo', 'text'])
  for (const token of tokens) assert.equal(source.slice(token.start, token.start + token.value.length), token.value)
  assert.deepEqual(tokenize('<?xml version="1.0"?><p>hi</p>', 'ts', 'xml.cow'), [
    { type: 'text', value: '<?xml version="1.0"?><p>hi</p>' }
  ])
  assert.throws(() => tokenize('前😀\r\n<?= "?>"', 'ts', 'bad.cow'),
    e => e instanceof CowCompileError && e.line === 2 && e.column === 1 && /missing/.test(e.message))
  assert.throws(() => tokenize('<?ts const n = 1 ?>', 'js', 'bad.jsp'), /cannot be used/)
  assert.deepEqual(tokenize('<?js const n = 1', 'ts', 'final.cow'), [{ type: 'code', value: ' const n = 1' }])
})

test('expression goals remain correct across comments, newlines and nested expressions', async () => {
  const values = [
    ['{ valueOf() { return 12 } }', '6'], ['function() {}', 'NaN'], ['class {}', 'NaN'],
    ['(() => 12)()', '6'], ['[12][0]', '6'], ['(12 as number)', '6'],
    ['(12 satisfies number)', '6'], ['12!', '6'],
    ['`outer ${ { x: /[?>]/.source }.x }`', 'NaN']
  ]
  for (const [value, expected] of values) {
    for (const gap of [' ', '\n', '\r\n', ' /* ?> */ ', ' // note\n']) {
      const body = ` ${value}${gap}/ 2 `
      const source = `<?=${body}?>`
      assert.deepEqual(tokenize(source, 'ts', 'expression.cow'), [{ type: 'echo', value: body }])
      assert.equal(await render(source), expected, source)
    }
  }
})

test('lexical checkpoints preserve control flow and nested template interpolation', async () => {
  const samples = [
    ['<?js if (false); else /[?>]/.test(">"); ?>ok', 'ok'],
    ['<?js if (false) ?>no<?js else echo(/[?>]/.test(">")); ?>', 'true'],
    ['<?js do ?>once<?js while (false); /[?>]/.test(">"); ?>', 'once'],
    ['<?js const text = `outer ${(() => { const n = 12; return n / 2 + /[?>]/.source; })()}`; ?><?= text ?>', 'outer 6[?>]'],
    ['<?ts interface F { x: string } /[?>]/.test(">"); ?>ok', 'ok'],
    ['<?ts enum F { x } /[?>]/.test(">"); ?>ok', 'ok'],
    ['<?js const r = /=?>/; echo(r.source); ?>', '=?>'],
    ['<?js let x = 0; x = /[?>]/.source.length; ?><?= x ?>', '4']
  ]
  for (const [source, expected] of samples) assert.equal(await render(source), expected, source)
})

test('PHP-familiar quirks: comment close, echo semicolons, nullish output and BOM', async () => {
  // A `//` comment ends at ?> exactly as PHP's lexer does; /* */ hides it.
  assert.equal(await render('<?js const x = 1; // note ?><p><?= x ?></p>'), '<p>1</p>')
  assert.equal(await render('<?js const x = 1; /* ?> */ echo(x); ?>tail'), '1tail')
  assert.equal(await render('<?js const y = 3 ?><?= y // trailing ?>'), '3')
  // Echo blocks tolerate trailing semicolons, the reflexive PHP habit.
  assert.equal(await render('<?js const x = 5; ?><?= x; ?>|<?= x ;; ?>'), '5|5')
  // Missing values print nothing, matching PHP echo of null.
  assert.equal(await render('[<?= undefined ?>][<?= null ?>][<?= 0 ?>][<?= false ?>]'), '[][][0][false]')
  // A UTF-8 BOM is an encoding artifact, never response output.
  assert.equal(await render('﻿<p>hi</p>'), '<p>hi</p>')
  assert.equal(await render('﻿<?js const x = 2 ?><?= x ?>'), '2')
  assert.throws(() => compileSource('<p></p>\n<?= ; ?>', { filePath: 'empty.cow' }),
    e => e instanceof CowCompileError && e.line === 2 && /Echo block is empty/.test(e.message))
})

test('unused imports are preserved for their side effects, not silently deleted', () => {
  const page = compileSource('<?js import { helper } from "./x.mjs"; import "./effect.mjs"; ?>ok', { filePath: 'page.cow' })
  assert.match(page, /import { helper } from "\.\/x\.mjs"/)
  assert.match(page, /import "\.\/effect\.mjs"/)
  const helper = compileCowModule('<?ts import { unused } from "./x.mjs"\nexport const n = 1', 'helper.cow')
  assert.match(helper.code, /import { unused } from "\.\/x\.mjs"/)
})

test('repeated slash-heavy blocks retain every boundary and compile', () => {
  const fragments = [
    '<?js echo(12 / 3); ?>text', '<?js echo(/[?>]/.source); ?>text',
    '<?= {valueOf(){return 10}} / 2 ?>', '<?js echo((() => 12)() / 3); ?>text'
  ]
  for (const fragment of fragments) {
    const source = fragment.repeat(512)
    const tokens = tokenize(source, 'ts', 'many.cow')
    assert.equal(tokens.filter(token => token.type !== 'text').length, 512)
    assert.doesNotThrow(() => compileSource(source, { filePath: 'many.cow' }))
  }
})
