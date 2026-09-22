# Cow runtime information

Like PHP's phpinfo page, a Cow page can show the environment serving it:

```html
<?js cow.info() ?>
```

Save that as `info.cow` in your site and visit `/info`. It renders a complete
HTML response and ends the page; call it before committing headers. No import,
configuration or route registration is needed. For machine-readable output use
`cow.info({ format: 'json' })`. It preserves the response's chosen status and
uses the normal output limit, HEAD behavior and transaction/cleanup guards.

The HTML follows the classic phpinfo layout: purple version banner, compact
lavender-label/gray-value tables and grouped configuration sections. Branding
and reported facts belong to Cow; PHP-only settings are not fabricated.

To run this isolated example from the Cow checkout:

```sh
node ./bin/cow.mjs ./examples/info/site --host 127.0.0.1 --port 8004
```

Visit http://127.0.0.1:8004/. Stop the server with Ctrl+C when finished.
This does not add a diagnostic route to your other sites.
If that port is occupied, use `--port 0` and open the address Cow prints.

The report shows Cow/Node/V8/TypeScript versions, platform/architecture/time zone,
effective limits and compiler-cache settings, supported Node entry points,
bundled helpers, SQLite library version, and anonymous request/worker counts.
Available does not mean every Node API is supported or a database connection
has been tested. Snapshot counters belong to the serving worker, not the whole
server; zero resources may simply mean this worker has not acquired any yet.

Both formats omit environment variables, filesystem paths, URLs/query/body
values, cookies, authorization, hostnames, IPs and resource names/keys/options.
There is no sensitive-data toggle. Reports use no-store, noindex and restrictive
content/security headers; these are **not access control**. Versions and limits
are still internal information. Protect the page with your application's access
check or remove it after debugging. Cow does not create this route automatically.
There are no external assets or diagnostic network/database probes.

For whole-server counters there is the existing `/_cow/status` JSON endpoint;
`cow.info()` is the page-author's runtime/configuration report, not a replacement
for health checking.
