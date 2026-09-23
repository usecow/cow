# Uploads

Reads an uploaded file, and saves a private copy if you ask it to.

## Installation

Create a project, install Cow, and copy the example into it:

```sh
mkdir my-uploads
cd my-uploads
npm install @cowlang/cow
cp -r node_modules/@cowlang/cow/examples/uploads/site site
```

Start Cow:

```sh
npx @cowlang/cow site
```

Open <http://127.0.0.1:8000>. Saved files go in `data/`, beside `site/`.

> **Warning:** Before accepting uploads from other people, add sign-in and CSRF
> protection, and check file contents. Don't trust the name or type the browser
> sends.
