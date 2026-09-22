# Pages and helpers

[Documentation index](README.md)

A Cow page is an HTML file with code in it. This guide shows you how to write
code tags, print values safely, reuse markup with includes, and share code
with helpers.

## Write code in a page

A `.cow` page accepts three tags:

| Tag | What it does |
| --- | --- |
| `<?js ... ?>` | Runs code. |
| `<?ts ... ?>` | Runs code. It behaves the same as `<?js ... ?>`. |
| `<?= ... ?>` | Prints one expression. |

Everything outside a tag is sent to the browser as written. Save this as
`hello.cow`:

```jsp
<?js
const name = req.get('name') || 'world'
?>
<!doctype html>
<title>Hello</title>
<h1>Hello, <?= h(name) ?>!</h1>
<p>2 + 2 is <?= 2 + 2 ?>.</p>
```

Open `/hello?name=Clover`.

Output:

```html
<!doctype html>
<title>Hello</title>
<h1>Hello, Clover!</h1>
<p>2 + 2 is 4.</p>
```

Tags can sit inline. Code such as `<?js echo("hello"); ?>` and
`<p><?= 2 + 2 ?></p>` works alongside multiline blocks.

> **Note:** Coming from PHP? Cow keeps the line break after a closing `?>`,
> where PHP removes it. The output above starts with a blank line for that
> reason. Browsers ignore it in HTML.

### JavaScript or TypeScript

All code blocks in one `.cow` page share one TypeScript-capable scope. Plain
JavaScript works, and type annotations are optional. Cow erases the types
before the page runs, so typed and untyped code share the `.cow` extension. The tag
spelling does not create an isolated language mode within a page.

Cow transpiles TypeScript. It does not perform full type checking.

Cow also accepts two stricter file formats. A `.jsp` file uses JavaScript-only
`<?js ?>` tags, and a `.tsp` file uses TypeScript `<?ts ?>` tags.

### Imports

A page can import helpers, JavaScript and TypeScript modules, and npm packages:

```jsp
<?js
import { title } from './_site.cow'
res.setHeader('cache-control', 'no-store')
?>
<!doctype html>
<title><?= title ?></title>
```

Cow keeps imports exactly as written. An import that you never reference
still loads for its side effects. Only an explicit `import type` is erased.

Rendered pages do not declare exports. Put reusable exports in
[helpers](#share-code-with-helpers).

### Closing tags

- A final code block may omit its closing `?>` tag.
- Cow's lexer keeps code context across tags. It ignores tag-looking text
  inside strings, regular expressions, template literals, and `/* */` comments.
  For example, `<?js echo("?>") ?>` prints `?>`.
- A `//` comment ends at `?>`, exactly as in PHP. `<?js render() // done ?>`
  closes where it looks like it closes.
- A file saved with a UTF-8 BOM, which is common with Windows editors,
  compiles the same as a file without one. The BOM never reaches the response
  body.

## Print values

`<?= value ?>` prints one expression. It tolerates a trailing semicolon, so the
PHP reflex `<?= title; ?>` works. `null` and `undefined` print nothing, as in
PHP. Cow converts every other value with `String()`.

> **Warning:** `<?= ?>` prints raw output. To print anything that came from a
> visitor, a database, or another service, wrap it in `h()`:
> `<?= h(name) ?>`. `h(value)` escapes HTML text and quoted attribute values.

Save this as `search.cow`:

```jsp
<p>You searched for <?= h(req.get('q')) ?>.</p>
```

Open `/search?q=<b>hay</b>`.

Output:

```html
<p>You searched for &lt;b&gt;hay&lt;/b&gt;.</p>
```

## Reuse markup with includes

To render another file into the same response, call `include()`. Pass the
values that the include needs as the second argument. The include reads them
from `locals`.

Save this as `_latest.cow`:

```jsp
<ul>
<?js for (const title of locals.titles.slice(0, locals.limit)) { ?>
  <li><?= h(title) ?></li>
<?js } ?>
</ul>
```

Then save this as `news.cow`:

```jsp
<h1>News</h1>
<?js await include('./_latest.cow', {
  limit: 2,
  titles: ['Hay prices fall', 'New barn opens', 'Rain on Friday']
}) ?>
```

Open `/news`.

Output, with blank lines removed:

```html
<h1>News</h1>
<ul>
  <li>Hay prices fall</li>
  <li>New barn opens</li>
</ul>
```

Includes follow these rules:

- The path is relative to the file that calls `include()`.
- An include can be a `.cow`, `.jsp`, or `.tsp` file.
- An include receives its input only through `locals`.
- An include shares the request, the response, and the local module graph with
  its caller.
- Await includes one after another. Includes can nest up to 32 levels deep.

## Share code with helpers

Use `.cow` for reusable code as well as pages. A helper is a code-only `.cow`
file that exports functions or values. Save this as `_greetings.cow`:

```ts
<?ts
export function greeting(name: string): string {
  return `Hello, ${name}!`
}
```

Then save this as `greet.cow`:

```jsp
<?js import { greeting } from './_greetings.cow' ?>
<h1><?= h(greeting(req.get('name') || 'world')) ?></h1>
```

Open `/greet`.

Output:

```html
<h1>Hello, world!</h1>
```

Helpers use the same `<?js` and `<?ts` tags as pages, with optional types and
an optional final closing tag. A helper can have named exports, default
exports, re-exports, and top-level `await`.

Helpers hold code only. Cow ignores whitespace outside their code tags. It
rejects HTML and `<?= ?>` blocks with a suggestion to use `include()`. To
choose between the two:

| To reuse | Use | Because |
| --- | --- | --- |
| Markup | `include()` | It renders output. It does not expose module exports. |
| Functions and values | `import` | It loads exports. It does not render output. |

### What helpers can see

- Helpers share live module bindings within one request, and start fresh on
  the next request. Edits take effect without a restart.
- `req`, `res`, and `cow` are page bindings, not helper globals. Pass them to
  helper functions as arguments.
- For file-relative paths, use `import.meta.url`.

JavaScript modules, TypeScript modules, and npm dependencies remain supported.
A standalone Node.js or TypeScript tool does not understand tagged `.cow`
files without Cow-aware tooling.

## Keep files private

Cow never serves a file whose name starts with `_`, such as `_greetings.cow`,
or any file inside `_lib/`. Your pages can still import and include these
files. Requests for them get a `404` response.

The underscore is a privacy rule that the server enforces. It is not a
different language mode.

> **Warning:** Importing a file does not make it private. Cow treats a helper
> without the underscore, such as `greetings.cow`, as a page, and visitors can
> request its URL.

## Check syntax and read errors

`cow check` accepts both rendered pages and code-only helpers without running
either. It does not resolve their imports, and it does not determine how a
file will be used.

Syntax errors and runtime stack frames report the original `.cow`, `.jsp`, or
`.tsp` line and column, including inside included files and moved imports.
Imported TypeScript modules get the same original-source diagnostics.

In production, responses hide exception details. The diagnostics remain in the
server logs.

## See also

- [Request and response API](runtime-api.md) for `req`, `res`, and `cow`.
- [Output and errors](output-and-errors.md) for error pages and streaming.
- [Language contract](language-contract.md) for the precise page and helper
  rules.
