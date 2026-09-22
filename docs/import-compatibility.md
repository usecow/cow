# Import compatibility

[Documentation index](README.md)

This page lists how Cow resolves and loads each kind of import, and which
forms it rejects. Use it to check whether a module, package, or Node.js
built-in works in a page before you depend on it.

Ordinary code uses one request-scoped loader. Import spelling never opts a
module into worker persistence. Only explicitly declared native adapter entries
cross that boundary. See the
[language contract](language-contract.md#native-adapter-entries).

The example below shows two of these rules: the resolved file decides a
module's identity, and a URL query creates a separate instance. Save this as
`_tally.mjs`:

```js
let count = 0

export function add() {
  count += 1
  return count
}
```

Then save this as `imports.cow`:

```jsp
<?js
import { add } from './_tally.mjs'
import { add as sameFile } from './_tally'
import { add as variant } from './_tally.mjs?copy'
?>
<p>First spelling: <?= add() ?></p>
<p>Second spelling, same file: <?= sameFile() ?></p>
<p>Query variant, separate instance: <?= variant() ?></p>
```

Open `/imports`. The output is the same on every request, because every
instance is fresh each request.

Output, with blank lines removed:

```html
<p>First spelling: 1</p>
<p>Second spelling, same file: 2</p>
<p>Query variant, separate instance: 1</p>
```

## Import matrix

| Import or feature | Cow behavior |
| --- | --- |
| `cow:web`, `cow:sqlite`, `cow:resource`, `cow:csv`, `cow:runtime` | Bundled helpers from the running Cow installation, even with `npx` or a global command, like `node:` built-ins. `@cowlang/cow/<name>` is an equivalent alias, and both spellings take precedence over a local Cow package. An unknown `cow:` name fails with `COW_MODULE_UNKNOWN`. The normal request/native lifetime rules still apply. |
| `.mjs`, `.ts` | ESM, fresh each request. TypeScript transpiles. There is no full type checking. |
| `.cow` | Code-only tagged ESM, with optional types, named/default exports, and top-level await. Fresh each request. Whitespace outside code tags is ignored. HTML/echo blocks fail with `COW_MODULE_OUTPUT`. Use `include()` for output. |
| `.js` | The nearest package.json `type` decides. `module` selects ESM. Otherwise, the file is CommonJS. Prefer explicit `.mjs`/`.cjs`. |
| `.cjs`, ordinary CJS package | Request-scoped require graph, partial exports for cycles, and `require` export conditions. The default export is `module.exports`. Enumerable keys after evaluation supply named export snapshots, not Node.js static export analysis. |
| CJS `require(ESM)` | `ERR_REQUIRE_ESM`. Use dynamic import. Native adapters require ESM import (`COW_NATIVE_REQUIRE_UNSUPPORTED`). There is no native `require.cache`/`extensions`/`main` compatibility. |
| Extensionless local helper | Cow tries the exact file, then `.cow`, `.mjs`, `.js`, `.ts`, `.cjs`, `.json`, and then `index.cow`/`mjs`/`js`/`ts`. Prefer explicit extensions. |
| Bare package/subpath, package `#imports` alias | Parent-aware package exports/imports and import conditions/patterns. Ordinary targets then load in the request VM. Unexported subpaths fail. |
| Relative, file URL, alias, package export, symlink | Canonical real file identity. The same instance within a request. Imports do not make helpers public files. |
| ESM `?query` / `#fragment` | Distinct ESM instances per request. Preserved in `import.meta.url`. JSON, CJS, and native entries reject variants explicitly. |
| Local or package JSON | Request-owned default export. `with: { type: 'json' }` is optional. Invalid/unknown attributes are rejected, even on cached modules. Object mutations do not save files. |
| Ordinary ESM exports | Live bindings, with no invented default. Shared static/dynamic dependencies, cycles, and top-level await. |
| Concurrent imports / failed evaluation | The same namespace or failure within the request. Fresh next request, including ordinary packages and CJS failed loads. |
| Native adapter entry | The exact canonical entry declared in package.json `cow.native`. Its native dependency graph persists. Functions use guarded views, and scalar exports are snapshots. Code changes require restart. |
| Node.js built-ins | Only the supported request-owned API views in the [language contract](language-contract.md#native-api-boundary). Raw process-level capabilities fail explicitly. |
| CJS `#imports` alias targeting a built-in | Node.js 22's `require` resolver rejects this form. Use direct `require('node:path')`, and so on. Local/package aliases are supported. |
| `.js` import when only `.ts` exists | Fails. There is no TS extension substitution, tsconfig paths, or custom loaders. |
| `data:`/`http:`/`https:` imports | `COW_MODULE_URL_UNSUPPORTED`. |
| `import.meta` | `url` is supplied. Node.js `resolve`/`dirname`/`filename` or custom CLI conditions are not promised. |

## Parsing and diagnostics

- Cow/JSP/TSP and ESM source parsing use pinned TypeScript 5.9.3.
- Static JSON import attributes work in both checkout and packed
  installations.
- Imported TS syntax errors and runtime stack frames report original source
  locations. Imported Cow helpers also map through their code tags to original
  lines/columns.
- Ordinary module reads enforce the configured source byte limit in the
  execution worker.

## Bundled helper resolution

Bundled helper resolution applies to imports handled by Cow's request loader,
including dynamic imports from CommonJS.

- Scripts that you run directly on the JavaScript runtime, editor type
  resolution, and native adapter dependency graphs use that runtime's normal
  package resolution. They need a resolvable Cow dependency.
- Other packages never fall back to Cow's private dependencies.

## Evidence

[Import tests](../test/import-compatibility.test.mjs),
[request conformance](../test/request-contract.test.mjs),
[hardening](../test/hardening.test.mjs), and
[runtime bounds](../test/runtime-bounds.test.mjs) cover these rules. The separate
[installed-package test](../test/package-install.mjs) checks the installed path.
The [runtime guide](runtimes.md) records Windows verification on Node.js, Bun,
Deno, and Nub, not every OS/version.

This is a Cow contract, not full Node.js or hostile-code compatibility.

## See also

- [Language contract](language-contract.md) for the request state and native
  API rules behind this matrix.
- [Request lifecycle](request-lifecycle.md) for when modules load and settle.
- [Pages and helpers](templates.md#share-code-with-helpers) for writing `.cow`
  helpers.
