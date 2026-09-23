# MiniNews

MiniNews is a news editor in a single Cow file. Write stories in Markdown, save
drafts, and publish them. It has one editor account, and it stores everything in
SQLite.

## Run it

Copy `site/news.cow` into a folder, for example `my-site/news.cow`, and start
Cow:

```sh
npx @cowlang/cow my-site
```

Open <http://127.0.0.1:8000/news>. On the first visit, MiniNews creates
`_news.sqlite` and a setup key in `_news.setup-key`, next to the page. Enter the
key on the setup page to create your editor account. Visitors can't read either
file.

From a clone of this repository, after `npm install` at the root:

```sh
npm start --prefix examples/mininews
```

For a throwaway demo with sample stories and a random login:

```sh
npm run preview --prefix examples/mininews
```

## Show news on another page

To list the latest published stories on any page, include `news.cow` in feed
mode:

```jsp
<h1>My website</h1>
<?js await include('./news.cow', { mode: 'feed', url: '/news', limit: 5 }) ?>
```

`url` is where the editor lives, and `limit` can be 1 to 50.

## Before you go live

- Serve the site over HTTPS. If a reverse proxy handles HTTPS and forwards plain
  HTTP to Cow, set `secure: true` in the `session(...)` options in your copy of
  `news.cow`.
- Back up `_news.sqlite` with the server stopped, or with a SQLite backup tool.
- Delete `_news.setup-key` after setup. MiniNews doesn't need it again.

MiniNews supports headings, bold, italic, code, lists, quotes, and links in
Markdown, and it escapes raw HTML. It has no roles, comments, image uploads, or
password reset.

## Tests

```sh
npm test --prefix examples/mininews
```
