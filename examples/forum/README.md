# Cow Commons

A small forum built with Cow and SQLite.

## Installation

Create a project, install Cow, and copy the forum into it:

```sh
mkdir my-forum
cd my-forum
npm install @cowlang/cow
cp -r node_modules/@cowlang/cow/examples/forum/site site
cp node_modules/@cowlang/cow/examples/forum/setup.mjs .
node setup.mjs
```

Start Cow:

```sh
npx @cowlang/cow site --port 8002 --workers 2
```

Open <http://127.0.0.1:8002/install> and enter the setup key that `setup.mjs`
printed. The database goes in `data/`, beside `site/`.

## Files

- `site/_config.cow`: forum settings
- `site/_db.cow`: schema
- `site/_auth.cow`: accounts and sessions
- `site/_forum.cow`: topics, replies, and moderation

## Before you go live

- Serve it over HTTPS and set `COW_FORUM_SECURE_COOKIES=1`.
- Set `registrationOpen: false` in `site/_config.cow` to close sign-ups.
- Add what it leaves out: email, account recovery, spam protection, and rate
  limits.

## Tests

From the repository root:

```sh
npm test --prefix examples/forum
```
