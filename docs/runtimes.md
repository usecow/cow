# JavaScript runtimes

[Documentation index](README.md)

Cow runs on four JavaScript runtimes: Node.js, Bun, Deno, and Nub. This guide helps you
choose a runtime, switch between runtimes, and check the limits of each one.

Cow's pages and site files are independent of the runtime executable. Support
does not imply identical native APIs or resource guarantees, so each runtime's
limits are listed in [Versions and differences](#versions-and-differences).

| Runtime | `--runtime` value | Minimum version | Engine | Per-worker heap limit |
| --- | --- | --- | --- | --- |
| Node.js | `node` | 22.16 | V8 | Yes |
| Bun | `bun` | 1.4.2 | JavaScriptCore | No. `--memory-limit` fails. |
| Deno | `deno` | 2.9.6 | V8 | No. `--memory-limit` fails. |
| Nub | `nub` | 0.9.2, with Node.js 22.16 or later | V8 | Yes |

Nub runs stock Node.js. Cow supports it as a runtime and version-manager
launcher.

To switch runtime, stop the server and start it again with `--runtime`:

```sh
cow ./site --runtime bun
```

## Switch runtimes

[Install Cow](getting-started.md) and whichever runtimes you want to use. Cow
does not download or upgrade runtimes for you.

The examples below use `cow`. You can replace it with `npx @cowlang/cow`. For a
project-local installation, prefix it with `npm exec --offline --`. The
npm-installed command starts with Node.js and then launches the selected runtime.

```sh
cow ./site --runtime node
cow ./site --runtime bun
cow ./site --runtime nub
cow ./site --runtime deno
cow check ./site --runtime deno
```

Cow chooses the runtime and its executable from these settings:

| Setting | What it does |
| --- | --- |
| `--runtime` | Selects the runtime for this command. It wins over `COW_RUNTIME`. |
| `COW_RUNTIME` | Supplies the default runtime. |
| `COW_NODE`, `COW_BUN`, `COW_NUB`, `COW_DENO` | Optional. Each selects a specific executable path, not a shell command. Otherwise, Cow searches PATH. |

A missing or old runtime fails with an actionable error. No application
configuration file is required.

You can also start the checkout directly:

```sh
node bin/cow.mjs ./site
bun bin/cow.mjs ./site
nub --node bin/cow.mjs ./site
deno run --allow-all --no-check --no-config --node-modules-dir=manual bin/cow.mjs ./site
```

### What stays the same

When you switch runtimes, you keep the same:

- `.cow` pages and helpers
- `@cowlang/cow/*` imports
- URLs
- database files
- cookies

Ordinary package state remains fresh per request. Page and helper edits still
appear on the next request. Switching the runtime itself requires stopping and
starting the server.

Install the same dependencies into `node_modules`. Runtime-specific imports
such as `bun:*` or `jsr:*` in application code are not a portable Cow API.
Third-party native adapters must support the selected runtime.

## Versions and differences

Cow requires Node.js 22.16+, Bun 1.4.2+, Deno 2.9.6+, or Nub 0.9.2+ with
Node.js 22.16+. Cow runs on Windows, macOS, and Linux.

Continuous integration tests every change on all three operating systems with
Node.js 22.16 and 24, Bun 1.4.2, Deno 2.9.6, and Nub 0.9.2. Newer runtime
versions can behave differently. To check one, use the conformance suite in
[Verify a runtime](#verify-a-runtime).

### Nub

Cow selects Nub's `--node` compatibility mode. Nub still chooses and provisions
the project's Node.js version. Cow controls syntax, imports, and workers. Nub's
augmentation hooks are not needed. See
[Nub's runtime documentation](https://nubjs.com/docs/runtime).

### Deno

The CLI grants full host permissions, which matches Cow's trusted-site model on
Node.js and Bun. It uses installed dependencies without a Deno config file.

> **Warning:** Cow on Deno is not a Deno permission sandbox for untrusted
> sites.

### Memory limits

Cow enforces per-worker old-generation heap limits only on Node.js and Nub. Cow
does not enforce worker heap limits on Bun or Deno. On those runtimes:

- An explicit `--memory-limit` fails.
- Startup warns.
- Diagnostics report no heap bound.

Request, output, admission, source, cache, resource-count, and time limits
still apply. When you need a whole-process memory bound, use OS or container
controls. See
[Bun's compatibility documentation](https://bun.com/docs/runtime/nodejs-compat).

### Bun

- **HTTP:** Bun 1.4.2's native parser rejects server-wide `OPTIONS *` with 400
  before Cow receives it. Normal route-level `OPTIONS /path` works. The
  conformance test and `cow.info()` expose this exception. Cow does not claim
  HTTP parity for it.
- **Failed top-level await:** Bun 1.4.2's VM reports an extra internal
  unhandled promise when a static dependency's async evaluation fails, even
  when Cow awaits the evaluation promise. The already-failed request therefore
  has an aggregate diagnostic with the original mapped error as its cause.
  Successful top-level await and recovery with
  `try { await import(...) } catch {}` work across runtimes.
- **SQLite:** Cow works around
  [Bun #40001](https://github.com/oven-sh/bun/issues/40001) by yielding and
  collecting unreachable prepared statements when a connection is closed on
  eviction or shutdown. Cow does not do this on each request or query. The
  workaround preserves the same `node:sqlite` behavior and database format.
  Direct third-party use of Bun's `node:sqlite` remains subject to that
  upstream bug.

### Diagnostics

`cow.info()` reports the runtime and engine names and versions. JavaScriptCore and
V8 can point to different columns within the same failing source expression.

### Shared across runtimes

- All runtimes use TypeScript 5.9.3 for Cow parsing and transpilation.
- `cow check` never executes site code. Node.js uses its native syntax-check
  subprocess. Bun and Deno use Acorn for located early errors, followed by a
  non-evaluating runtime VM parse.
- Package resolution uses the same Node.js-compatible resolver, including
  parent paths and import conditions.
- Multipart parsing uses pinned Undici, not each runtime's differently permissive
  FormData parser.

## Verify a runtime

| Command | What it runs |
| --- | --- |
| `npm test` | The full Node.js regression suite. |
| `npm run test:package` | A check of an independent local installation. |
| `npm run test:runtimes` | One unchanged site under all four runtimes. |
| `npm run test:bun`, `npm run test:deno` | The shared request and site suites on that runtime. |

To run the conformance suite, put all four executables on PATH, or select them
through the environment variables in [Switch runtimes](#switch-runtimes). Then run:

```sh
npm run test:runtimes
```

This launches one unchanged site under all four runtimes. It verifies actual
engine identity, private helpers, fresh module state, SQLite continuity between
runtimes, request errors, and CLI syntax checking.

To check a subset explicitly, name the runtimes:
`node test/runtime-matrix.mjs bun deno`. A missing requested runtime is a failure,
not a skip.

`npm run test:bun` and `npm run test:deno` can also run directly with
`deno test -A --no-check` or `bun test/bun-conformance.mjs`, followed by
explicit test filenames.

The Bun runner adapts only test registration. Assertions and site source stay
unchanged. It avoids `bun test`, which intercepts intentional unhandled promise
rejections inside Cow's workers and changes the behavior being tested. No
production rejection handlers are disabled. The Node.js-only CLI, editor, and
type tests remain in the full Node.js suite.

## See also

- [Getting started](getting-started.md) for installing Cow.
- [Server operations](operations.md) for `--memory-limit` and the other limits.
- [Import compatibility](import-compatibility.md) for native APIs and packages.
- [Language contract](language-contract.md) for the semantics that every runtime
  shares.
