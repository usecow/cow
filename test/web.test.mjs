import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cookies, deleteCookie, escapeHtml, field, form, hashPassword, setCookie, verifyPassword } from '../lib/web.mjs'

test('web helpers escape HTML and reject unsupported or ambiguous form input', () => {
  assert.equal(escapeHtml('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;')
  assert.equal(escapeHtml(null), '')
  const request = { header: () => 'application/x-www-form-urlencoded; charset=UTF-8', text: () => 'title=Hello+world&title=duplicate&tag=a&tag=b' }
  const values = form(request)
  assert.deepEqual(values.getAll('tag'), ['a', 'b'])
  assert.throws(() => field(values, 'title'), { status: 400 })
  assert.equal(field(values, 'missing'), '')
  assert.throws(() => form({ ...request, header: () => 'application/json' }), { status: 415 })
})

test('cookies reject duplicates and serialize safe defaults without replacing other cookies', () => {
  const parsed = cookies({ header: () => 'session=first; theme=dark%20mode; session=second; broken=%QQ; __proto__=safe' })
  assert.equal(parsed.session, undefined)
  assert.equal(parsed.theme, 'dark mode')
  assert.equal(parsed.broken, undefined)
  assert.equal(Object.getPrototypeOf(parsed), null)
  const headers = {}
  const res = { getHeader: (name) => headers[name], setHeader: (name, value) => { headers[name] = value } }
  setCookie(res, 'one', 'first', { secure: true, maxAge: 3600 })
  setCookie(res, 'two', 'newline\r\n;evil')
  assert.equal(headers['set-cookie'].length, 2)
  assert.match(headers['set-cookie'][0], /Path=\/; SameSite=Lax; HttpOnly; Secure; Max-Age=3600/)
  assert.doesNotMatch(headers['set-cookie'][1], /\r|\n/)
  assert.throws(() => setCookie(res, 'bad;name', 'x'), TypeError)
  assert.throws(() => setCookie(res, 'name', 'x', { sameSite: 'None' }), TypeError)
})

test('password hashes use independent salts and validate credentials strictly', async () => {
  const password = 'a unique example password'
  const a = await hashPassword(password), b = await hashPassword(password)
  assert.notEqual(a, b)
  assert.equal(await verifyPassword(password, a), true)
  assert.equal(await verifyPassword('wrong password', a), false)
  assert.equal(await verifyPassword(password, 'scrypt-v1$' + '0'.repeat(32) + '$!'), false)
  await assert.rejects(hashPassword('short'), { status: 422 })
})

test('cookie scopes and deletion match and all existing Set-Cookie fields survive', () => {
  const headers = { 'set-cookie': 'existing=1; Path=/' }
  const res = { getHeader: name => headers[name], setHeader: (name, value) => { headers[name] = value } }
  const options = { path: '/account', domain: '.Example.COM', secure: true, httpOnly: false, sameSite: 'Strict' }
  const expires = new Date('2030-01-02T03:04:05Z')
  setCookie(res, 'user.theme', 'dark mode', { ...options, expires })
  deleteCookie(res, 'user.theme', options)
  assert.deepEqual(headers['set-cookie'], [
    'existing=1; Path=/',
    'user.theme=dark%20mode; Path=/account; Domain=example.com; SameSite=Strict; Secure; Expires=Wed, 02 Jan 2030 03:04:05 GMT',
    'user.theme=; Path=/account; Domain=example.com; SameSite=Strict; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ])
  assert.equal(options.domain, '.Example.COM')
  assert.equal(cookies({ header: () => 'user.theme=dark%20mode' })['user.theme'], 'dark mode')
})

test('invalid cookie options and prefix violations fail before changing headers', () => {
  let writes = 0
  const res = { getHeader: () => undefined, setHeader: () => { writes++ } }
  for (const options of [null, [], { secure: 'false' }, { httpOnly: 1 }, { sameSite: 'lax' },
    { path: '' }, { path: 'account' }, { path: '/; Secure' }, { path: '/\r\nx:y' },
    { domain: 'example.com; Secure' }, { domain: 'a..test' }, { domain: '' }, { domain: '-x.test' },
    { domain: 'x-.test' }, { domain: 'https://example.com' }, { domain: 'bücher.test' },
    { expires: 'tomorrow' }, { expires: new Date(NaN) }, { maxAge: -1 }, { maxAge: 1.5 },
    { maxAge: Infinity }, { maxAge: Number.MAX_SAFE_INTEGER + 1 }, { typo: true }]) {
    assert.throws(() => setCookie(res, 'test', 'value', options), TypeError)
  }
  for (const name of ['', 'x y', 'x=y', 'x\r\n', 'x[y]', 123, '__Secure-x', '__Host-x']) {
    assert.throws(() => setCookie(res, name, 'value'), TypeError)
  }
  assert.throws(() => setCookie(res, '__Host-x', 'value', { secure: true, domain: 'example.com' }), TypeError)
  assert.throws(() => setCookie(res, '__Host-x', 'value', { secure: true, path: '/account' }), TypeError)
  assert.equal(writes, 0)
  setCookie(res, '__Host-x', 'value', { secure: true })
  setCookie(res, '__Secure-x', 'value', { secure: true, sameSite: 'None' })
  assert.equal(writes, 2)
})
