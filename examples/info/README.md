# Runtime information

Like PHP's `phpinfo()`, `cow.info()` shows a page about the Cow server that's
running it. Save this as `info.cow` in your site:

```jsp
<?js cow.info() ?>
```

Then visit `/info`. For JSON, call `cow.info({ format: 'json' })` instead.

## Run it

From a clone of this repository, after `npm install` at the root:

```sh
npm start --prefix examples/info
```

Open <http://127.0.0.1:8004>.

## What it shows

The page lists the versions of Cow, Node.js, V8, TypeScript, and SQLite, the
platform, Cow's limits and cache settings, and request and worker counts. It
never shows environment variables, file paths, request data, cookies, or
hostnames.

> **Warning:** The page still reveals versions and limits. Protect it with your
> own sign-in check, or delete it when you're done. Cow never adds this page to
> a site on its own.

For health checks across the whole server, use the `/_cow/status` endpoint
described in [server operations](../../docs/operations.md).
