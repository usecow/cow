# Page language and request contract

[Documentation index](README.md)

Cow is a web runtime for JavaScript and TypeScript with a file-oriented,
per-request workflow. This page states the precise rules that Cow follows: how
it reads pages and helpers, what state a request sees, what persists, and how
asynchronous work, output, and errors behave.

The rule behind most of this page: pages and helpers start with fresh
application state for each request. Cow supplies its own HTTP server. CGI is
not required.

Node.js, Bun, Deno, and Nub use the same Cow site files and APIs. The
[runtime support guide](runtimes.md) records runtime versions, testing, and
explicit differences. Choosing a runtime does not opt into a different page
language.

For a guided introduction with more examples, start with
[pages and helpers](templates.md).

## Page files and names

A page is HTML with code tags in it. `.cow` is the primary extension, and all
the code in one page compiles together as one TypeScript-capable source.

| Extension | Code tags | Echo tag |
| --- | --- | --- |
| `.cow` | `<?js` and `<?ts` | `<?=` |
| `.jsp` | JavaScript-only `<?js ?>` | `<?= ?>` |
| `.tsp` | TypeScript `<?ts ?>` | `<?= ?>` |

- Plain JavaScript needs no annotations. Types are erased, not fully checked.
- Extensionless routing prefers `.cow`, then `.jsp`, then `.tsp` for each
  candidate.
- Includes accept all three formats. Root error pages use the same format
  priority.
- The package is `@cowlang/cow`, the command is `cow`, and the page runtime
  binding is `cow`.

### Tags

Tags work inline or across lines. `<?js echo("hello"); ?>` and
`<p><?= 2 + 2 ?></p>` need no special formatting. Save this as `tags.cow`:

```jsp
<?js const title = 'Herd report' ?>
<h1><?= title; ?></h1>
<p><?js if (title) { ?>yes<?js } ?></p>
<p>2 + 2 is <?= 2 + 2 ?>.</p>
<p>[<?= null ?>]</p>
<p><?js echo("?>") ?></p>
```

Open `/tags`.

Output, with blank lines removed:

```html
<h1>Herd report</h1>
<p>yes</p>
<p>2 + 2 is 4.</p>
<p>[]</p>
<p>?></p>
```

The precise rules:

- Code blocks can span HTML (`<?js if (true) { ?>yes<?js } ?>`).
- Echo blocks contain one expression, not standalone statements, with an
  optional trailing semicolon (`<?= title; ?>`).
- Echoed `null` and `undefined` print as empty output, like PHP's echo. Other
  values convert with `String()`.
- The Cow lexer retains code context across tags, including
  regex-versus-division distinctions.
- `?>` inside a string, regex, `/* */` comment, or template
  literal/interpolation is inert. A `//` comment ends at `?>`, as in PHP.
- A final code block may omit `?>`. An echo block must close and must not be
  empty.
- A leading UTF-8 BOM is stripped, never rendered or compiled.
- Imports are preserved verbatim. Unused imports still load for their side
  effects, and only explicit `import type` is erased.

### Helpers and includes

To share code, import a helper. To share markup, call `include()`. See
[share code with helpers](templates.md#share-code-with-helpers) for worked
examples.

- Code-only helpers also use `.cow` and the same opening tags.
- ESM `import` loads their named/default exports, re-exports, and top-level
  awaits in the request's module graph.
- Whitespace around code tags has no output. HTML and echo blocks are rejected
  on import.
- `include()` renders a fragment using explicit locals. Rendered pages cannot
  declare exports.
- Page bindings are not module globals. Pass `req`, `res`, `cow`, or other
  values explicitly.
- `import.meta.url` identifies the helper itself.
- Ordinary JS/TS modules remain importable.

### Private files

Privacy is independent of the file format. HTTP paths containing an
underscore-prefixed file or directory are denied, while application imports
and includes can access those files. Cow source is never served as a static
asset.

> **Warning:** A public filename does not become private because another file
> imports it. To keep a helper private, start its name with `_`.

## One request, one application state

Every request starts from scratch. Nothing you store in a variable, a module,
or `globalThis` survives to the next request. Save this as `fresh.cow`:

```jsp
<?js
globalThis.visits = (globalThis.visits || 0) + 1
?>
<p>Visits: <?= globalThis.visits ?></p>
```

Open `/fresh`, then reload it as many times as you like.

Output, with blank lines removed:

```html
<p>Visits: 1</p>
```

The precise rules:

- Each request gets a new global environment and module graph.
- Pages, includes, relative helpers, package aliases, ordinary ESM/CommonJS
  packages, and their ordinary transitive dependencies share that graph.
- A resolved module runs once within the request.
- ESM exports are live bindings. CommonJS cycles see partial exports.
- A failed load or evaluation is remembered only for that request.
- Canonical file identity applies regardless of import spelling.
- ESM URL queries and fragments create separate instances, still within the
  same request.

See the [import matrix](import-compatibility.md) for exact resolution and CJS
rules.

Worker reuse and compiler caching must not change these semantics. Caching
compiled code is allowed. Caching ordinary evaluated application state between
requests is not. You do not need to disable caches or recycle workers after
every request.

## What can persist

Only what you store on purpose outlives a request. Files, database records,
and explicitly stored sessions persist intentionally.

- Cow's server and compiler machinery persists internally.
- Native adapters may reuse connections while providing request-scoped leases
  and facades.
- SQLite connection reuse does not reset all connection state. Temporary
  tables and non-managed settings remain the responsibility of the adapter or
  the application. Managed transaction cleanup is covered separately, in the
  [SQLite guide](sqlite-sessions.md).

### Native adapter entries

This section is an adapter-author contract, not website configuration.
`@cowlang/cow/sqlite` already supplies it.

An adapter package declares exact native entry files in package.json:

```json
{ "cow": { "native": ["./index.mjs"] } }
```

Those entries and their native imports are trusted worker extensions, not
ordinary application modules.

- They use native Node.js APIs and `defineResource` from
  `@cowlang/cow/resource`.
- A page cannot register resource definitions that would retain its closures.
- Native entry queries/fragments and CommonJS require are rejected explicitly.
- Native code changes require restart.

Values that cross the native boundary follow these rules:

- Native export scalars are snapshots at request import. Use functions to read
  changing adapter state.
- Native function exports and shared prototypes are read-only views.
- Adapters must not retain request values or launch unowned work.
- Callback handles crossing the boundary are disabled and detached from their
  request functions at cleanup.

This does not automatically manage arbitrary adapter code or native
allocations. Native adapters are fully trusted code.

## Asynchronous work and failure

Cow drains the work that it accepted from a request before it releases the
request's resources, whether rendering succeeded or failed. Cow never replays
a request.
For a worked `cow.track()` example, see the
[request lifecycle](request-lifecycle.md#finish-work-before-the-request-ends).

### What Cow drains

Successful and failed rendering both drain the following before releasing
resource leases:

- Accepted imports, evaluations, and includes
- Supported native promises
- Filesystem callbacks
- The supported crypto callbacks

`cow.track()` supplies a barrier for composite work that must finish despite
another operation failing. It is not rollback or automatic error handling.

New imports, includes, explicit tracking, and cleanup registrations are sealed
once rendering ends. Already accepted native continuations may finish.

### Timers, fetches, and cleanup

- Global timers and `node:timers` share tracked handles.
- Callback timers are cancelled at cleanup. They are not background jobs.
  Promise delays are drained.
- Fetches use request cancellation. Execution deadlines bound outstanding
  work.
- Cleanup hooks run after resource release, and their accepted native work
  also drains.
- Hung work replaces its worker.
- Cancellation and crashes never replay a request. External writes may already
  have happened and are not automatically undone.

### Rejections and callback failures

Before returning a response or reusing a worker, a rejection checkpoint lets
Node.js report outstanding unhandled promises for that request.

| Failure | Error code |
| --- | --- |
| Ignored rejected operations | `COW_UNHANDLED_REJECTION` |
| Asynchronous callback failures in timers, filesystem/crypto callbacks, nextTick, and microtasks | `COW_ASYNC_CALLBACK_FAILED` |

- Failures during cleanup remain cleanup errors.
- Failures caught by application code before completion are not reported as
  unhandled.
- Returning a rejected callback to a native consumer such as a managed
  transaction preserves that consumer's normal catch/rollback semantics.

### What Cow does not detect

This diagnoses observed failures, not every missing await.

- An unawaited include that tries to write after response completion fails.
  Cow does not implicitly await its output or rerun the page.
- A never-settling ordinary promise with no accepted native work is not a
  background job or guaranteed completion barrier.
- Use explicit await/Promise.all and `cow.track` where a completion barrier is
  needed.

## Response output and site errors

A normal page buffers its output, and Cow sends it when the page finishes. To
send bytes earlier, await one of the three streaming calls.

### Buffered and streaming output

- Normal pages buffer output. `flush`/`commit`/`write` commit metadata but do
  not send network bytes.
- Explicit awaited `res.stream`, `res.sendFile`, and `res.download` provide
  terminal streaming output with bounded transport frames and backpressure.
- The streaming calls require mutable headers, replace uncommitted output, and
  keep the request alive through normal release/cleanup.
- Late errors cannot replace bytes already sent.
- Cancellation aborts `cow.signal` and lets the page finish on its worker;
  only the execution timeout terminates a worker. Committed writes and
  transmitted bytes cannot be undone.

### Site error pages

An optional root `_error.cow` (or `_error.jsp` / `_error.tsp`) handles
routing, compilation, and uncaught runtime/async failures.

- Runtime failures retain the same request graph. There is no replay,
  recursive handler, or automatic transaction commit.
- Errors before execution get a fresh handler VM.
- Resources release with the original failure outcome.
- Explicit status responses are not intercepted.
- Protocol/body/admission failures, timeouts/crashes/cancellation, and
  release/cleanup failures use the safe server fallback.
- Errors after streaming starts abort the connection.

See [the complete output/error contract](output-and-errors.md) for author
examples, diagnostic privacy, HEAD/framing, private-path authorization, and
embedding rules.

## Forms and upload lifetime

`await req.formData()` exposes text fields and upload objects without a setup
file or application framework. Uploads live in memory and belong to the
request. If you do not save an upload, it is gone when the request ends.

Form fields:

- `req.formData()` accepts URL-encoded and multipart forms.
- Repeated and bracketed names remain literal ordered entries, not implicit
  PHP arrays.
- `field()` rejects duplicate or non-text scalar values.
- Metadata and decoded text still need application validation.

Uploads:

- Uploads are buffered, request-owned values, not persistent worker resources.
- Unsaved bytes remain in memory until cleanup and cannot be read or saved
  through expired request handles. Worker termination also discards them.
- Saving requires an explicit absolute destination and refuses to overwrite an
  existing file.
- An accepted save drains like other filesystem work. It is not transactional
  with the response. Later failure or cancellation cannot undo it, and
  interrupted filesystem writes can leave partial destinations.
- No temporary-disk spooling or streaming is implemented.
- Whole-body admission and per-form/file limits apply. See the
  [upload API](runtime-api.md#forms-and-file-uploads) for exact boundaries.

## Connection and host metadata

Request metadata describes the connection that reached Cow directly, not what
a proxy or a header claims. Forwarded headers never change it.

`req.address()` and `req.scheme()` describe the direct connection.

- The ordinary server snapshots its socket peer and transport.
- Embedded execution accepts an explicit `remoteAddress` IP and `scheme`
  (`http`/`https`).
- Missing values are `null`, never guessed from a URL, listener, or previous
  request.

`req.host()` is the syntactically validated Host authority.

- It retains an explicit port and lowercases host letters.
- It returns `null` for an absent or empty Host.
- Malformed or duplicate Host values fail with 400 before page execution. Raw
  header spelling remains available.
- See the [metadata API](runtime-api.md#request-metadata) for the accepted
  syntax.

> **Warning:** `req.host()` is still client input, not a trusted site origin.
> Validation checks its syntax only.

Proxies:

- Forwarded headers and absolute request targets cannot override these values.
- A proxy remains the direct peer. TLS terminated upstream does not make the
  Cow-side HTTP connection HTTPS.
- There is no automatic proxy trust, public-origin configuration, or change to
  session security.
- A trusted embedding transport owns any explicit upstream normalization.
- Includes share the same request snapshot.

## Native API boundary

A page reaches Node.js built-ins through request-owned views, and only the
built-ins listed here. Anything that needs process-level power belongs in a
native adapter.

> **Warning:** Cow runs trusted server code. No hostile-code sandbox, tenant
> isolation, or PHP source compatibility is promised.

### Request-owned views

- VM intrinsic objects are request-owned.
- Cow-provided native constructors, namespaces, functions, and prototypes have
  read-only views.
- Returned plain data is copied into the request realm. Native instances use
  guarded views.
- This is not full Node.js reflection compatibility. For example, freezing a
  guarded native instance is unsupported.
- Binary buffers and views work with Cow response APIs and native argument
  conversion.

### `process`

`process` and `node:process` share one request object.

- `env` and `argv` are copies. Changing them does not configure later
  requests.
- Information, cwd, timing, nextTick, and explicit exit are available.
- Exit fails the request and replaces its worker.
- Raw bindings, loaders, process listeners, and chdir are unavailable.
- Object-URL registries and process priority changes are unsupported.

### Supported built-ins

The `node:` prefix is optional. Supported built-in roots:

| Root | Also supported |
| --- | --- |
| `assert` | `assert/strict` |
| `buffer` | |
| `crypto` | |
| `fs` | `fs/promises` |
| `os` | |
| `path` | `path/posix`, `path/win32` |
| `process` | |
| `querystring` | |
| `timers` | `timers/promises` |
| `url` | |
| `util` | `util/types` |

Limits within those built-ins:

- Filesystem watches, streams, and open handles require an adapter. Use
  complete read/write operations in pages.
- Crypto engine/FIPS mutation is unsupported.
- Promise timers expose setTimeout and setImmediate, not recurring async
  iterators.
- Automatic crypto callback draining covers scrypt, pbkdf2, randomBytes,
  randomFill, generateKey, generateKeyPair, hkdf, sign, and verify.

### Unsupported built-ins

Packages importing worker_threads, vm, module, raw sqlite, http/net servers,
or child_process fail with `COW_NATIVE_API_UNSUPPORTED`. Evaluate a resource
adapter. Do not silently mark the whole application native. Embedding APIs
belong outside page execution.

## Syntax baseline

Cow parses every page with one pinned TypeScript parser version. What runs
after that depends on the runtime.

- Cow pins TypeScript parser **5.9.3** for Cow/JSP/TSP and ordinary ESM source
  validation. A different installed parser fails with `COW_PARSER_VERSION`.
- Cow, TSP, and .ts helpers transpile to ES2022 ESM. There is no full type
  checking or tsconfig-driven resolution.
- Imported Cow/TS syntax errors include file/line/column. Runtime stack
  locations map to their original source, including async causes.
- JavaScript execution depends on the selected runtime's supported features.

### `cow check`

`cow check [path]` checks pages and local helpers without evaluating site
code.

- It shares the compiler/module transformation rules and also performs a
  parse-only JavaScript check.
- It does not resolve imports, check types, or prove that runtime APIs will
  succeed.
- Selection rules and exit codes are in the
  [checker guide](getting-started.md#check-a-site-without-running-it).

## Evidence

These tests cover the contract:
[request conformance](../test/request-contract.test.mjs),
[import compatibility](../test/import-compatibility.test.mjs),
[integration](../test/integration.test.mjs), and the separate
[independent package installation](../test/package-install.mjs) checks.

## See also

- [Pages and helpers](templates.md) for a guided tour of tags, includes, and
  helpers.
- [Request lifecycle](request-lifecycle.md) for the order of events in one
  request.
- [Import compatibility](import-compatibility.md) for exact module resolution
  rules.
- [Output and errors](output-and-errors.md) for error pages and streaming.
