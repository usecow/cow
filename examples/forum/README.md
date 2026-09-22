# Cow Commons

A small, single-board forum made from ordinary Cow pages, shared includes,
and SQLite. There is no client-side JavaScript, frontend build, ORM, service
registry, or framework router. This is a working example and a runtime proving
ground, not a production-ready forum distribution.

## Run an installed example

[Install Cow locally](../../docs/getting-started.md) in a project with an empty
`site/` directory. Copy the contents of
`node_modules/@cowlang/cow/examples/forum/site/` into it. Copy
`node_modules/@cowlang/cow/examples/forum/setup.mjs` to the project root, then run:

```sh
node setup.mjs
npm exec --offline -- cow site --port 8002 --workers 2
```

Open `http://127.0.0.1:8002/install` and use the private setup key to create your
administrator. Keep the generated `data/` directory beside `site/`, outside
the served root. Do not edit or store application data inside `node_modules`.

## Run from this repository

Use Node 22.16 or newer. The example is a self-contained project with its own
`package.json` and tests. From the repository root:

```sh
npm install
cd examples/forum
npm start
```

Open `http://127.0.0.1:8002/install`. The prestart command prints a private
setup key; enter it and choose an administrator username and password. Then
log in, start a discussion, and use another browser profile to register a
member. There are no default credentials. Installation is transactional and
permanently locks after the first administrator is created.

The forum uses port 8002 and two workers. For another port or runtime options,
from `examples/forum/`:

```sh
npm run setup
node ../../bin/cow.mjs site --port 8003 --workers 2
```

The setup command is repeatable. It never resets an existing database or
replaces a setup key, and stops printing the key after installation. Forum
data lives in `examples/forum/data/forum.sqlite`, outside the served directory.

## What members can do

- Read topics without an account; register, log in, and log out.
- Start a topic or reply to an unlocked one.
- Edit their own posts, with stale-edit detection. Topic titles are fixed in
  this first version; the opening post can be edited like any other post.
- Read paginated topics and replies, ten per page by default.

The administrator can also lock/unlock a topic and remove any post. Locking
stops replies and edits for everyone, including the administrator. Removing
a post erases its body and leaves a tombstone; later replies, page positions,
and post IDs remain intact. Removal has a confirmation page and no undo.
Removing the first post does not remove the topic title or its replies.
Admins cannot edit another member's words; they can only remove that post.

Usernames are case-insensitive. Passwords are hashed with Cow's scrypt helper;
passwords and setup keys are never put in URLs or echoed into forms. Login
rotates the server-backed session ID. Sessions live in SQLite, so switching
workers or restarting the server does not log everyone out. Logging out
invalidates that session, not other members' sessions.

All member content is plain text. `h()` escapes it on output; HTML and Markdown
are not interpreted. The app supplies CSP and no-store response headers.

## Where things live

- `site/_config.cow`: forum name, database/setup-key locations, page size,
  secure cookies, and the `registrationOpen` switch. It is an ordinary module
  imported by this app, not a required Cow configuration format.
- `site/_db.cow`: the small schema and request-scoped SQLite handle.
- `site/_auth.cow`: installation, accounts, session checks, form validation,
  and shared login-attempt counters.
- `site/_forum.cow`: queries and transactional posting/moderation rules.
- `site/index.cow`, `topic.cow`, `new.cow`, `edit.cow`, `moderate.cow`: routes.
- `site/_header.cow`, `_footer.cow`, `_pagination.cow`, `_account.cow`: shared
  markup, rendered with `await include(path, locals)`.
- `site/assets/site.css`: responsive plain CSS, system fonts, and keyboard
  focus styles. No external assets or tracking.

Underscore paths are private to HTTP, but this is not the permission system.
Every protected route checks the session. Every database mutation rechecks
ownership or administrator role, rather than trusting form fields. The app
assumes it is mounted at `/`; a URL prefix requires adapting links/actions.

## Writes and concurrency

Each mutation uses a short `IMMEDIATE` SQLite transaction. Topic creation and
its opening post commit together. A reply checks the lock inside the same
transaction that inserts it, so a concurrent lock and reply have a definite
commit order. No application-level reply counter can lose an increment.

Successful writes redirect with HTTP 303 only after commit. A per-form key
deduplicates topic/reply submissions, scoped to the authenticated author. A
key reused with different content returns 409. Post versions reject stale
edits with 409; the submitted text stays visible for manual reconciliation.
If a topic was locked or a post removed while its edit form was open, the
unsaved text is still shown. Moderation also checks versions to avoid acting
on content changed since the confirmation page was opened.

Replies are ordered by ID and removals keep their position. New replies move
a topic up the listing. Topic-list pagination is a live view, not a frozen
snapshot: new activity can move a topic between pages while you browse.

Unexpected storage errors return a server error, never a success redirect.
Transactions roll back; the app does not retry uncertain writes automatically.
For a generic server failure, the browser Back button may recover form text,
but the application does not promise recovery of unsaved text after a crash.

## Before exposing it publicly

This example proves request/session/transaction behavior, not comprehensive
abuse resistance or production capacity. It deliberately omits email, account
recovery, bans, registration/posting throttles, attachments, rich text,
notifications, private messages, multiple boards, realtime updates, and schema
upgrades. The login counter limits attempts per username across workers but
is not a complete brute-force or denial-of-service defense.

For an Internet-facing deployment, first plan moderation, anti-spam and
registration limits, account recovery, disk quotas, backups/restoration, and
schema upgrades. Set `registrationOpen: false` to close new registrations;
existing members can still log in. Do not treat this switch as rate limiting.

Serve the entire site over HTTPS and explicitly set
`COW_FORUM_SECURE_COOKIES=1`; forwarded headers are not trusted to decide cookie
security. Run Cow in production mode, keep it on loopback behind your reverse
proxy, restrict `/_cow/status`, and restrict filesystem access to the private
data directory. Use a local disk, not a network filesystem, for SQLite.

Back up the database using SQLite's backup facilities, or stop Cow cleanly
before copying its data. Do not copy only a live `.sqlite` file while ignoring
its WAL. A restored database also restores its sessions; consider invalidating
them as part of a restore procedure. Public deployment and restore drills are
separate work; they have not been validated by this example's tests.

Cow runs trusted server code. Its fresh request VM is not a hostile-code
security boundary, and separate users of the forum are not separate OS tenants.

## Verification

The forum's integration tests live in this example, not the runtime's root
suite. From `examples/forum/`:

```sh
npm test
```

The forum integration tests use isolated temporary databases and two workers.
They cover account isolation, forged roles/authors, ownership, CSRF, stale
edits, parallel replies and duplicate POSTs, lock races, tombstone removal,
pagination, failed-write rollback, expired sessions, worker recycling/server
restart, login throttling, private files, and setup/registration races.

For a disposable browser preview (never your example data), from
`examples/forum/`:

```sh
npm run preview
```

It prints a temporary local URL and setup key. Stop that process with Ctrl+C
to close the server and remove only its own temporary preview data.
