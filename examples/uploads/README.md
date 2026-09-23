# Uploads

A single page that reads an uploaded file and, if you ask it to, saves a private
copy.

## Run it

From a clone of this repository, after `npm install` at the root:

```sh
npm start --prefix examples/uploads
```

Open <http://127.0.0.1:8000>, pick a file, and submit it. The page shows the
file's name and size without saving it. To save it, check
**Keep a private copy**. The page saves the file to `data/`, outside the served
folder. Each file can be up to 256 KiB.

> **Warning:** This is a local learning example. Before you accept uploads from
> other people, add sign-in and CSRF protection, and check each file's
> contents. The browser supplies the file name and type, so don't trust them.

See [forms and file uploads](../../docs/runtime-api.md#forms-and-file-uploads)
for the API and its limits.
