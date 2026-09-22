# Contributing to Cow

Install Node.js 22.16+ and run `npm ci` from the repository root.

## Tests

```sh
npm test
npm run test:package
npm run test:runtimes
npm run test:bun
npm run test:deno
```

`npm test` runs the runtime's Node suite. The package test installs a local
tarball into a disposable project and exercises the installed CLI, exports and
examples. It downloads public dependencies and needs network access, but no
npm login.

Each example under `examples/` is a self-contained project with its own
`package.json` and tests, not managed by the root package. Run them from the
example's directory:

```sh
npm test --prefix examples/forum
npm test --prefix examples/mininews
npm test --prefix examples/uploads
npm test --prefix examples/info
```

Runtime checks need the selected executables installed. See
[runtime support](docs/runtimes.md) for executable overrides and host differences.

Check the website separately:

```sh
node --test website/website.test.mjs
node bin/cow.mjs check website/site
```

Run `npm run bench:compiler` for lexer/compiler timings. The
[compiler notes](docs/compiler.md) explain the implementation and
benchmark method.

## Changes

Add a regression test for changed behavior and update the relevant API guide.
Docs changes follow the [documentation style guide](docs/STYLEGUIDE.md): run
every example, and show its real output.
Use disposable test data, not the example sites' databases. Changes to imports,
worker paths or package exports also need the independent package-install test.
