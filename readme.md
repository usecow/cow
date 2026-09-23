# Cow

[Cow](https://cowlang.com) is a classic take on a web runtime for JavaScript and
TypeScript. Cow allows you to write server-side JavaScript or TypeScript with
HTML, with batteries included. If you like PHP, you'll love Cow.

Learn more about Cow [in the documentation](docs/README.md).

## Installation

Cow supports [multiple runtimes](docs/runtimes.md). For a quick install, use
[Node.js](https://nodejs.org/en/download) 22.16 or later.

Run without installing:

```sh
npx @cowlang/cow my-site
```

Install `cow` globally:

```sh
npm install --global @cowlang/cow
```

Or to add it to your project:

```sh
npm install --save-exact @cowlang/cow
```

## Your first page

Create a folder called `my-site`, and save this as `my-site/index.cow`:

```jsp
<?js const name = req.get('name') || 'world' ?>
<h1>Hello, <?= h(name) ?>!</h1>
```

Start Cow:

```sh
npx @cowlang/cow my-site
```

Open <http://127.0.0.1:8000/?name=Clover> to see "Hello, Clover!" Edit the
file and refresh to see your changes.

Learn more about writing pages [in the docs](docs/templates.md).

## Additional resources

- **[Getting started](docs/getting-started.md)**: installation, routing,
  deployment, and syntax checking.
- **[Request and response API](docs/runtime-api.md)**: query strings, forms,
  uploads, redirects, and JSON.
- **[SQLite and sessions](docs/sqlite-sessions.md)**: queries, transactions,
  cookies, and sign-in.
- **[JavaScript runtimes](docs/runtimes.md)**: running on Bun, Deno, or Nub.
- **[Examples](examples)**: a news site, a forum, file uploads, and a
  diagnostics page.

Cow is at version 0.0.1, so expect its APIs to change.

## Contributing

To contribute, read the [contributing instructions](CONTRIBUTING.md).

## License

[MIT](LICENSE)
