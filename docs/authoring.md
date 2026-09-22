# Authoring Cow pages and helpers

[Documentation index](README.md)

This guide shows you how to add types to helpers, and what Cow's type
declarations and editor extension can and cannot check for you.

Editor support is optional. Cow runs your pages the same way with or without
it.

## Write a helper

A helper is a code-only file, such as `_helpers.cow`. It uses the same `<?js`
and `<?ts` opening tags as pages. Export functions or
values, and import them from another page or helper. The final closing tag is
optional.

| To reuse | Use |
| --- | --- |
| Code-only modules | `import` |
| Rendered fragments | `include()` |

See the [helper examples](templates.md#share-code-with-helpers).

Tooling handles helpers in these ways:

- `cow check` handles both rendered pages and code-only helpers without
  execution.
- Highlighting understands the code tags.
- Standalone TypeScript does not directly parse `.cow` files or resolve their
  exports.
- There is no full Cow language server or type checker.

## Add types to helpers and libraries

The package provides declarations for these modules:

- `@cowlang/cow`
- `cow:runtime` and `@cowlang/cow/runtime`
- `cow:web` and `@cowlang/cow/web`
- `cow:sqlite` and `@cowlang/cow/sqlite`
- `cow:resource` and `@cowlang/cow/resource`
- `cow:csv` and `@cowlang/cow/csv`

The `cow:` declarations are ambient, so they resolve once any Cow declaration
entry is part of the program, for example through an `@cowlang/cow` import.

ESM/NodeNext and bundler-style module resolution can select their `types`
export conditions. The runtime targets are unchanged. These declarations
describe Cow APIs. They do not expose every Node.js API, and they do not turn
TypeScript annotations into runtime validation.

Save this as `_helpers.cow`:

```ts
<?ts
import type { CowRequest, CowResponse } from 'cow:runtime'

export function greeting(req: CowRequest, res: CowResponse) {
  res.json({ name: req.get('name') ?? 'visitor' })
}
```

The same helper can use plain JavaScript in `_helpers.cow`:

```js
<?js
/** @param {import('@cowlang/cow/runtime').CowRequest} req
 *  @param {import('@cowlang/cow/runtime').CowResponse} res */
export function greeting(req, res) {
  res.json({ name: req.get('name') ?? 'visitor' })
}
```

JSDoc types in plain JavaScript resolve through npm, so they use the package
spelling rather than `cow:runtime`.

To call either version, save this as `greeting.cow`:

```jsp
<?js
import { greeting } from './_helpers.cow'
greeting(req, res)
```

Open `/greeting?name=Clover`.

Output:

```json
{"name":"Clover"}
```

> **Note:** Page bindings are available only in pages and includes. Importing
> types does not put `req`, `res`, `cow`, `locals`, or `include` into a
> helper's global scope. Pass the values explicitly, as `greeting.cow` does.

`TemplateContext<Locals>` describes the complete page-binding shape for tools.
`cow:runtime` has no runtime values or side effects.

### What the types do not check

- Session and query result generics describe data that the application owns.
  They do not validate stored JSON or SQL results.
- Header commitment, path validity, positive limits, and supported native
  operations still have runtime checks.
- If a project chooses to install `@types/node`, that does not imply full
  Node.js API compatibility inside requests. The
  [language contract](language-contract.md) remains authoritative.
- `cow check` remains syntax-only. It does not type-check pages or helpers.

### How the declarations are tested

The [declaration tests](../test/declarations.test.mjs) use the pinned
TypeScript compiler with strict checking, no emit, and no ambient Node.js
declarations. They include valid TS/JSDoc helper examples and expected
failures for incorrect APIs.

## Use the optional editor package

The [local VS Code extension](../editor/vscode/README.md) supplies
highlighting, snippets, and basic page API suggestions for `.cow`, `.jsp`, and
`.tsp` files. Cow pages use TypeScript-aware highlighting for both code tags.

The extension is included in the Cow package, but you install it separately.
It does not type-check pages.

## Error locations

Runtime failures in imported Cow and TypeScript files use original source
locations. That includes dynamic imports, package imports, and async causes.

In development, HTTP failures include bounded, escaped cause details.
Production fallback pages hide those diagnostics.

> **Warning:** Custom site error pages receive `SiteError` diagnostics in
> either mode. Your error page must choose output that is safe to show
> visitors.

See [output and errors](output-and-errors.md).

## See also

- [Pages and helpers](templates.md) for tags, includes, and helper rules.
- [Request and response API](runtime-api.md) for `req`, `res`, and `cow`.
- [Language contract](language-contract.md) for the supported semantics.
