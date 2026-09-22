# Cow

Cow is a web runtime for JavaScript and TypeScript: put `.cow` files in a directory,
mix code with HTML, and serve it. Each request gets fresh application state.

```html
<?js const name = req.get('name') || 'world' ?>
<h1>Hello, <?= h(name) ?>!</h1>
```

The package is **`@cowlang/cow`**, the command is **`cow`**, and the website is
[cowlang.com](https://cowlang.com). Cow is **version 0.0.1, not yet publicly released**.
Page syntax and API details can still change.

Cow includes its own file router, compiler, runtime, and HTTP server. You do
not need a framework, a mandatory configuration file, a frontend build, or CGI
setup. Use JavaScript or optional TypeScript annotations in the same `.cow` files.

## Install and run

Install [Node.js](https://nodejs.org/en/download) 22.16+ with npm.

The npm commands below target the published release. Until the first publication,
use the [local archive instructions](docs/getting-started.md#install-locally-without-publishing).

1. Create a folder called `my-site`.
1. Save the example above as `my-site/index.cow`.
1. Start Cow:

   ```sh
   npx @cowlang/cow my-site
   ```

1. Open `http://127.0.0.1:8000/?name=Clover`. The page says "Hello, Clover!"
1. Edit the page, and then refresh. Ordinary pages and helpers do not need a
   restart or a build step. Changes to Cow itself or to native adapters require
   a restart.
1. To stop the server, press Ctrl+C.

The folder is the whole site. Cow's bundled helpers, including SQLite and sessions, work
out of the box. Install third-party npm packages in your site's project as usual.

Cow can run on Node.js 22.16+, Bun 1.4.2+, Deno 2.9.6+, or Nub 0.9.2+ with
Node.js 22.16+. Install your chosen runtime separately, then select it without changing
site files:

```sh
npx @cowlang/cow my-site --runtime bun
npx @cowlang/cow check my-site
```

Read the [installation guide](docs/getting-started.md) for a global `cow` command,
pinned deployment installs, and local archives, and the [runtime guide](docs/runtimes.md)
for runtime-specific limits. Use `@cowlang/cow`, not the unrelated unscoped `cow` package.

## Documentation

Start with the [documentation index](docs/README.md).

- [Getting started and syntax checking](docs/getting-started.md)
- [Pages, includes, and private helpers](docs/templates.md)
- [Request/response API and uploads](docs/runtime-api.md)
- [SQLite, cookies, and sessions](docs/sqlite-sessions.md)
- [Language contract and request lifetime](docs/language-contract.md)
- [Standard-library coverage](docs/standard-library.md)
- [Server operations](docs/operations.md)
- [Runtime support and limitations](docs/runtimes.md)

## Examples

- [MiniNews](examples/mininews/README.md): a single-file news editor with Markdown.
- [Cow Commons](examples/forum/README.md): a small forum with accounts and ownership checks.
- [Uploads](examples/uploads/README.md) and [diagnostics](examples/info/README.md): focused API examples.

Databases and private setup keys are never part of the package.

## Contributing

See [contributing](CONTRIBUTING.md) for setup and tests.

## License

[MIT](LICENSE)
