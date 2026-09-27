# Getting started

[Documentation index](README.md)

This guide takes you from an empty folder to a Cow page running in your
browser. After that, it shows you how to choose a runtime, install Cow for a
project, deploy a pinned installation, and check a site without running it.

## Before you begin

Install [Node.js](https://nodejs.org/en/download) 22.16+ with npm. The
installation commands in this guide use npm.

Cow also runs on these JavaScript runtimes:

- Bun 1.4.2+
- Deno 2.9.6+
- Nub 0.9.2+ with Node.js 22.16+

Install alternative runtimes separately. See [runtime support](runtimes.md) for
capabilities and platform limits.

Cow takes care of the rest of its setup:

- Cow enables the VM flags that it requires automatically.
- Cow's TypeScript parser is installed with Cow, so TypeScript pages work as
  soon as Cow does.

TypeScript support removes annotations. It does not perform full type
checking.

## Create your first page

The commands in this section install **`@cowlang/cow`** from npm.

1. Create a folder called `my-site`.

1. Save this as `my-site/index.cow`:

   ```jsp
   <?js const name = req.get('name') || 'world' ?>
   <h1>Hello, <?= h(name) ?>!</h1>
   ```

   `h()` escapes the value for HTML.

1. From the directory that contains `my-site`, start Cow:

   ```sh
   npx @cowlang/cow my-site
   ```

   [npx](https://docs.npmjs.com/cli/v11/commands/npx/) downloads Cow into
   npm's cache when needed, and then runs it. Accept its installation prompt
   on the first run. If port 8000 is occupied, add `--port 8001`.

1. Open `http://127.0.0.1:8000/?name=Clover`.

   Output:

   ```html

   <h1>Hello, Clover!</h1>
   ```

   Without `?name=Clover`, the page says "Hello, world!" The output starts
   with a blank line because Cow keeps the line break after a closing `?>`.

1. Edit the file, and then refresh the browser to see your change.

1. To stop the server, press Ctrl+C.

> **Note:** Use `npx @cowlang/cow`, not `npx cow`. The `cow` package on npm is
> unrelated to this project.

### What a site is

A Cow site is a folder of files, and the folder that you made is a complete
site. Cow has no configuration file and no build step. Add a `package.json`
file and a `node_modules` folder only when you install third-party packages.

Cow supplies its own `cow:web`, `cow:sqlite`, `cow:csv`, `cow:resource`, and
`cow:runtime` modules from the running installation, the way Node.js supplies
`node:` built-ins. These imports work in plain directories too, and
`@cowlang/cow/web` and friends remain equivalent aliases. Third-party packages
still resolve from the site's own `node_modules`. Install those locally when
you need them.

### The `cow` command in these guides

In the rest of these guides, replace `cow ...` with `npx @cowlang/cow ...`.
You can also use the optional [global](#install-a-global-command) or
[project-local](#install-cow-in-your-project) installation. With no directory
argument, Cow serves the current directory.

## Choose a runtime

To run the same site on a different runtime, pass `--runtime`:

```sh
npx @cowlang/cow my-site --runtime node
npx @cowlang/cow my-site --runtime bun
npx @cowlang/cow my-site --runtime nub
npx @cowlang/cow my-site --runtime deno
npx @cowlang/cow check my-site --runtime deno
```

Stop the server before you switch runtimes. Pages, helpers, imports, SQLite data,
and cookies do not need to change.

| Environment variable | What it does |
| --- | --- |
| `COW_RUNTIME` | Sets the default runtime. |
| `COW_NODE`, `COW_BUN`, `COW_NUB`, `COW_DENO` | Point to a specific executable for that runtime. |

The npm-installed `cow` launcher starts on Node.js, and then selects the runtime
that you requested. To invoke a runtime directly, see
[runtime support](runtimes.md).

## Install a global command

This installation is optional. For a machine-wide CLI, run:

```sh
npm install --global @cowlang/cow
cow --version
cow my-site
```

A global installation provides both the command and Cow's bundled helpers.
Sites do not need their own Cow installation. Third-party dependencies remain
local to each site.

If global installation fails with a permissions error, use a project-local
installation or follow npm's [permissions guidance](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally/).

## Install Cow in your project

This installation is optional. For a pinned Cow version and reproducible
deployments, install Cow in your site:

```sh
cd my-site
npm install --save-exact @cowlang/cow
npm exec --offline -- cow .
```

- The install creates `package.json` and `package-lock.json` if needed. Commit
  both files.
- Cow is a runtime dependency, not a build tool, so keep it in `dependencies`.
- `npm exec --offline --` selects the local command without downloading a
  missing package.

For shorter commands, you can add npm scripts:

```sh
npm pkg set "scripts.start=cow ." "scripts.check=cow check ."
npm start
npm run check
```

A local installation also supplies types to your editor. It makes Cow's
exports available to standalone Node.js scripts, and to applications that use
the [embedding API](embedding.md). The built-in helper resolution described in
[What a site is](#what-a-site-is) applies inside Cow's request
loader. It does not apply to arbitrary Node.js programs or third-party native
adapters.

## Install locally without publishing

1. From the Cow source repository, build an archive:

   ```sh
   npm ci
   npm pack
   ```

   `npm pack` prints the archive filename. See npm's
   [pack command](https://docs.npmjs.com/cli/v11/commands/npm-pack/).

1. From the directory that contains your `my-site` folder, run Cow from the
   archive:

   ```sh
   npx --package /path/to/cowlang-cow-VERSION.tgz cow my-site
   ```

   Replace `VERSION` and the path with the actual file. Quote paths that
   contain spaces, for example
   `npx --package "C:\path to\cowlang-cow-VERSION.tgz" cow my-site`.

For a project-local install, pass the archive path to `npm install` instead.
Installing the archive may download Cow's public dependencies. You do not need
publishing credentials.

## Use an included example

With a project-local installation, copy example files into your own project
before you edit them.

> **Warning:** Do not run a writable application from inside `node_modules`.
> Package updates can replace it.

### MiniNews

To run [MiniNews](../examples/mininews/README.md):

1. Copy `node_modules/@cowlang/cow/examples/mininews/site/news.cow` to
   `news.cow`.
1. Run `npm exec --offline -- cow .`.
1. Visit `/news`. On the first visit, read the private `_news.setup-key` file
   to create the editor account.

You can also copy that single file from the source repository into a plain
site directory and run it with `npx @cowlang/cow my-site`.

### Cow Commons

To run [Cow Commons](../examples/forum/README.md):

1. Start with an empty `site/` directory.
1. Copy the contents of `node_modules/@cowlang/cow/examples/forum/site/` into
   it.
1. Copy `node_modules/@cowlang/cow/examples/forum/setup.mjs` to the project
   root.
1. Run setup, and then start Cow:

   ```sh
   node setup.mjs
   npm exec --offline -- cow site --port 8002 --workers 2
   ```

1. Open `http://127.0.0.1:8002/install`, and use the private key that setup
   printed.

Keep `data/` beside `site/`, not inside it. No default password is provided.

## Run from source

1. In a Cow repository checkout, install the dependencies with `npm ci`.
1. Run `node bin/cow.mjs /path/to/site`. You do not need to install or link a
   global command.

Each shipped example under `examples/` is a self-contained project. `npm start`
inside `examples/mininews/` or `examples/forum/` sets up and starts that
example. These are repository conveniences, not commands provided in a new
user's application.

## Deploy a pinned installation

1. Use the [project-local installation](#install-cow-in-your-project), and
   keep the manifest and lockfile in version control.

1. On the server, from your `my-site` directory, run:

   ```sh
   npm ci --omit=dev
   npm exec --offline -- cow check .
   npm exec --offline -- cow . --host 127.0.0.1 --port 8000 --mode production
   ```

   `npm ci` installs from the lockfile, and fails if the lockfile disagrees
   with the manifest. See [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

   For applications with a separate public directory, such as the forum
   example, replace `.` in the Cow commands with `site`.

1. Use a service manager to run Cow, and a reverse proxy for HTTPS.

Cow's built-in server uses HTTP and does not trust forwarded headers. Before
you expose a site:

- Keep databases and secrets out of public assets.
- Restrict diagnostic routes.
- Configure Secure session cookies explicitly behind TLS termination.
- Read [operations](operations.md) and the example's deployment notes.

### Upgrade Cow

Upgrade deliberately:

1. Install a chosen published version with
   `npm install --save-exact @cowlang/cow@VERSION`.
1. Check the site.
1. Restart Cow.

Keep the prior lockfile and data backups for rollback.

## Routing

Routes are file-based:

| Request | Source file |
| --- | --- |
| `/` | `index.cow` |
| `/account` | `account.cow` |
| `/docs/` | `docs/index.cow` |
| `/app.css` | `app.css` |

Use `.cow` for new pages. The server also supports `.jsp` and `.tsp`. For the
same route basename, it tries `.cow`, then `.jsp`, then `.tsp`. Public URLs
stay extensionless, so `/account.cow` is not served directly.

### What Cow serves

Cow does not serve these directly:

- Page file extensions (`.cow`, `.jsp`, and `.tsp`), dotfiles, `node_modules`,
  and underscore-prefixed paths. Underscore-prefixed modules remain importable.
- Ordinary JS/TS modules, JSON, and database files. These are private.
- Windows alternate path syntax, and symlinks into private or outside files.
  Cow rejects these requests.

Static files use a limited public-extension allowlist: CSS, HTML, images,
fonts, text, XML, and PDF. Browser `.js`, `.mjs`, and `.json` files must live
inside `assets/`.

Cow sends static files with `ETag`, `Last-Modified`, and
`Cache-Control: no-cache`, as Apache and nginx send validators. The browser
re-checks each file on every load, and Cow answers `304 Not Modified` when the
file has not changed, so an edited stylesheet or script shows on the next
refresh.

> **Warning:** Everything in `assets/` is intentionally public if its
> extension is allowed. Never put server modules or secrets there.

## Check a site without running it

To check the syntax of a directory or a single file, run `cow check`:

```sh
cow check ./site
cow check ./site/index.cow
cow check ./site --json
```

For example, `cow check my-site` on the first page from this guide prints:

```text
Checked 1 file: no syntax errors. Skipped 0 entries.
```

In a Cow source checkout, use `node ./bin/cow.mjs check ./site`, or point it
at an example's `site` directory. With no path, `cow check` scans the current
directory. It is optional syntax checking, not a build step or full TypeScript
type checking.

### What the checker does

The checker uses Cow's actual page compiler, module format rules, and
pinned parser, followed by a parse-only JavaScript check.

It does not:

- Evaluate site code.
- Resolve or follow imports.
- Load application configuration.
- Start the server.
- Open application databases.
- Write generated files.

An unresolved import, a missing runtime value, or an unsupported native API
can still fail when the site runs.

### Which files it checks

- Cow scans directories recursively, in a stable order, for `.cow`, `.jsp`,
  `.tsp`, `.mjs`, `.js`, `.cjs`, and `.ts` files.
- Private underscore-prefixed helpers are included.
- Dot entries, `node_modules`, `data`, `cache`, declaration files (`.d.ts`),
  and recursive symlinks are skipped.
- A file or directory that you select explicitly can be inside an otherwise
  skipped tree. Explicit symlinks use their canonical target.
- A `.js` file follows its nearest `package.json` `type`, as it does during
  Cow execution.
- Check browser assets with their own tools. This command uses Cow's
  server-side module rules for every selected JS file.

### Diagnostics

- Errors include the original file, line, and column where available. That
  includes errors found after TSP/TS transformation.
- Checking continues after a file fails, with one diagnostic per failed file.
- Human diagnostics go to stderr, and the summary goes to stdout.
- `--json` puts the result and checking diagnostics on stdout. CLI usage
  errors still use stderr.
- Skipped counts are directory entries, not a count of every file below
  skipped directories.

### Exit codes and limits

| Exit code | Meaning |
| --- | --- |
| **0** | Checked successfully. |
| **1** | Syntax errors. |
| **2** | Invalid input or options, an empty selection, a read failure, the source limit, or a parser failure. |

Input and operational errors take precedence if they are mixed with syntax
errors.

The default per-file limit is 1,048,576 source bytes. To change it, use
`--source-limit <bytes>`. JavaScript parser subprocesses have a 10-second
deadline each. That is not a whole-directory checking deadline.

### Command and directory names

The normal server command remains `cow ./site`. To serve a directory that is
literally named `check`, use `cow ./check`.

With no directory argument, `cow` serves the current working directory, as
`cow check` checks it. Run it from a site directory, not the repository root.
Use an explicit directory when you launch Cow from elsewhere.

## See also

- [Pages and helpers](templates.md) for tags, includes, and helpers.
- [Request and response API](runtime-api.md) for `req`, `res`, and `cow`.
- [JavaScript runtimes](runtimes.md) for runtime capabilities and platform limits.
- [Operations](operations.md) for limits, worker recovery, shutdown, and
  private status endpoints.
