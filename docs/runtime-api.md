# Request and response API

[Documentation index](README.md)

This reference lists every binding that a Cow page can use to read the
request, write the response, and clean up afterward. Find a binding in the
overview table, then follow the link to its group for the signature, the
return value, and an example.

Every page and include receives these bindings. Helpers do not. To use `req`,
`res`, or `cow` in a helper, pass it to the helper function as an argument.

## Bindings at a glance

| Group | Bindings | Use them to |
| --- | --- | --- |
| [Output](#output) | `echo()`, `h()`, `include()`, `die()` | Print values, escape HTML, render includes, and stop the page. |
| [Request](#request) | `req.url()`, `req.method()`, `req.headers()`, `req.header()`, `req.id()`, `req.address()`, `req.scheme()`, `req.host()`, `req.params()`, `req.get()`, `req.getAll()`, `req.body()`, `req.text()`, `req.json()`, `req.formData()` | Read the URL, the headers, the query string, and the body. |
| [Response](#response) | `res.status()`, `res.setHeader()`, `res.getHeader()`, `res.removeHeader()`, `res.type()`, `res.write()`, `res.commit()`, `res.flush()`, `res.end()`, `res.send()`, `res.json()`, `res.redirect()`, `res.stream()`, `res.sendFile()`, `res.download()`, `res.phase`, `res.headersSent`, `res.finished`, `res.statusCode` | Set the status and headers, and finish the response. |
| [Lifecycle](#lifecycle) | `cow.signal`, `cow.onCleanup()`, `cow.track()`, `cow.info()`, `cow.requestId` | React to cancellation, register cleanup work, and show diagnostics. |

Longer topics have their own sections:

- [Diagnostics](#diagnostics): the `cow.info()` page and JSON report.
- [Request metadata](#request-metadata): `req.address()`, `req.scheme()`,
  `req.host()`, and the Host header rules.
- [Forms and file uploads](#forms-and-file-uploads): `req.formData()`, upload
  objects, limits, and error codes.

## Output

| Signature | Description | Returns |
| --- | --- | --- |
| `echo(...values)` | Appends values to the response body. Cow converts each value with `String()` and joins multiple values with one space. `null` and `undefined` append nothing, as in PHP. | Nothing. |
| `h(value)` | Escapes a value for HTML text and quoted attribute values. | The escaped string. `null` and `undefined` return an empty string. |
| `include(path, locals)` | Renders a local `.cow`, `.jsp`, or `.tsp` file into the same response. See [reuse markup with includes](templates.md#reuse-markup-with-includes). | A promise. Await it. |
| `die()` | Stops the page. Cow still sends the output that the page has buffered. | Does not return. |

A page also receives `locals` (the values passed to `include()`),
`__filename`, and `__dirname`.

### `h(value)`

Escapes `&`, `<`, `>`, `"`, and `'`, so the result is safe in HTML text and
inside a quoted attribute value.

Save this as `escape.cow`:

```jsp
<p title="<?= h(req.get('q')) ?>">You searched for <?= h(req.get('q')) ?>.</p>
```

Open `/escape?q=<b>"hay"</b>`.

Output:

```html
<p title="&lt;b&gt;&quot;hay&quot;&lt;/b&gt;">You searched for &lt;b&gt;&quot;hay&quot;&lt;/b&gt;.</p>
```

When `q` is missing, `h(undefined)` returns an empty string, and the page
prints `You searched for .`

### `echo(...values)`

Save this as `echo.cow`:

```jsp
<?js
echo('Hello,', 'Clover')
echo(null)
echo(undefined)
echo(' and', 2 + 2)
?>
```

Open `/echo`.

Output:

```html
Hello, Clover and 4
```

Cow joins the values inside one call with a space. It adds nothing between
separate calls.

## Request

| Signature | Description | Returns |
| --- | --- | --- |
| `req.url()` | Returns the request target, including the query string. | A string, for example `/search?tag=hay`. |
| `req.method()` | Returns the HTTP method. | A string, for example `GET`. |
| `req.headers()` | Returns every request header. | A read-only object with lowercase header names. |
| `req.header(name)` | Returns one request header. The name is not case-sensitive. | The header value, or `undefined` when the header is absent. |
| `req.id()` | Returns the ID of this request. It matches `cow.requestId` and the `x-request-id` response header. | A string. |
| `req.address()` | Returns the IP address of the direct socket peer. See [request metadata](#request-metadata). | A string, or `null` if unavailable. |
| `req.scheme()` | Returns the connection transport. See [request metadata](#request-metadata). | `'http'`, `'https'`, or `null` if unknown. |
| `req.host()` | Returns the parsed Host header. See [request metadata](#request-metadata). | A string, or `null` when the header is absent or empty. |
| `req.params()` | Returns the first value of each query parameter. | A read-only object. A missing key is `undefined`. |
| `req.get(name)` | Returns the first value of one query parameter. | A string, or `undefined` when the parameter is missing. |
| `req.getAll(name)` | Returns every value of one query parameter, in URL order. | An array of strings. It is empty when the parameter is missing. |
| `req.body()` | Returns the request body as bytes. | A byte buffer. |
| `req.text()` | Returns the request body decoded as UTF-8 text. | A string. |
| `req.json()` | Parses the request body as JSON. It throws 400 `COW_INVALID_JSON` when the body is not valid UTF-8 JSON. | The parsed value. |
| `await req.formData(options)` | Reads form fields and request-owned file uploads. See [forms and file uploads](#forms-and-file-uploads). | A promise for a read-only, FormData-style view. |

### `req.get(name)`, `req.getAll(name)`, and `req.params()`

Save this as `search.cow`:

```jsp
<?js
const tags = req.getAll('tag')
?>
<p>First tag: <?= h(req.get('tag')) ?></p>
<p>Also first: <?= h(req.params().tag) ?></p>
<p>All tags: <?= h(tags.join(', ')) ?></p>
<p>Missing: <?= h(req.get('page')) ?> (<?= req.getAll('page').length ?> values)</p>
```

Open `/search?tag=hay&tag=barn`.

Output, with blank lines removed:

```html
<p>First tag: hay</p>
<p>Also first: hay</p>
<p>All tags: hay, barn</p>
<p>Missing:  (0 values)</p>
```

When a parameter repeats, as in `?id=first&id=last`, both `req.get('id')` and
`req.params().id` return `first`. `req.getAll('id')` returns
`['first', 'last']`. A missing key returns `undefined` through `get()` and an
empty array through `getAll()`.

Choose one of these rules, first value or every value, and use it in both
your validation and your data access. Otherwise, the value that you check may
not be the value that you store.

### `req.formData(options)`

Save this as `contact.cow`:

```jsp
<?js
import { field } from 'cow:web'

if (req.method() === 'POST') {
  const values = await req.formData()
  const name = field(values, 'name')
  res.send(`<p>Thanks, ${h(name)}!</p>`)
}
?>
<form method="post">
  <label>Name <input name="name"></label>
  <button>Send</button>
</form>
```

Open `/contact`, type `Clover`, and submit the form.

Output:

```html
<p>Thanks, Clover!</p>
```

For file uploads, limits, and error codes, see
[forms and file uploads](#forms-and-file-uploads).

## Response

Cow buffers a page's output by default. A response moves through three phases:
`buffering`, `committed`, and `finished`. You can change the status and the
headers only while the response is buffering.

### Set the status and headers

| Signature | Description | Returns |
| --- | --- | --- |
| `res.status(code)` | Sets the status code. The code must be an integer from 200 to 599. Any other value throws a `RangeError`. | `res`, so that you can chain calls. |
| `res.setHeader(name, value)` | Sets a response header. `res.header(name, value)` does the same. | `res`. |
| `res.getHeader(name)` | Returns a response header that the page has set. | The value, or `undefined` when the header is not set. |
| `res.removeHeader(name)` | Removes a response header. | `res`. |
| `res.type(value)` | Sets the `content-type` header. The aliases `html`, `json`, and `text` select `text/html`, `application/json`, and `text/plain`, each with `charset=utf-8`. | `res`. |

After the response is committed, `res.status()`, `res.setHeader()`,
`res.removeHeader()`, and `res.type()` throw an error with the code
`COW_HEADERS_COMMITTED`.

### Write and commit

| Signature | Description | Returns |
| --- | --- | --- |
| `res.write(value)` | Appends output and commits the response metadata. | `res`. |
| `res.commit()` | Commits the response metadata without finishing the response. | `res`. |
| `await res.flush()` | Commits the response metadata without finishing the response. It commits buffered metadata only, not network bytes. | A promise. |

### Finish the response

Each of these calls ends the page. Code after the call does not run.

| Signature | Description |
| --- | --- |
| `res.end(value)` | Finishes the response. If you pass a value, Cow appends it to the buffered output. |
| `res.send(value)` | Finishes the response, and replaces the buffered output with the value. |
| `res.json(value)` | Selects the JSON content type, replaces the buffered output with `JSON.stringify(value)`, and finishes the response. |
| `res.json()` | Without a value, only selects the JSON content type. It does not finish the response, and it returns `res`. |
| `res.redirect(location, status)` | Sets the `location` header and the status, and finishes the response with an empty body. The status defaults to 302. |
| `await res.stream(source)`, `await res.sendFile(path)`, `await res.download(path, filename)` | Stream generated output or send a file. See [output and errors](output-and-errors.md). |

### Response state

| Property | Value |
| --- | --- |
| `res.phase` | `'buffering'`, `'committed'`, or `'finished'`. |
| `res.headersSent` | `true` after the response is committed. |
| `res.finished` | `true` after the response is finished. |
| `res.statusCode` | The current status code. An ordinary page starts at 200. |

### `res.json(value)`

Save this as `status.cow`:

```jsp
<?js
res.json({ ok: true, herd: ['Clover', 'Daisy'] })
?>
```

Open `/status`. Cow sends the header
`content-type: application/json; charset=utf-8`.

Output:

```json
{"ok":true,"herd":["Clover","Daisy"]}
```

### `res.redirect(location, status)`

Save this as `old.cow`:

```jsp
<?js
res.redirect('/status')
?>
```

Request `/old` with `curl -i`. The response has no body.

Output, showing the status line and the `location` header only:

```text
HTTP/1.1 302 Found
location: /status
```

For a permanent redirect, pass the status: `res.redirect('/status', 301)`.
The status line becomes `HTTP/1.1 301 Moved Permanently`.

## Lifecycle

| Binding | Description |
| --- | --- |
| `cow.signal` | An `AbortSignal` that is aborted when the request is torn down. |
| `cow.onCleanup(callback)` | Registers request-owned cleanup work. `cow.defer(callback)` does the same. |
| `cow.track(promise)` | Keeps a native or package operation in the request's drain barrier. To handle its result or rejection, await the returned promise. |
| `cow.info(options)` | Finishes the response with a diagnostic report. See [diagnostics](#diagnostics). |
| `cow.requestId` | The ID of this request, as a string. |

For the order in which Cow drains tracked work and runs cleanup callbacks, see
[request lifecycle](request-lifecycle.md).

### Global `fetch()`

The global `fetch()` wrapper preserves a `Request` object's abort signal unless
`init.signal` explicitly overrides it, including with `null`. Cow's teardown
cancellation still applies even when an application supplies its own signal.

## Diagnostics

To see what Cow is running on, create `info.cow` in your site:

```jsp
<?js cow.info() ?>
```

Open `/info`. The report shows:

- The Cow, runtime, engine, and TypeScript versions.
- The effective settings.
- The supported modules.
- Anonymous request and worker counts.

For the same report as JSON, call `cow.info({ format: 'json' })`. Both forms
end the page, so call them before you commit headers. Cow creates no
diagnostic page automatically.

The report omits environment variables, filesystem paths, request values,
cookies, credentials, and resource keys.

> **Warning:** Protect or remove the page after use. The report sets
> `no-store` and `noindex`, but these are not access controls.

See the [diagnostic example](../examples/info/README.md).

## Request metadata

`req.address()`, `req.scheme()`, and `req.host()` describe the direct
connection and the Host header of the request. To inspect them, save this
read-only page as `metadata.cow` in any site directory:

```jsp
<?js
// This describes the direct connection, not a forwarded or public site origin.
// Host remains client input. Do not use it to build password-reset links.
res.setHeader('cache-control', 'no-store');
res.json({
  address: req.address(), // for example "127.0.0.1" or "2001:db8::2"
  scheme: req.scheme(),   // "http", "https", or null
  host: req.host()        // for example "example.test:8000", or null
});
?>
```

Open `/metadata` to see the values for your request. The page writes no
application data.

Output, for a local request to a server on the default port:

```json
{"address":"127.0.0.1","scheme":"http","host":"127.0.0.1:8000"}
```

| Binding | Source and meaning |
| --- | --- |
| `req.address()` | The direct socket peer IP, without a port. It is `null` if unavailable. Cow preserves IPv6 and IPv4-mapped IPv6 spellings. It is not necessarily the visitor's address. |
| `req.scheme()` | The connection transport: `http` or `https`. It is `null` if unknown. The built-in CLI server speaks HTTP. An embedding transport may supply HTTPS. |
| `req.host()` | The parsed Host header authority, including an explicitly supplied port. It is `null` when the header is absent or empty. This remains client-supplied input, not a configured site origin or proof of identity. |

> **Warning:** `req.host()` is client-supplied input. Do not use it to build
> password-reset links or other security-sensitive absolute links. Behind a
> reverse proxy, `req.address()` is the proxy's address, not the visitor's.

### Accepted host syntax

Cow normalizes the Host value:

- It lowercases hostnames and IPv6 hex letters.
- It removes leading zeros from decimal ports.
- It retains an explicit `:80` or `:443`.

Accepted host syntax is ASCII letters, digits, dots, underscores, and hyphens,
or a bracketed IPv6 literal, with an optional decimal port from 0 to 65535. Use
punycode for international domain names.

Cow does not accept IPv6 zone identifiers, user info, lists, URL paths, or
whitespace. It does not apply URL repair or percent decoding. The entire
authority is limited to 1,024 characters. This is syntax validation, not a DNS
lookup or a host allowlist.

### Invalid and missing Host headers

Duplicate or malformed Host values reject with 400 `COW_INVALID_HOST` before
Cow buffers a body or runs site code.

- The HTTP server validates Node.js's distinct header view, so duplicate lines
  cannot silently select the first host.
- HTTP parsing handles outer header whitespace. Embedded callers should pass
  already parsed values.
- The original parsed header spelling remains available through
  `req.header('host')`.
- HTTP/1.0 requests without a Host header return `null`. Cow never substitutes
  its listening address or the internal `cow.local` parsing base.

### Forwarded headers and reverse proxies

`Forwarded`, `X-Forwarded-*`, and `X-Real-IP` do not change these bindings. An
absolute request target in `req.url()` also does not change them. `host()`
specifically reports the Host header, and `scheme()` reports the connection,
not the target URL. Routing and raw URL and query access otherwise keep their
existing behavior.

Behind a reverse proxy, `address()` describes that proxy. If the proxy
terminates TLS and forwards plain HTTP to Cow, `scheme()` is `http`.

There is no implicit trusted-proxy mode and no `trustProxy: true` switch. A
trusted embedding adapter may supply connection metadata after it applies its
own explicit trust policy. Do not copy untrusted forwarded values blindly.

Prefer an application-chosen canonical origin for security-sensitive absolute
links, and set session cookie security deliberately. These bindings do not
configure public URLs, virtual hosts, HTTPS, redirects, session cookies, or
deployment.

### Supply metadata to embedded execution

Embedded `app.execute()` calls can supply `remoteAddress` and `scheme`
alongside the existing headers. They default independently to `null`. Cow
infers nothing from `headers.host`, a URL, or forwarded headers:

```js
const result = await app.execute({
  url: '/report',
  remoteAddress: '2001:db8::2',
  scheme: 'https',
  headers: { host: 'example.test:443' }
})
```

- `remoteAddress` must be an IP string or `null`.
- `scheme` must be `http`, `https`, or `null`.
- Invalid embedding values throw a `TypeError` before execution.
- Do not pass an input `host` property. The Host header is the source.

The values are request snapshots. Includes share them, and a request never
inherits them from a prior request on a reused worker.

## Forms and file uploads

To accept a file, use an ordinary HTML form with `method="post"` and
`enctype="multipart/form-data"`. In its Cow page:

```jsp
<?js
import { field, HttpError } from 'cow:web';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const values = await req.formData({ maxFiles: 1, maxFileSize: 262144 });
const title = field(values, 'title'); // Rejects duplicate names and file values.
const file = values.get('attachment');
if (values.getAll('attachment').length !== 1 || !file || typeof file === 'string') {
  throw new HttpError(400, 'Choose one file.');
}
// Inspect file.bytes() if your application needs to validate its content.
// Choose a private directory outside the served root and your own filename.
const directory = resolve(__dirname, '../data');
await mkdir(directory, { recursive: true });
await file.save(resolve(directory, randomUUID() + '.bin'));
echo(h(title), 'saved');
?>
```

For a complete site, try the
[one-page upload example](../examples/uploads/README.md):

```sh
node ./bin/cow.mjs ./examples/uploads/site --port 8003
```

`req.formData()` is optional and lazy. Cow parses nothing unless you call it.

- It accepts `multipart/form-data` and `application/x-www-form-urlencoded`.
- It does not consume the body. `req.body()`, `req.text()`, and `req.json()`
  still work.
- Repeated calls share parsing and upload objects, but Cow validates the
  supplied limits each time.

### Read form values

The result is a read-only FormData-style view, **not** a browser `FormData`
instance. It supplies `get(name)`, `getAll(name)`, `has(name)`, `entries()`,
`keys()`, `values()`, and iteration.

- A value is a string or an upload object. A missing `get()` value is `null`.
- Names such as `photos[]` are literal. To read multiple files, call
  `getAll('photos[]')`.
- Cow preserves repeated names in order, including text and file collisions.
  `get()` picks the first.
- For an unambiguous text scalar, use `field()`. When you require one file,
  check `getAll()`.
- A blank browser file control is parsed as an empty string, not an upload. A
  named zero-byte file is a valid upload.

Multipart text follows the shared Undici FormData parser, including UTF-8
replacement decoding. URL-encoded forms retain Cow's strict percent and UTF-8
checks. The synchronous `form(req)` helper remains URL-encoded-only.

### Read and save an upload

An upload has read-only `name`, `type`, and `size` metadata, plus these
methods:

| Method | Description |
| --- | --- |
| `await file.bytes()` | Returns a fresh binary Buffer copy, suitable for content checks. |
| `await file.text()` | Returns UTF-8 text, and replaces invalid byte sequences. |
| `await file.save(absolutePath)` | Saves to an application-chosen destination, and returns that path. |

> **Warning:** Names and media types come from the client. They are not
> trusted paths or content validation. Escape names in HTML, and choose your
> own saved names.

`file.save()` follows these rules:

- The parent directory must exist.
- Cow creates the new file exclusively with mode 0600, subject to OS
  permissions. It never overwrites existing files or symlinks.
- Saving consumes the upload's content. Another save or read fails with
  `COW_UPLOAD_SAVED`. Concurrent saves fail with `COW_UPLOAD_SAVING`.
- You can retry a failed save. To observe filesystem errors, await the call.

### Limits

Each `req.formData()` call applies these default limits. You can set each one
as an option, and each value must be a non-negative integer:

| Option | Default |
| --- | ---: |
| `maxFiles` | 10 |
| `maxFileSize` | 1,048,576 bytes per file |
| `maxFields` | 100 text fields |
| `maxFieldSize` | 65,536 UTF-8 bytes per decoded text value |

Field names are additionally bounded to 256 UTF-8 bytes, and filenames to
1,024.

### Errors

Cow rejects an over-limit form in full, rather than exposing truncated values.

| Problem | Result |
| --- | --- |
| The form exceeds a `max*` limit. | 413 `COW_FORM_LIMIT` |
| A field name or a filename is too long. | 413 `COW_FORM_NAME_TOO_LARGE` |
| The multipart data is malformed. | 400 `COW_INVALID_MULTIPART` |
| The media type is not supported. | 415 `COW_FORM_CONTENT_TYPE` |
| An option name or value is invalid. | `TypeError` |

### Body limit and memory

Cow's whole-body admission limit still applies **before** the page runs. The
limit is 1 MiB by default, and it includes multipart framing and all fields
and files. To accept larger forms, raise `--body-limit`. Raising only
`maxFileSize` does not raise the wire-body limit.

This version buffers the body and uses pinned Undici multipart parsing inside
the execution worker. Cow checks the per-field and per-file limits after that
bounded parse, before it returns values to the page. The limits do not make
parsing streamed, and they do not impose an exact total-memory cap. Large and
streaming uploads are not implemented.

### Upload lifetime

Unsaved uploads live in request memory, not in temporary disk files.

- Cow releases their content at request cleanup, including after a rendering
  failure. Cancellation, timeout, or worker exit discards the worker's unsaved
  data.
- Cleanup hooks may still use uploads.
- Retained upload methods cannot access a later request.
- Explicit saves are tracked work, not database transactions. They may finish
  even if rendering fails.
- A failed or interrupted filesystem write can leave a partial destination.
  Cancellation does not roll back or retry a save.

Cow implies no automatic directory creation, public download route,
authentication, or content validation.

## See also

- [Pages and helpers](templates.md) for code tags, `include()`, and helpers.
- [Output and errors](output-and-errors.md) for error pages, `res.sendFile()`,
  `res.download()`, and `res.stream()`.
- [Request lifecycle](request-lifecycle.md) for cleanup order and tracked work.
- [Standard library](standard-library.md) for the tasks that Cow's bundled
  modules and runtime APIs cover.
