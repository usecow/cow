# Cow Commons

Cow Commons is a small forum built from ordinary Cow pages and SQLite. Members
can register, start topics, reply, and edit their own posts. An administrator
can lock topics and remove posts.

It's an example of a real app, not a forum you should deploy as-is.

## Run it

From a clone of this repository, after `npm install` at the root:

```sh
npm start --prefix examples/forum
```

It prints a setup key. Open <http://127.0.0.1:8002/install>, enter the key, and
create the administrator account.

To run it from an installed copy of Cow, copy `site/` and `setup.mjs` from
`node_modules/@cowlang/cow/examples/forum/` into your project, then run:

```sh
node setup.mjs
npx cow site --port 8002 --workers 2
```

The forum keeps its database in `data/forum.sqlite`, next to `site/` and outside
the served folder.

## How it fits together

- `site/_config.cow`: the forum name, page size, and whether registration is
  open.
- `site/_db.cow`: the schema and the database handle.
- `site/_auth.cow`: accounts, sessions, and sign-in.
- `site/_forum.cow`: topics, replies, and moderation.
- `site/index.cow`, `topic.cow`, `new.cow`, `edit.cow`, and `moderate.cow`: the
  pages.

## Before you go live

Cow Commons leaves out email, account recovery, spam protection, rate limits,
and schema upgrades. Plan for those first. Then:

- Serve the whole site over HTTPS, and set `COW_FORUM_SECURE_COOKIES=1`.
- Set `registrationOpen: false` in `site/_config.cow` to close sign-ups.
- Back up with SQLite's backup tools, or stop Cow before copying the database
  and its WAL file.

## Tests

```sh
npm test --prefix examples/forum
```

To try it in a browser without touching your data, run
`npm run preview --prefix examples/forum`. It uses a temporary database and
removes it when you stop the server.
