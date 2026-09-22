import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CowApp } from '../lib/app.mjs';

test('Cow homepage serves its assets and the live example safely', async t => {
  const app = new CowApp({ rootDir: fileURLToPath(new URL('./site/', import.meta.url)), port: 0, workers: 1 });
  t.after(() => app.close());
  const { url } = await app.start();
  const get = path => fetch(url + path);

  await t.test('homepage and every referenced local asset load', async () => {
    const response = await get('/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
    const html = await response.text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(match => match[1]))];
    assert.ok(assets.length > 0);
    for (const path of assets) {
      const asset = await get(path);
      assert.equal(asset.status, 200, path);
      assert.ok((await asset.arrayBuffer()).byteLength > 0, path);
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size, 'HTML IDs must be unique');
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), 'Broken anchor: ' + id);
  });

  await t.test('the page preserves keyboard, reduced-motion and no-JS paths', async () => {
    const html = await (await get('/')).text();
    assert.match(html, /class="skip-link" href="#main"/);
    const groups = [...html.matchAll(/<[^>]+\brole="group"[^>]*>/g)];
    assert.ok(groups.length > 0);
    for (const [group] of groups) assert.match(group, /aria-label="[^"\s][^"]*"/);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    for (const [, targets] of html.matchAll(/aria-controls="([^"]+)"/g)) {
      for (const target of targets.split(/\s+/)) assert.ok(ids.has(target), 'Missing controlled element: ' + target);
    }
    // Without JavaScript, the demo form posts back to the homepage itself.
    assert.match(html, /data-demo-output>\s*<h2>Hello, friend!<\/h2>\s*<form method="post">/);
    const input = '<script>alert(1)</script>';
    const posted = await (await fetch(url + '/', { method: 'POST', body: new URLSearchParams({ name: input }) })).text();
    assert.ok(posted.includes('<h2>Hello, &lt;script&gt;alert(1)&lt;/script&gt;!</h2>'));
    assert.ok(!posted.includes(input));
    const css = await (await get('/assets/site.css')).text();
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /html:not\(\[data-enhanced\]\) \.js-only/);
    assert.match(css, /:focus-visible/);
  });

  await t.test('the example renders requests, defaults correctly, and escapes user input', async () => {
    assert.match(await (await get('/hello?name=Niji')).text(), /<h1>Hello, Niji!<\/h1>/);
    assert.match(await (await get('/hello?name=')).text(), /<h1>Hello, world!<\/h1>/);
    const input = '<script>alert(1)</script>';
    const response = await get('/hello?name=' + encodeURIComponent(input));
    const html = await response.text();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes(input));
    const long = await (await get('/hello?name=' + 'a'.repeat(500))).text();
    assert.ok(long.includes('Hello, ' + 'a'.repeat(60) + '!'));
    assert.ok(!long.includes('a'.repeat(61)));
  });

  await t.test('the icon browser renders live from the icon registry', async () => {
    const { icons, variants } = await import('./icons/icons.mjs');
    const response = await get('/icons');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    const html = await response.text();
    const names = Object.keys(icons);
    assert.equal([...html.matchAll(/class="icon-tile"/g)].length, names.length);
    assert.equal([...html.matchAll(/<template id="/g)].length, names.length * variants.length);
    assert.match(html, new RegExp('<span id="result-count" role="status">' + names.length + ' icons</span>'));
  });

  await t.test('private helpers and page sources are not publicly served', async () => {
    for (const path of ['/_headers.mjs', '/index.cow', '/hello.cow', '/README.md', '/preview.log']) {
      const response = await get(path);
      assert.equal(response.status, 404, path);
      await response.text();
    }
  });
});
