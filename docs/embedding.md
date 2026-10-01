# Embedding Cow

[Documentation index](README.md)

This guide shows you how to run Cow pages from your own program with `CowApp`,
with or without a network listener. It also describes the HTTP contract that
the built-in server and embedded execution share.

## Run a page without a server

The dispatcher is independent of the built-in HTTP server. Your application can
execute requests without opening a network listener.

Save this as `site/report.cow`:

```jsp
<?js
const herd = ['Clover', 'Daisy', 'Buttercup']
?>
<h1>Herd report</h1>
<p><?= herd.length ?> cows: <?= h(herd.join(', ')) ?>.</p>
```

Then save this as `embed.mjs`, next to the `site` folder:

```js
import { CowApp } from '@cowlang/cow'

const app = new CowApp({ rootDir: './site' })
await app.initialize()

const result = await app.execute({
  id: 'job-1',
  method: 'GET',
  url: '/report',
  headers: {},
  body: Buffer.alloc(0)
})

if (result.kind === 'response') {
  console.log(result.response.status)
  console.log(Buffer.from(result.response.body).toString('utf8'))
}

await app.close()
```

Run `node embed.mjs`.

Output:

```text
200

<h1>Herd report</h1>
<p>3 cows: Clover, Daisy, Buttercup.</p>
```

### Read the result

`app.execute()` resolves to one of two results:

| `result.kind` | Returned for | What you get |
| --- | --- | --- |
| `'response'` | Page requests | `result.response`, a normalized response that contains `status`, `headers`, `body`, and `lifecycle` timing. |
| `'file'` | Static requests | `result.filePath`, for your program to deliver. |

Connection metadata defaults to unknown in embedded execution. The optional
`remoteAddress` and `scheme` inputs are described in
[Request metadata](runtime-api.md#request-metadata).

## Start a server from your program

To open the built-in HTTP listener, call `app.start()` instead of
`app.initialize()`. It resolves to the listening address. Save this as
`serve.mjs`:

```js
import { CowApp } from '@cowlang/cow'

const app = new CowApp({ rootDir: './site', port: 8000 })
const address = await app.start()
console.log(`Listening at ${address.url}`)
```

Run `node serve.mjs`.

Output:

```text
Listening at http://127.0.0.1:8000
```

The server runs until you call `await app.close()` or stop the process.

`CowApp` accepts the camelCase form of the CLI flags, such as `maxQueue` for
`--max-queue`. See [Server operations](operations.md) for each limit and its
default.

## Manage the app lifecycle

| Method | What it does | Concurrent calls |
| --- | --- | --- |
| `initialize()` | Starts the worker pools without a listener. | Share one initialization. |
| `start()` | Initializes the app and opens the listener. | Share one listener and return the same address. |
| `close()` | Cancels unfinished startup, stops the listener, and stops the pools. | Idempotent. Concurrent callers share one close. |

- `initialize()` and `start()` may overlap.
- While the app is closing, new `initialize()`, `start()`, and `execute()`
  calls reject with `COW_APP_CLOSING`.
- You must still await or catch startup promises.
- A late filesystem or DNS completion cannot revive a closed generation or
  overwrite a later one.
- After `await app.close()`, a new `start()` or `initialize()` creates fresh
  pools.
- A failed initial start cleans up its workers and permits retry.

> **Warning:** Closing does not undo committed writes.

Low-level `CowServer.start()` and `WorkerPool.start()` also coalesce. Calling
them during close rejects with `COW_SERVER_CLOSING` or `COW_RUNTIME_CLOSING`.

## Cancel a request

To cancel a request, pass an `AbortSignal`:
`app.execute(request, { signal })`.

Cancellation rejects with `COW_REQUEST_CANCELLED` and status 499. This applies
during routing, source reads, compilation, queueing, or execution, and to an
already-aborted signal. When Cow wraps the JavaScript runtime's abort errors
and caller-supplied reasons, it retains them as `cause`.

During execution, cancellation does not stop the page. Cow aborts the page's
`cow.signal` and lets it run to its end on the same worker, so a write in
progress completes. The execution timeout still ends a page that never
finishes.

> **Warning:** Cancellation never retries a request or rolls back writes that
> already committed.

## HTTP contract

### Methods and OPTIONS

Pages accept GET, HEAD, POST, PUT, PATCH, and DELETE. Your pages remain
responsible for narrower policies and authorization.

Cow handles OPTIONS without executing the page. It resolves the route first:

| Route | Response |
| --- | --- |
| Missing or private | 404 |
| Static | Advertises `GET, HEAD, OPTIONS`. |
| Page | Advertises the page methods plus OPTIONS. |
| `OPTIONS *` | Describes the server-wide method set. |

Unsupported methods on existing routes return 405 with `Allow`.

> **Note:** An OPTIONS response is not automatic CORS permission.

Cow's page API does not expose CONNECT tunnels, protocol upgrades, and
informational responses.

### HEAD requests

HEAD executes the page with method HEAD, including its normal cleanup, but
returns no body.

- The computed length describes the buffered representation.
- File helpers stat without reading.
- Dynamic streams skip iteration without inferring a length.
- For buffered pages, pages that branch on HEAD must keep their GET
  representation metadata consistent.
- Static files, errors, and diagnostics also support HEAD.
- The embedded page response has the same body and framing semantics. Static
  results still need your program to deliver the file.

Built-in diagnostic endpoints accept GET, HEAD, and OPTIONS. Other methods get
405. Cow does not buffer their uploads, and it closes their connections after
responding.

### Status codes and framing

`res.status()` accepts final statuses 200–599.

| Status | Body | Content-Length |
| --- | --- | --- |
| 204 | Discarded | Omitted |
| 205 | Discarded | Zero |
| 304 | Discarded | Omitted |
| Other buffered responses | Sent | Cow calculates the byte length and replaces the application's Content-Length. |

- Transfer-Encoding, Trailer, Connection, Keep-Alive, and Upgrade are
  transport-owned. Cow removes them from application responses.
- Node.js's HTTP parser rejects malformed input framing before page execution.
- This policy follows
  [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6)
  and does not expose application-supplied trailers.
- Explicit streaming uses transport-owned framing, and file output uses its
  measured length.

### Request bodies

| Call | Accepts | Errors |
| --- | --- | --- |
| `req.json()` | UTF-8 JSON, regardless of Content-Type. | Empty, malformed, or invalid UTF-8 input throws 400 `COW_INVALID_JSON`. |
| `form(req)` from `cow:web` | `application/x-www-form-urlencoded` only. Other types get 415. | Invalid percent escapes or UTF-8 throw 400 `COW_INVALID_FORM`. |

`form(req)` retains valid repeated fields. `field()` rejects duplicates and
non-text values when a scalar is required. For multipart fields and files, use
`await req.formData()` as described in
[Forms and file uploads](runtime-api.md#forms-and-file-uploads).

### Port selection

`--port 0` retries up to 16 OS-selected ports to avoid the
[Fetch blocked-port list](https://fetch.spec.whatwg.org/#port-blocking). If
every attempt selects a blocked port, startup fails with
`COW_PORT_SELECTION_FAILED`.

Cow never changes an explicit port. If you choose a blocked explicit port, it
can still prevent browser and fetch access.

## See also

- [Server operations](operations.md) for limits, shutdown, and status
  endpoints.
- [Request and response API](runtime-api.md) for `req`, `res`, and `cow`.
- [Output and errors](output-and-errors.md) for error pages and streaming.
- [JavaScript runtimes](runtimes.md) for runtime versions and limits.
