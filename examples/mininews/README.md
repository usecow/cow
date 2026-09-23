# MiniNews

A tiny news CMS built in Cow. Supports Markdown, drafts, and more. Built on
SQLite.

## Installation

Create a project, install Cow, and copy MiniNews into it:

```sh
mkdir my-news
cd my-news
npm install @cowlang/cow
cp node_modules/@cowlang/cow/examples/mininews/site/news.cow .
```

Start Cow:

```sh
npx @cowlang/cow .
```

Open <http://127.0.0.1:8000/news> and enter the key from `_news.setup-key` to
create your editor account.

## Show news on another page

To list the latest stories on another page, include `news.cow`:

```jsp
<?js
await include('./news.cow', {
  mode: 'feed',
  url: '/news',
  limit: 5
})
?>
```

- `mode: 'feed'`: show stories that have been published. No drafts.
- `url`: location where `news.cow` lives on your server. Stories will use this
  path.
- `limit`: how many stories to show, 1-50. Defaults to `5`.

## Before you go live

- Serve it over HTTPS. Behind a reverse proxy that forwards plain HTTP, set
  `secure: true` in the `session(...)` options in `news.cow`.
- Delete `_news.setup-key` after setup.

## Tests

From the repository root:

```sh
npm test --prefix examples/mininews
```
