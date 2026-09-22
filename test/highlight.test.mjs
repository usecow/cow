import assert from 'node:assert/strict'
import { test } from 'node:test'
import { highlight, highlightTokens } from '../lib/highlight.mjs'

const types = (source, options) => highlightTokens(source, options)
  .filter(token => token.type !== 'text')
  .map(token => `${token.type}:${token.value}`)

test('token stream reproduces the source, classifies Cow tags and shares compiler lexical rules', () => {
  const source = '<?js const n = 12 / 3 // half ?>\n<p><?= /[?>]/.source ?></p><?ts const s = "?>" ?>tail'
  const tokens = highlightTokens(source)
  assert.equal(tokens.map(token => token.value).join(''), source)
  // The // comment ends at ?> exactly as the compiler lexes it.
  assert.deepEqual(types(source), [
    'tag:<?js', 'keyword:const', 'number:12', 'number:3', 'comment:// half ', 'tag:?>',
    'html-tag:<p', 'html-tag:>', 'tag:<?=', 'regex:/[?>]/', 'tag:?>',
    'html-tag:</p', 'html-tag:>', 'tag:<?ts', 'keyword:const', 'string:"?>"', 'tag:?>'
  ])
})

test('code classification covers strings, templates, regex-versus-division and calls', () => {
  assert.deepEqual(types('<?js const t = `a ${ n / 2 } b ${ `x` } c` ?>'), [
    'tag:<?js', 'keyword:const', 'string:`a ${', 'number:2', 'string:} b ${', 'string:`x`', 'string:} c`', 'tag:?>'
  ])
  assert.deepEqual(types('<?= h(req.get("name")) ?>'), [
    'tag:<?=', 'call:h', 'call:get', 'string:"name"', 'tag:?>'
  ])
  assert.ok(types('<?js a = b / c / d ?>').every(entry => !entry.startsWith('regex')))
  assert.ok(types('<?js if (x) { } /re/.test(y) ?>').includes('regex:/re/'))
})

test('HTML regions highlight tags, attributes and comments, with state across Cow blocks', () => {
  assert.deepEqual(types('<h1 class="big" data-x>hi</h1><!-- note -->'), [
    'html-tag:<h1', 'html-attr:class', 'html-string:"big"', 'html-attr:data-x', 'html-tag:>',
    'html-tag:</h1', 'html-tag:>', 'html-comment:<!-- note -->'
  ])
  // A tag interrupted by an echo block keeps highlighting after it resumes.
  const across = types('<a href="<?= url ?>">x</a>')
  assert.deepEqual(across.slice(0, 2), ['html-tag:<a', 'html-attr:href'])
  assert.ok(across.includes('tag:<?='))
  assert.deepEqual(across.slice(-2), ['html-tag:</a', 'html-tag:>'])
  const comment = highlightTokens('<!-- a <?js "b" ?> c -->')
  assert.ok(comment.filter(token => token.type === 'html-comment').length >= 2)
  assert.ok(comment.some(token => token.type === 'string'))
})

test('malformed input never throws and still reproduces the source', () => {
  for (const source of ['<?js const x = "unterminated', '<?=', '<?= "?>', '', '<p', '<?js `open ${ ?>',
    '<?xml version="1.0"?>', '﻿<?js 1 ?>']) {
    const tokens = highlightTokens(source)
    const expected = source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source
    assert.equal(tokens.map(token => token.value).join(''), expected, JSON.stringify(source))
  }
})

test('code mode highlights a whole module and html output escapes everything once', () => {
  assert.deepEqual(types('import { x } from "./y.mjs"', { code: true }),
    ['keyword:import', 'keyword:from', 'string:"./y.mjs"'])
  const html = highlight('<p><?= h("<b>") ?></p>')
  assert.ok(html.includes('<span class="cow-tag">&lt;?=</span>'))
  assert.ok(html.includes('<span class="cow-string">&quot;&lt;b&gt;&quot;</span>'))
  assert.ok(!/[<>&]/.test(html.replace(/<span class="cow-[\w-]+">|<\/span>|&(?:amp|lt|gt|quot|#39);/g, '')))
  assert.equal(highlight('x', { classPrefix: 'hl-' }), 'x')
  assert.equal(highlight('<?= 1 ?>', { classPrefix: 'hl-' }),
    '<span class="hl-tag">&lt;?=</span> <span class="hl-number">1</span> <span class="hl-tag">?&gt;</span>')
})
