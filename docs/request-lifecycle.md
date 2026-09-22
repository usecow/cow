# Request lifecycle

[Documentation index](README.md)

This page follows one request through Cow, from admission to cleanup. It
explains what that order means for your modules, your asynchronous work, and
anything that has to outlive a request.

Cow workers are persistent, but request execution is fresh. Every request
starts from scratch, and nothing you store in a variable or a module survives
to the next request.

Save this as `_counter.cow`:

```ts
<?ts
let count = 0

export function bump(): number {
  count += 1
  return count
}
```

Then save this as `visits.cow`:

```jsp
<?js
import { bump } from './_counter.cow'
globalThis.visits = (globalThis.visits || 0) + 1
?>
<p>Helper counter: <?= bump() ?>, then <?= bump() ?>.</p>
<p>Global counter: <?= globalThis.visits ?>.</p>
```

Open `/visits`, then reload it. Within one request, the helper keeps its
state. On the next request, both counters start over.

Output, with blank lines removed, on every request:

```html
<p>Helper counter: 1, then 2.</p>
<p>Global counter: 1.</p>
```

To count visits across requests, store the number in a file, a database, or a
session.

## Steps of a request

1. Cow admits the request before buffering its body or compiling a page.
   The router resolves its public URL to a page or static file.
2. Cow reuses a compiled page when its source is unchanged.
3. A ready worker creates a fresh VM context and local module graph.
4. The page runs with immutable request metadata and a buffered response
   by default. Explicit awaited file/stream output can send incrementally.
5. Cow finalizes output and, for buffered failures, tries an optional error page.
6. Already-admitted imports, includes, module evaluations, and `cow.track()`
   operations settle, even if rendering failed. Then persistent resource
   leases are released before the result leaves the worker.
7. Registered request cleanup callbacks run.
8. Timers and fetches created through Cow's global wrappers are cancelled.
9. The worker becomes available for another request or is recycled.

## Response phases

You can change the status and headers until the response is committed. After
that, you can only add body output.

| `res.phase` | What you can change | How the response gets here |
| --- | --- | --- |
| `buffering` | Status, headers, and body. | Every response begins here. |
| `committed` | Body only. Header changes are rejected. | You call `commit()`, `flush()`, or `write()`. |
| `finished` | Nothing. | You call `send()`, `end()`, `json(value)`, or `redirect()`, or the page completes normally. |

Save this as `phases.cow`:

```jsp
<?js
res.setHeader('x-herd', 'clover')
echo('<p>Before commit.</p>\n')
res.commit()
echo('<p>After commit.</p>\n')
try {
  res.setHeader('x-late', 'yes')
} catch (error) {
  echo(`<p>${h(error.code)}</p>\n`)
}
?>
```

Open `/phases`. The response carries the `x-herd` header, but not `x-late`.

Output:

```html
<p>Before commit.</p>
<p>After commit.</p>
<p>COW_HEADERS_COMMITTED</p>
```

### Buffered and streaming output

Ordinary output remains buffered until execution completes. `flush()` commits
metadata only.

To stream, await one of these calls:

- `res.stream(iterable)`
- `res.sendFile(absolutePath)`
- `res.download(absolutePath, filename?)`

They require mutable headers, replace uncommitted buffered output, and end the
page. Once bytes reach the client, errors cannot replace them.

An optional root `_error.cow` (or `_error.jsp`/`_error.tsp`) handles uncaught
failures before streaming starts, with `locals.error` diagnostics and a safe
fallback. See
[output, private files, and error pages](output-and-errors.md).

## Module lifetime

Local application module state is request-scoped. Long-lived resources are
owned by Cow-aware adapter packages rather than hidden in application module
globals. See [lifetime boundary](#lifetime-boundary) and the
[persistent resources guide](resources.md).

Imports follow these rules:

- Relative helpers, package.json `#imports` aliases, and ordinary ESM/CommonJS
  packages all use the same request lifetime.
- The resolved file, not the spelling of its import, determines identity.
- Package ESM bindings stay live.
- `.cjs` is supported. `.js` follows its nearest package's `type` (CommonJS by
  default).

See the [import compatibility matrix](import-compatibility.md) for exact
resolution, CJS/ESM, JSON, symlink, TypeScript, and native-export limits.

Imports that overlap in time behave predictably:

- Concurrent imports of the same local module share its instance within that
  request, including shared static dependencies.
- Dynamic imports wait for module evaluation, including top-level await.
- Await imports and other request work. Ordinary package dependencies execute
  in that same request graph.

## Finish work before the request ends

A request owns the work that it starts. When rendering completes or fails,
Cow stops accepting new work, waits for the work it already accepted, and
then releases resources.

On render completion or failure:

- Cow stops accepting new imports, includes, tracked operations, and cleanup
  registrations.
- Cow drains accepted work before releasing resource leases.
- A failed static import graph also drains sibling top-level evaluations.
- Each loader and sandbox callback retains its original request scope. It
  cannot attach to the next request.
- Late work is rejected with `COW_REQUEST_ENDED`.
- A stuck drain is bounded by the execution timeout.

### Keep operations alive with `cow.track()`

Use `await Promise.allSettled(...)` when all operations must finish despite one
failure. When native/package promises could outlive a rejected `Promise.all`,
register them immediately with `cow.track()`:

```js
const saving = cow.track(saveDraft())
await Promise.all([saving, anotherOperation()])
```

Tracking supplies a settlement barrier, not rollback or automatic error
handling. Still await and handle each operation.

### What Cow tracks for you

- Supported filesystem operations, crypto callbacks, and native promises are
  observed automatically.
- Global and imported callback timers are cancelled at cleanup.
- Arbitrary detached work inside trusted native adapters still requires
  explicit ownership and cleanup.

> **Warning:** Do not start background jobs in a request. Cow cancels callback
> timers at cleanup. Use an external job runner for that work.

## Lifetime boundary

Ordinary packages are request-scoped. Anything that must live longer than a
request needs a native adapter or explicit storage.

- Supported Node.js built-ins are exposed through request-owned views with
  read-only shared namespaces/prototypes. `process.env` is a request-local
  snapshot.
- Process-level loaders, servers, workers, and raw database handles require a
  native adapter, not an ordinary page import. See the
  [language contract](language-contract.md#native-api-boundary) for the
  supported set.
- Do not store sessions in ordinary globals.
- Sessions in the [news example](../examples/mininews/README.md) live
  explicitly in SQLite and have no dependency on which worker handles a
  request.

> **Note:** SQLite connection state beyond transactions and the documented
> PRAGMAs can survive reuse (for example, temporary tables). Persistence is
> not an invisible reset.

### Run each request on a clean worker

For a clean worker between requests, use `--max-requests 1`. Tests compare
that baseline with worker reuse. It incurs worker startup cost and disables
cross-request resource reuse. It is not a sandbox for hostile code.

## Trust model

Cow application code is trusted server code.

> **Warning:** VM contexts and worker threads provide lifecycle control and
> failure isolation. They are not a security sandbox for hostile code.

## See also

- [Language contract](language-contract.md) for the precise request and
  native API rules.
- [Import compatibility](import-compatibility.md) for how each kind of import
  resolves.
- [Persistent resources](resources.md) for connections that outlive a request.
- [Output and errors](output-and-errors.md) for error pages and streaming.
