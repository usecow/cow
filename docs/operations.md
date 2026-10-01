# Server operations

[Documentation index](README.md)

This guide helps you run Cow as a service. It shows you how to set limits,
plan for memory and retries, recover from worker crashes, shut down cleanly,
and check server status.

## Apply changes

Page, include, and ordinary helper edits take effect on the next request.

| Change | What to do |
| --- | --- |
| A page, an include, or an ordinary helper | Nothing. The next request uses the edit. |
| An ordinary module | Nothing. Ordinary modules are fresh per request, with or without `--no-cache`. |
| Native adapter code | Restart Cow. |
| Cow itself | Restart Cow. |

`--no-cache` disables compiled-template caching for entry pages and includes.

## Set limits

To set a limit, pass its flag when you start Cow. The CLI exposes execution
timeout, worker count, queue capacity, memory budgets, and request recycling:

```sh
cow ./site \
  --workers 4 \
  --timeout 10000 \
  --max-queue 1024 \
  --max-requests 1000 \
  --memory-limit 256 \
  --shutdown-timeout 5000
```

Workers are ready before Cow begins listening.

Every flag in this guide also has a camelCase `CowApp` option, such as
`maxQueue` for `--max-queue`. Three names differ: `--max-requests` is
`maxRequestsPerWorker`, `--memory-limit` is `memoryLimitMb`, and `--no-cache`
is `cache: false`. See [Embedding Cow](embedding.md).

### Worker flags

| Flag | Default | What it does |
| --- | ---: | --- |
| `--workers` | One fewer than the available CPU cores, at least 1 and at most 4 | Sets the number of execution workers. |
| `--max-requests` | 1000 | Recycles a worker after this many requests. 0 disables request-count recycling. |
| `--memory-limit` | 256 MB | Limits each worker's V8 old-generation heap on Node.js and Nub. Bun and Deno reject this flag. See [Plan for memory](#plan-for-memory). |

### Admission, deadlines, and memory

| Flag | Default | What it limits | When exceeded |
| --- | ---: | --- | --- |
| `--max-queue` | 1024 | Requests that wait for a worker. Total admitted requests are workers plus this count. | 503 |
| `--body-limit` | 1048576 bytes | Each request body. Cow rejects an excessive Content-Length early. | 413 |
| `--body-timeout` | 10000 ms | Total body read time, including slow senders. | 408 |
| `--queue-timeout` | 10000 ms | The wait for a worker. This is separate from body read and execution. | 503 |
| `--timeout` | 10000 ms | Execution, async draining, and request cleanup. | 504 |
| `--stall-timeout` | 120000 ms | A request whose connection writes nothing for this long. | Cow closes the connection and releases its admission. |
| `--output-limit` | 8388608 bytes | Buffered page output. | That request fails with 500. |
| `--buffer-limit` | 16777216 bytes | Aggregate admitted body bytes and pending HTTP response bodies. | 503 |

Admission happens before body buffering, routing, and compilation. It also
applies to static requests and `app.execute()`.

Cow holds admission until HTTP output finishes or disconnects, so slow readers
cannot retain unlimited responses. A reader that stops reading holds its slot
for at most `--stall-timeout`, and so do pipelined requests queued behind it.
A program that embeds Cow owns delivery and retention of the returned output,
including static-file streaming.

When admission is full, Cow answers 503 `COW_ADMISSION_FULL` and logs one line
every 10 seconds, not one per request. The line counts the refusals and names
the routes that hold the slots, with the age of the oldest. Status shows the
same list as `application.admissionHolders`. Paths are logged without their
query strings.

Health and status GETs bypass application admission so that they remain usable
under overload. Restrict those endpoints at the proxy. See
[Run behind a reverse proxy](#run-behind-a-reverse-proxy). Status includes byte
counters and admission rejections.

### Compilation and retained state

| Flag | Default | What it limits |
| --- | ---: | --- |
| `--cache-entries` | 256 | Entries in each compiler cache. 0 disables retention. |
| `--cache-bytes` | 16777216 | Estimated retained bytes per compiler cache. 0 disables retention. |
| `--source-limit` | 1048576 | Source bytes per page, include, or imported module. `cow check` takes the same flag. |
| `--compile-max-pending` | 8 | Concurrent cold entry-page compilations, including source reads and queueing. |
| `--compile-timeout` | 5000 ms | The CPU transformation deadline in the dedicated compiler worker. |
| `--compiled-buffer-limit` | 16777216 | Estimated compiled-template bytes retained by admitted requests. |
| `--resource-limit` | 64 | Persistent adapter instances per execution worker. |
| `--adapter-limit` | 128 | Adapter definitions per execution worker. |
| `--namespace-limit` | 256 | Direct external import roots per execution worker. |

> **Note:** Keep large data out of source modules. Cow evaluates modules fresh
> for every request, so a multi-megabyte data module is parsed again each time.
> Store large data in a file, such as JSON or a binary format, and read the part
> that a request needs.

These limits produce the following errors:

| Error code | Status | Cause |
| --- | ---: | --- |
| `COW_COMPILE_TIMEOUT` | 504 | A compilation timed out. |
| `COW_COMPILE_BUSY` | 503 | The cold-compilation budget is full. |
| `COW_COMPILED_BUFFER_FULL` | 503 | Requests that retain compiled code and maps reached `--compiled-buffer-limit`. |
| `COW_MODULE_LIMIT` | 503 | One request exceeded `--namespace-limit`. Cow does not replay the request. |

#### Entry pages

Entry-page cache misses compile in one dedicated worker, separate from the
execution pool selected by `--workers`. That worker never executes page code.
Cached pages, static files, and diagnostics do not wait for it.

- Queue expiry and cancellation also apply to compilation.
- Startup, replacement, and the total shutdown deadline cover both pools.
- Health checks include compiler readiness.
- Source reads are byte-bounded and cancellable. The compile timeout starts at
  transformation, not at filesystem admission.

#### Includes and caches

Includes compile inside their execution worker and remain covered by the
request execution deadline.

- Each execution worker has a bounded include cache. The HTTP and embedding
  dispatcher has its own bounded entry-page cache. Both use
  least-recently-used eviction.
- An entry larger than the cache budget can execute without being cached.
- Cache eviction does not invalidate an in-flight result.
- Cow charges requests that retain compiled code and maps separately, even
  with caching disabled.
- Estimates cover strings and mapping metadata, not exact V8 heap or RSS.

#### Import roots and worker recycling

Cow reserves native adapter and built-in import roots before loading,
including failed imports. Reaching the namespace limit schedules worker
replacement after the current request. Exceeding it within one request returns
`COW_MODULE_LIMIT` (503), without replay.

Deleting a Cow map cannot unload Node.js's native module graph. That root limit
does not individually count transitive native imports, adapter-owned
allocations, and native handles. Keep the default request-count recycling
(`--max-requests 1000`) as a reclamation backstop. Ordinary package state
resets independently of this setting. Disabling that count does not disable
limit-triggered replacement.

#### Standalone compiler use

Low-level `compileSource()` remains a synchronous utility. If you call a
standalone `Compiler` or `Dispatcher` on an HTTP event loop, you must supply an
isolated transform. `CowApp` supplies it automatically.

## Plan for memory

Cow's limits are buffer budgets, not a whole-process RSS guarantee. Set OS or
container memory limits for a deployed service.

The budgets leave out the following:

- Temporary body concatenation and worker-message copies add bounded overhead.
  Each worker can also hold an output buffer in transit.
- On Node.js and Nub, `--memory-limit` only limits V8's worker old-generation
  heap. It does **not** limit Buffers, native allocations, npm libraries, or
  the HTTP process.
- Node.js does not free the memory of a request's JavaScript context, so each
  request leaves a few hundred KiB in the worker's old generation. On Node.js
  and Nub, Cow replaces a worker after a request once its old generation passes
  60% of `--memory-limit`, before it can run out of memory. At the default
  256 MB this happens every few hundred requests, independently of
  `--max-requests`. `/_cow/status` reports each worker's `heapUsed` and
  `heapLimit` in bytes.
- Bun and Deno reject `--memory-limit` instead of silently ignoring it.
- `JSON.stringify()`, strings created before writing, caches, and application
  allocations can exceed output accounting.
- Compiler cache and queued-template estimates have separate bounds. See
  [Compilation and retained state](#compilation-and-retained-state). Native
  memory and sustained-load or whole-process measurements remain outside them.

## Plan for disconnects and retries

> **Warning:** A write may already have committed when a request fails.
> Cancellation, timeout, or a lost response does **not** imply rollback. Use
> transactions and idempotency keys where a visitor may retry a write.

- Cow removes queued requests on client disconnect or queue expiry, and never
  runs them later.
- A disconnect during execution does not stop the page. Cow answers the caller
  at once, aborts the request's `cow.signal`, and lets the page run to its end
  on the same worker. A write in progress completes, and cleanup hooks run.
  Code that follows `cow.signal`, such as `fetch`, stops early. A page that
  ignores it still ends at `--timeout`, which replaces its worker.
- Cow never retries a request automatically.
- Embedded callers can pass `app.execute(request, { signal })` for the same
  cancellation policy.

## Recover from worker crashes

Cow replaces a worker that crashes or fails to start. These flags control the
replacement:

| Flag | Default | What it does |
| --- | ---: | --- |
| `--startup-timeout` | 10000 ms | Bounds worker readiness. |
| `--restart-delay` | 100 ms | Sets the wait before a replacement starts. |
| `--restart-max-delay` | 5000 ms | Caps the delay. Consecutive crashes or startup failures double the delay up to this value. |
| `--restart-limit` | 5 | Sets the consecutive failures a slot allows before Cow marks it failed. |

- A failed initial startup stops the pool and rejects startup. Cow does not
  open its HTTP listener first.
- A successful request completion resets the failure streak. Announcing
  readiness does not.
- Planned recycling, request timeout, and cancellation replace the worker
  without adding a crash failure.
- Closing the app cancels scheduled replacements.
- Worker recovery never replays the request that crashed the worker.
- Cow logs each failed replacement, each exhausted slot, and each exhausted
  slot that starts again.

### Fix a degraded or failed worker pool

An exhausted slot is marked failed, and Cow keeps retrying it every
`--restart-max-delay`. A host too busy to start a worker within
`--startup-timeout` exhausts its slots too, and it recovers once the load
drops. When a retry starts a worker, the slot serves again. One more failure
before a request succeeds marks it failed again.

Failed slots are visible in `/_cow/status`, under
`application.runtime.recovery`, with the last error and failure count. In the
status report, `runtime` names Cow's execution worker pool, not the JavaScript
runtime.

| `application.runtime.state` | Meaning |
| --- | --- |
| `degraded` | Some slots have failed, so Cow has partial capacity. |
| `failed` | All slots have failed. Cow rejects queued work and refuses new requests with 503 `COW_RUNTIME_FAILED` until a retry starts a worker. Health returns 503. |

When a slot keeps failing:

1. Inspect `lastError` in the `recovery` entry for the failed slot.
1. Fix its cause. On a loaded host, `COW_WORKER_START_TIMEOUT` can mean that
   `--startup-timeout` is too short.
1. Cow picks up the fix on its next retry, with no restart.

## Shut down cleanly

To stop Cow, send `SIGINT` or `SIGTERM`, or call `app.close()`. Cow stops
accepting new connections, drains active HTTP requests, and then terminates
its workers.

`--shutdown-timeout` (default 5000 ms) is one total budget shared by HTTP
draining and worker cleanup. It is not a fresh timeout for each stage. Normal
work that finishes within the budget still drains gracefully.

> **Warning:** At the deadline, Cow destroys the remaining HTTP connections and
> terminates the workers. A forced shutdown may interrupt writes and cannot
> promise resource cleanup.

At the deadline, the close also rejects, and the CLI reports failure. Expect
small scheduling and OS termination overhead, not a real-time guarantee. A
directly embedded `WorkerPool.close()` also bounds active execution and
resource cleanup by its shutdown budget.

### Close errors

`app.close()` preserves a single component failure.

| Error code | Meaning |
| --- | --- |
| `COW_RUNTIME_CLOSE_FAILED` | A worker pool failed to close. Its worker failures are in `errors`. |
| `COW_CLOSE_FAILED` | Multiple components failed. Each component's error is in `errors`. |

Concurrent close callers receive the same failure. Cow stops both pools before
close settles.

## Choose an error mode

| Flag | Error pages |
| --- | --- |
| `--mode development` | Include exception details. |
| `--mode production` | Return generic errors. Cow retains structured server logs with a request ID. |

Error responses follow these rules:

- Thrown error statuses must be integers from 400 through 599. Other values
  become 500.
- Error pages are HTML with `Cache-Control: no-store`.
- Only policy headers survive a page failure: `Allow`, `WWW-Authenticate`,
  `Retry-After`, `Set-Cookie`, supported security and CORS headers, and
  `Vary`. The exact allowlist is in `lib/http-policy.mjs`.
- Cow drops body metadata, cache validators, redirects, and arbitrary success
  headers.
- Cow validates header names and values when you set them.
- Cookies can survive a failed response. An HTTP error does not undo an already
  committed database write.
- Logger failures cannot terminate HTTP error handling.
- Forced worker termination cannot recover headers from that worker.

## Check server status

The built-in HTTP adapter provides two endpoints:

| Endpoint | What it returns |
| --- | --- |
| `/_cow/health` | A lightweight readiness response. |
| `/_cow/status` | Server, queue, worker, cache, timing, and request metrics. |

To check readiness, request the health endpoint:

```sh
curl http://127.0.0.1:8000/_cow/health
```

Output:

```json
{"status":"ok","requestId":"78123748-42cd-4b6a-a4f8-d1c9f90304d0"}
```

Status includes the following:

- Compiler cache estimates, hits, and evictions, cold-compilation work,
  admitted compiled bytes, and compiler-worker recovery.
- Execution-worker cache and namespace counts.
- Live resource instances and leases per worker, plus cumulative open,
  acquire, release, close, and failure counters.

Cow caps retired per-adapter history by `adapterLimit`. Global cumulative
counters remain available when a name's history is omitted. Status never
includes resource keys and options.

Lazy resource failures affect their request without making unrelated routes
fail the general readiness check.

## Run behind a reverse proxy

> **Warning:** When you expose Cow publicly, restrict `/_cow/health` and
> `/_cow/status` at the reverse proxy. Status reports server internals, and
> both endpoints bypass application admission.

For a deployed service, also set proxy connection, header, read, and write
limits, and set OS or container memory limits. See
[Plan for memory](#plan-for-memory).

## See also

- [JavaScript runtimes](runtimes.md) for runtime versions and per-runtime limits.
- [Embedding Cow](embedding.md) for `CowApp`, `app.execute()`, and the HTTP
  contract.
- [Output and errors](output-and-errors.md) for error pages and streaming.
- [Getting started](getting-started.md) for installing and starting Cow.
