# Cow upload example

A single page exercising multipart fields, request-owned uploads and explicit
saving. No setup script or configuration file is needed.

From a Cow checkout:

```sh
node ./bin/cow.mjs ./examples/uploads/site --port 8003
```

Open http://127.0.0.1:8003. The default action reads a file and reports its name
and size without saving it. Checking **Keep a private copy** saves it under a
generated `.bin` name in `examples/uploads/data/`, outside the served directory.
That directory is created only when saving. Saved copies remain until you remove
them; they are not request-temporary data. The per-file limit here is 256 KiB.

With a local installation, copy `node_modules/@cowlang/cow/examples/uploads/site` into
your own example directory, then run `cow ./your-example/site --port 8003`.
The page imports `cow:web`, so keep it underneath your application's package
installation. Saved copies go into `your-example/data/`, not `node_modules`.

This is a localhost learning example, not a public file-sharing application.
Before accepting uploads from other users, decide who may save, add appropriate
authentication/CSRF protection and validate content for its intended use. The
browser-supplied name and media type are not evidence that a file is safe.
Do not serve or execute uploaded content from this example.

See the [upload API](../../docs/runtime-api.md#forms-and-file-uploads) for limits, error
handling, request lifetime and the buffered-memory implementation's boundaries.
