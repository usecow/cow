# Error pages, private files, and streaming

[Documentation index](README.md)

This guide shows you how to add a site-wide error page, send a private file
as a download, and stream output that your code generates.

You call all three from an ordinary page. A page that calls none of them stays
buffered, as before.

## Add a site-wide error page

To show your own page for errors, put `_error.cow` in the site's root.
`_error.jsp` and `_error.tsp` also work. Save this as `_error.cow`:

```jsp
<?js res.type('html') ?>
<!doctype html>
<h1><?= locals.error.status === 404 ? 'Page not found' : 'Something went wrong' ?></h1>
<p>Try again later.</p>
```

Open a URL that has no page, such as `/missing`. Cow responds with the status
404.

Output, with blank lines removed:

```html
<!doctype html>
<h1>Page not found</h1>
<p>Try again later.</p>
```

A page that throws an error gets the status 500 and the
`Something went wrong` heading.

> **Warning:** The site handler receives diagnostics **even in production**.
> Do not render `locals.error.message` or `locals.error.stack` to visitors
> unless the text is deliberately safe.

### What the handler receives

The handler receives `locals.error`. It is a bounded diagnostic snapshot with
`name`, `message`, `status`, optional `code`, `stack`, `cause`, `errors`, and
safe `headers`. The `SiteError` type from `cow:runtime` describes it.

The response starts in this state:

- The default status is the original 4xx or 5xx status. Otherwise, it is 500.
- Output starts empty, with `Cache-Control: no-store`.
- Cow preserves cookie, security, and authentication headers.
- Cow discards the failed page's success headers, redirects, and buffered body
  bytes.

The site can set its own status and headers.

Precedence is `_error.cow`, `_error.jsp`, then `_error.tsp`. No handler is
publicly routable, and Cow does not compile a handler when a healthy page is
requested.

### Which failures reach the handler

| Failure | What happens |
| --- | --- |
| Uncaught runtime, import, and include errors, and observed async failures | The handler runs in the original request's VM and module graph. |
| Routing and compilation errors | These occur before application execution, so the handler starts a fresh request VM. |
| Explicit responses, such as `res.status(404).send('Not found')` | Cow does not intercept them. Built-in OPTIONS and 405 responses also remain explicit responses. |
| HTTP parser, Host, body, and admission failures. Worker timeout, crash, and cancellation. Release and cleanup failures. | Cow uses the server fallback rather than starting another application request. |
| A failure after streaming starts | Cow closes the connection. There is no replacement page or second status line. |

When the handler runs in the original request's VM:

- Already evaluated helpers retain their request state.
- Failed imports remain failed.
- The handler can import helpers, include other files, and register cleanup.
- Cow never replays the original page.

### Cleanup and rollback

Resource release and request cleanup follow the handler. The release context
still records the original failure, and unfinished SQLite transactions roll
back.

Cow may render error output before this rollback. A handler that returns
success must still satisfy transaction guards. There is no automatic rollback
of already committed database writes, outbound requests, or filesystem work.

### When the handler is missing or fails

There is one handler attempt. When the handler is missing or broken, Cow uses
its fallback:

- The production fallback hides diagnostics.
- The development fallback escapes and bounds them.

Cow still logs original 5xx failures when a handler handles them. Logging
failures cannot break the response.

## Send a private file

To send a file that visitors cannot request directly, keep it in a private
folder and send it from a page. Put a file at `_files/report.txt`, then save
this as `report.cow`:

```jsp
<?js
// Perform your application's authentication and access check first.
res.type('text')
await res.download(__dirname + '/_files/report.txt', 'report.txt')
?>
```

Request `/report` with `curl -i`.

Output, with the date, connection, and request ID headers removed:

```text
HTTP/1.1 200 OK
content-type: text/plain; charset=utf-8
content-disposition: attachment; filename="report.txt"; filename*=UTF-8''report.txt
content-length: 15

Monthly report
```

For another file type, pass its media type, for example
`res.type('application/pdf')`.

| Signature | Description |
| --- | --- |
| `await res.sendFile(absolutePath)` | Sends a file without adding an attachment header. |
| `await res.download(absolutePath, filename?)` | Sends a file, and adds a download filename. The filename defaults to the path's basename. |

Both calls end the page, replace any uncommitted buffered prefix, and require
headers to remain mutable. Their default type is `application/octet-stream`.
Use `res.type(...)` explicitly when needed.

> **Warning:** **Never pass an unchecked request path to these APIs.** They
> do not perform authorization or path confinement. Select an authorized,
> server-owned path instead.

### Paths and filenames

- The path must be explicit and absolute. Regular files may be outside the
  site root.
- Symlinks follow normal filesystem rules.
- Missing files throw 404 before output.
- Download filenames reject paths and control characters. Cow uses an ASCII
  fallback plus UTF-8 `filename*` encoding, as defined by
  [Content-Disposition](https://www.rfc-editor.org/rfc/rfc6266.html#section-4.3).

### How Cow reads the file

Cow opens and stats the same handle, sends its measured length, reads bounded
chunks, and closes the handle on completion or failure.

- Cow excludes growth beyond the original length. An early EOF fails rather
  than silently completing.
- This is not an immutable file snapshot. If other writers exist, publish
  files atomically.
- A HEAD request validates and closes the file without reading its body, and
  preserves the length.
- Range and conditional requests, automatic MIME sniffing, and compression are
  not implemented for these calls. A Range request receives the complete
  response.

## Stream generated output

To send a large response in small pieces, pass an iterable to `res.stream()`.
Save this as `export.cow`:

```jsp
<?js
import { stringifyCsv } from 'cow:csv'
res.type('text/csv; charset=utf-8')
async function* exportRows() {
  yield stringifyCsv([['id', 'title']])
  for (const row of [{ id: 1, title: 'Hello' }, { id: 2, title: 'Cow' }]) {
    yield stringifyCsv([[row.id, row.title]])
  }
}
await res.stream(exportRows())
?>
```

Open `/export`.

Output:

```text
id,title
1,Hello
2,Cow
```

`res.stream` accepts a sync or async iterable of string or byte chunks. A Web
`ReadableStream` with an async iterator also fits. Raw Node.js streams are
still not exposed to ordinary modules.

Follow these rules:

- Set headers before you call `res.stream`, and **await** it. A missing
  `await` is an error, not an invitation to keep writing while the stream
  runs.
- Do not mix `echo`, `res.write`, or another terminal response into an active
  stream.
- A stream replaces uncommitted buffered output.

> **Warning:** Cow cannot take back bytes that it has already sent. Commit
> transactions and finish success-critical work before the first `yield`.

### Chunks, backpressure, and limits

- HTTP transport sends frames of at most 64 KiB and awaits acknowledgement
  after each write. This applies backpressure before Cow requests the next
  chunk. Files use 64 KiB reads.
- Streaming bypasses the total buffered-output limit. One transport chunk
  participates in aggregate admission accounting.
- Streaming does not cap the memory that your generator allocates itself.
  Generate large data in small chunks.
- The ordinary execution deadline still bounds slow readers and generators.
  A stream is not a durable job or an unlimited-lived event channel.

### Headers and status

Metadata commits when a stream is selected. HTTP headers go out with the first
nonempty chunk, or on successful empty completion.

- A generator failure before that point can use the site error page.
- Once the sink is offered headers, there is no second response, even if the
  sink rejects them.
- Cow owns framing. Dynamic stream length is unknown, and Cow ignores supplied
  `Content-Length` and `Transfer-Encoding` values. Files use the measured
  length.
- HEAD requests and the statuses 204, 205, and 304 do not consume the
  iterator. Cow calls `return()` when it is available.
- HEAD dynamic streams have no inferred length. 204 and 304 omit the length,
  and 205 uses zero.

### Failures and disconnects

- Guards run before streaming and before writes, but they cannot retract
  earlier bytes.
- Normal completion waits for iteration, resource release, and cleanup before
  it ends the HTTP stream.
- A late failure truncates and closes the stream, and Cow logs it. Bytes that
  the client already received, including a complete fixed-length file, cannot
  be undone.
- A client disconnect cancels the request, and Cow can terminate a running
  worker. JavaScript `finally` blocks and cleanup hooks are not guaranteed
  under hard termination.

`res.flush()` still commits **buffered metadata only**, not network bytes.
`echo`, `write`, `send`, JSON, and includes use buffered output.

## Embedded execution

`app.execute(request)` materializes streaming and file responses into its
ordinary buffer, with the usual output limit.

To consume a response incrementally, supply
`{ onStream: async message => { ... } }`:

- It receives one `start` message with `status`, `headers`, and an optional
  `contentLength`.
- It then receives `chunk` messages, with `body` as a `Uint8Array`.
- Cow awaits each call.
- Apply transport framing to the start metadata. It contains application
  headers, not a ready-made raw HTTP response.

Completion returns `response.streamed === true` and an empty `body`. Rejection
means that the sink must abort its output. The caller owns cancellation and
sink cleanup, and must not assume that streamed side effects can be rolled
back.

Static route results still use the separate `kind: 'file'` embedding contract.

## See also

- [Request and response API](runtime-api.md) for every `req`, `res`, and `cow`
  binding.
- [Request lifecycle](request-lifecycle.md) for cleanup order and cancellation.
- [Embedding](embedding.md) for `app.execute()`.
