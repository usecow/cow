# SQLite, forms, and sessions

[Documentation index](README.md)

This guide shows you how to store data in SQLite, save a form submission
safely, print the rows back, and sign a visitor in with a session. The
examples build on each other, so you can follow them in order in one site
folder.

Cow includes a first-party SQLite adapter, `cow:sqlite`. It is backed
by the runtime's `node:sqlite`, so you do not install a database package.

## Open a database and create a table

A small helper is enough to select the database for an application. Create a
`data` folder next to your site folder, because the parent directory of the
database file must already exist. Then save this as `_db.cow` in your site
folder:

```js
<?js
import { sqlite } from 'cow:sqlite'

const db = await sqlite(
  new URL('../data/application.sqlite', import.meta.url)
)

db.exec(`
  CREATE TABLE IF NOT EXISTS herd (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );
`)

export default db
```

SQLite creates `application.sqlite` the first time a page imports this helper.
The `users` table is for the [sign-in example](#sign-a-visitor-in-with-a-session)
later in this guide.

The leading underscore keeps the helper private, so visitors cannot request
it. Import it from any page and use the request-scoped handle directly. You do
not register the database anywhere else.

## Change the schema with migrations

To change the schema after your application has data, list the changes as
migration steps and call `db.migrate()`. Each step runs once, in order.
SQLite's `PRAGMA user_version` records how many steps have run. Save this as
`_db.cow`:

```js
<?js
import { sqlite } from 'cow:sqlite'

const db = await sqlite(
  new URL('../data/application.sqlite', import.meta.url)
)

await db.migrate([
  `CREATE TABLE herd (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  )`,
  "ALTER TABLE herd ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
  (db) => {
    db.run('UPDATE herd SET notes = ? WHERE notes = ?', ['New arrival', ''])
  }
])

export default db
```

A step is a SQL string or a function that receives the database. When you need
another change, add a step to the end of the list.

- Cow runs every pending step in one immediate transaction. If a step fails,
  the whole batch rolls back and `user_version` stays where it was.
- When no step is pending, `migrate()` only reads `user_version`, so a helper
  can call it on every request.
- `migrate()` resolves to the number of steps applied.

> **Warning:** Never edit, reorder, or remove a step that has run. Cow counts
> steps, so a changed step does not run again on an existing database. When the
> database has more steps applied than the list contains, `migrate()` fails
> with `COW_SQLITE_MIGRATION_AHEAD` instead of running older code against a
> newer schema.


To save a form submission, read the body with `form(req)`, read each value
with `field()`, and pass the values to `db.run()` as bound parameters. Save
this as `herd.cow`:

```jsp
<?js
import { field, form } from 'cow:web'
import db from './_db.cow'

if (req.method() === 'POST') {
  const values = form(req)
  db.run('INSERT INTO herd (name, notes) VALUES (?, ?)', [
    field(values, 'name'),
    field(values, 'notes')
  ])
  res.redirect('/herd', 303)
}

const herd = db.all('SELECT id, name, notes FROM herd ORDER BY id')
?>
<!doctype html>
<title>Herd</title>
<h1>Herd</h1>
<ul>
<?js for (const animal of herd) { ?>
  <li><?= h(animal.name) ?>: <?= h(animal.notes) ?></li>
<?js } ?>
</ul>
<form method="post">
  <input name="name" required>
  <input name="notes">
  <button>Add</button>
</form>
```

Open `/herd`, enter `Clover` and `Likes <b>hay</b>`, and select **Add**. Cow
saves the row and redirects back to `/herd` with a `303` status, so reloading
the page does not submit the form again.

Output, with blank lines removed:

```html
<!doctype html>
<title>Herd</title>
<h1>Herd</h1>
<ul>
  <li>Clover: Likes &lt;b&gt;hay&lt;/b&gt;</li>
</ul>
<form method="post">
  <input name="name" required>
  <input name="notes">
  <button>Add</button>
</form>
```

> **Warning:** Never build SQL by joining strings with visitor input. Put a
> `?` or a named placeholder in the SQL, and pass the values as the second
> argument, as `herd.cow` does. SQLite then treats each value as data, never
> as SQL. A name such as `Daisy'); DROP TABLE herd; --` is stored as text and
> prints as `Daisy&#39;); DROP TABLE herd; --`. Values that come back out of
> the database are still visitor input, so print them with `h()`.

The example uses two helpers from `cow:web`:

| Helper | What it does | Errors |
| --- | --- | --- |
| `form(req)` | Parses a URL-encoded form body and returns a `URLSearchParams`. | `415` when the content type is not `application/x-www-form-urlencoded`. `400` / `COW_INVALID_FORM` for malformed percent escapes or UTF-8. |
| `field(values, name)` | Returns one text field, or `''` when the field is missing. | `400` when the form sends the same field more than once. |

For file uploads and multipart forms, see
[forms and file uploads](runtime-api.md#forms-and-file-uploads).

## Query rows

To read data, call `db.get()` for one row or `db.all()` for every row. Save
this as `animal.cow`:

```jsp
<?js
import db from './_db.cow'

const animal = db.get('SELECT id, name, notes FROM herd WHERE id = ?', [req.get('id') ?? null])
const matches = db.all(
  'SELECT id, name FROM herd WHERE name LIKE $pattern ORDER BY id',
  { pattern: 'C%' }
)
?>
<h1><?= h(animal?.name || 'Unknown animal') ?></h1>
<p><?= matches.length ?> name(s) start with C.</p>
```

Open `/animal?id=1`.

Output, with blank lines removed:

```html
<h1>Clover</h1>
<p>1 name(s) start with C.</p>
```

Open `/animal?id=99` and the heading reads `Unknown animal`, because `get()`
returns `undefined` when no row matches.

SQLite cannot bind `undefined`, and `req.get('id')` returns `undefined` when
the URL has no `id`. The `?? null` turns a missing value into SQL `NULL`,
which matches no row.

### Query methods

| Method | What it does | Returns |
| --- | --- | --- |
| `db.exec(sql)` | Runs one or more statements. It is intended for schema setup. | The handle. |
| `db.run(sql, parameters)` | Runs one statement that changes data. | An object with `changes` and `lastInsertRowid`. |
| `db.get(sql, parameters)` | Reads one row. | The row, or `undefined` when no row matches. |
| `db.all(sql, parameters)` | Reads every row. `db.query()` is an alias. | An array of rows. |
| `db.migrate(steps)` | Runs each pending [migration step](#change-the-schema-with-migrations) once, in order. | A promise of the number of steps applied. |

Parameters can be:

- An array, for `?` placeholders.
- An object, for named placeholders such as `$pattern`.
- One scalar, for one placeholder.

These operations are synchronous because `node:sqlite` is synchronous. Only
acquiring the database and managed transaction callbacks use `await`.

## Group writes in a transaction

To make several writes succeed or fail together, wrap them in
`db.transaction()`. The transaction commits only when its callback succeeds.
If the callback throws, Cow rolls the transaction back. Save this as
`adopt.cow`:

```jsp
<?js
import db from './_db.cow'

const id = await db.transaction(async (transaction) => {
  const result = transaction.run(
    'INSERT INTO herd (name) VALUES (?)',
    ['Ada']
  )
  transaction.run(
    'UPDATE herd SET notes = ? WHERE id = ?',
    ['Arrived with paperwork', result.lastInsertRowid]
  )
  return result.lastInsertRowid
}, { mode: 'immediate' })
?>
<p>Ada is animal number <?= id ?>.</p>
```

Open `/adopt`.

Output:

```html
<p>Ada is animal number 2.</p>
```

`transaction()` returns whatever the callback returns. The `mode` option is
`deferred` (the default), `immediate`, or `exclusive`.

> **Note:** A response cannot finish while a SQLite transaction is open. Cow
> reports `COW_SQLITE_RESPONSE_IN_TRANSACTION` and rolls back instead of
> sending a misleading success. This includes reaching the end of the page
> with a transaction still open. Finish the transaction first, and then call
> `res.redirect()`, `res.json()`, or another method that ends the response.

### Transaction rules

- Nested `transaction()` calls use savepoints.
- `begin()`, `commit()`, and `rollback()` are also available for manual
  control.
- Cow rolls back any open transaction when the request ends, including a
  transaction started through raw `exec('BEGIN')`. Unfinished work cannot leak
  into the next request.
- A handle that you keep past its request rejects further use.
- Await managed transactions one after another. Cow rejects overlapping use of
  the same handle.
- Inside a managed callback, Cow rejects manual control and
  transaction-control SQL.
- Define SQL triggers outside managed callbacks. Cow conservatively treats
  their `BEGIN`/`END` syntax as control SQL.

### Response checks for adapter authors

Adapters can define a synchronous `beforeResponse(facade)` check. It runs
before terminal response operations and normal page completion, while the
request still owns its resources. The SQLite adapter uses it for the
open-transaction check above.

- Throwing fails the response. Release then runs with that failure.
- The check must not return a promise or finish a response itself.

See [persistent resources](resources.md) for the rest of the adapter contract.

## Sign a visitor in with a session

`cow:web` provides URL-encoded form parsing, duplicate-field checks,
cookies, SQLite-backed sessions with CSRF tokens, password hashing, and HTML
escaping. These are small functions that you use through ordinary imports.

`session(db, req, res, options)` opens the visitor's session, or creates one
and sends its cookie. Session data is JSON that Cow stores in the same SQLite
database, in a table named `cow_sessions`.

> **Note:** Cow 0.0.1 named this table `jin_sessions` and the default cookie
> `jin_session`. When a site upgrades, Cow renames the table the first time it
> opens a session, and moves each visitor to the `cow_session` cookie on their
> next visit, so nobody is signed out. If a database already has a
> `cow_sessions` table, Cow uses it and leaves `jin_sessions` alone.

### Remember a visitor

Save this as `visits.cow`:

```jsp
<?js
import { session } from 'cow:web'
import db from './_db.cow'

const current = await session(db, req, res, { name: 'herd_session' })
const visits = (current.data.visits || 0) + 1
current.update({ ...current.data, visits })
?>
<p>You have opened this page <?= visits ?> time(s).</p>
```

Open `/visits`, and then reload the page.

Output of the second request:

```html
<p>You have opened this page 2 time(s).</p>
```

Nothing is saved for you at the end of the request, which differs from PHP's
`$_SESSION`. Call `update()` to save.

### Create an account and sign in

This example adds four pages: one to join, one to sign in, one that requires a
signed-in visitor, and one to sign out.

1. Save this as `join.cow`. It hashes the password and stores the account with
   bound parameters:

   ```jsp
   <?js
   import { field, form, hashPassword, session } from 'cow:web'
   import db from './_db.cow'

   const current = await session(db, req, res, { name: 'herd_session' })

   if (req.method() === 'POST') {
     const values = form(req)
     current.verify(values)
     db.run('INSERT INTO users (name, password_hash) VALUES (?, ?)', [
       field(values, 'name'),
       await hashPassword(field(values, 'password'))
     ])
     res.redirect('/signin', 303)
   }
   ?>
   <!doctype html>
   <title>Join</title>
   <form method="post">
     <input type="hidden" name="csrf" value="<?= h(current.csrfToken) ?>">
     <label>Name <input name="name" required></label>
     <label>Password <input name="password" type="password" minlength="12" required></label>
     <button>Join</button>
   </form>
   ```

1. Save this as `signin.cow`. It checks the password, and then moves the
   visitor to a fresh session that holds their user ID:

   ```jsp
   <?js
   import { field, form, session, verifyPassword } from 'cow:web'
   import db from './_db.cow'

   const current = await session(db, req, res, { name: 'herd_session' })
   let error = ''

   if (req.method() === 'POST') {
     const values = form(req)
     current.verify(values)
     const user = db.get(
       'SELECT id, password_hash FROM users WHERE name = ?',
       [field(values, 'name')]
     )
     const valid = await verifyPassword(field(values, 'password'), user?.password_hash)
     if (user && valid) {
       await current.replace({ userId: user.id })
       res.redirect('/account', 303)
     }
     res.status(401)
     error = 'Incorrect name or password.'
   }
   ?>
   <!doctype html>
   <title>Sign in</title>
   <?js if (error) { ?>
   <p><?= h(error) ?></p>
   <?js } ?>
   <form method="post">
     <input type="hidden" name="csrf" value="<?= h(current.csrfToken) ?>">
     <label>Name <input name="name" required></label>
     <label>Password <input name="password" type="password" required></label>
     <button>Sign in</button>
   </form>
   ```

   `res.redirect()` ends the page. The lines that set the `401` status run
   only when the sign-in fails.

1. Save this as `account.cow`. It sends anyone who is not signed in to
   `/signin`. The redirect ends the page, so the HTML below it runs only for a
   signed-in visitor:

   ```jsp
   <?js
   import { session } from 'cow:web'
   import db from './_db.cow'

   const current = await session(db, req, res, { name: 'herd_session' })
   const user = db.get('SELECT name FROM users WHERE id = ?', [current.data.userId ?? -1])
   if (!user) res.redirect('/signin', 303)
   ?>
   <!doctype html>
   <title>Account</title>
   <p>Signed in as <?= h(user.name) ?>.</p>
   <form method="post" action="/signout">
     <input type="hidden" name="csrf" value="<?= h(current.csrfToken) ?>">
     <button>Sign out</button>
   </form>
   ```

1. Save this as `signout.cow`:

   ```jsp
   <?js
   import { form, session } from 'cow:web'
   import db from './_db.cow'

   const current = await session(db, req, res, { name: 'herd_session' })
   current.verify(form(req))
   current.destroy()
   res.redirect('/signin', 303)
   ```

1. Open `/join`, and create an account named `Clover` with a password of 12 or
   more characters. Cow redirects you to `/signin`.

1. Sign in with the same name and password. Cow redirects you to `/account`.

Output of `/account`, with blank lines removed. Your `csrf` value differs:

```html
<!doctype html>
<title>Account</title>
<p>Signed in as Clover.</p>
<form method="post" action="/signout">
  <input type="hidden" name="csrf" value="4db957b5061a24d41f5d3e58701fabea706e48da5da45b6b067bca09d07bfbf3">
  <button>Sign out</button>
</form>
```

A wrong password gets a `401` response with the message
`Incorrect name or password.` Select **Sign out**, and `/account` redirects to
`/signin` again.

> **Warning:** Three habits keep sessions safe.
>
> - Call `await current.replace(data)` when a visitor signs in. It changes
>   both the session ID and the CSRF token, so a session ID from before the
>   sign-in stops working.
> - Put `current.csrfToken` in a hidden `csrf` field in every form that
>   changes data, and call `current.verify(values)` before you act on the
>   form. A missing or wrong token throws HTTP 403.
> - Session cookies are `HttpOnly` and `SameSite=Lax` by default, but they are
>   not `Secure` by default. On an HTTPS site, pass `secure: true` to
>   `session()`.

The helpers behave as follows:

| Helper | What it does |
| --- | --- |
| `hashPassword(password)` | Returns a salted scrypt hash to store. It throws HTTP 422 unless the password has between 12 and 256 characters. The scrypt profile is fixed. |
| `verifyPassword(password, encoded)` | Returns `true` or `false`. An unknown user, where `encoded` is `undefined`, still pays the normal password-hashing cost. |
| `current.verify(values)` | Compares the form's `csrf` field with the session's CSRF token. It throws HTTP 403 when they differ or when the session has ended. |

This example leaves out duplicate-name handling and sign-in rate limits. See
[the forum guide](../examples/forum/README.md) for a worked example of
sessions, CSRF, password hashing, and deployment limitations.

### Session updates and expiry

A session object saves data only when you ask it to, and it renews its expiry
only when you call `touch()`:

```js
import { session } from 'cow:web'
const current = await session(db, req, res, { name: 'my_site', maxAge: 3600 })
current.update({ ...current.data, theme: 'dark' }) // save JSON data, keep ID and CSRF
current.touch() // explicitly renew expiry and the browser cookie for one hour
```

| Member | What it does |
| --- | --- |
| `data` | Returns a detached JSON snapshot. Changing the snapshot does not save anything. |
| `csrfToken` | The CSRF token for this session. |
| `expiresAt` | The expiry time, as a Unix timestamp in seconds. |
| `update(data)` | Replaces the stored data. It is not a shallow merge. |
| `refresh()` | Reloads the current snapshot and returns its data. |
| `touch()` | Renews expiry to the current time plus `maxAge` without changing the ID or CSRF token. It emits matching `Max-Age` and `Expires` attributes. |
| `await replace(data)` | The sign-in and identity-rotation operation. It changes both the session ID and the CSRF token. |
| `destroy()` | Deletes the current identity regardless of snapshot version, and expires the cookie. |

Reads and updates do not renew expiry. Expiry is fixed by default, and only
`touch()` renews it.

#### Conflicts and ended sessions

- Updates, renewal, and replacement use optimistic version checks. A stale
  write throws HTTP 409 / `COW_SESSION_CONFLICT`, even if another request
  changed the data back to its earlier value.
- After a conflict, refresh, recompute, and explicitly retry if that is
  appropriate. Cow never automatically repeats application work.
- Deleted, expired, or rotated identities throw HTTP 403 /
  `COW_SESSION_ENDED`. Cow never recreates authenticated data.
- A sign-out targets that identity. It does not target all sessions for an
  account, or an identity that another request already rotated.
- Await a replacement before you start other operations on the same session.
  Otherwise, Cow throws HTTP 409 / `COW_SESSION_BUSY`.

#### Cleanup

- Opening a session removes up to 100 expired records, including on returning
  visits.
- `pruneSessions(db, { limit: 1000 })` explicitly removes up to that many
  expired records and returns their count. You can repeat the call. There is
  no hidden background cleanup service.
- Cow upgrades an existing four-column session table with a version column
  when the table is first opened. The upgrade preserves existing identities
  and data.

#### Headers, transactions, and JSON

- Cookie-changing operations must come before the response headers are
  committed. `update()` and `refresh()` do not emit cookies.
- Use session operations outside managed application transactions. Session
  changes are explicit database writes, and Cow does not roll them back
  automatically with the HTTP response.
- JSON serialization rules apply. For example, bigint values and cycles throw.
- There is no implicit end-of-request persistence.

### Cookie helpers

To store a small value in the browser without a session, use `setCookie()` and
`cookies()`. Save this as `theme.cow`:

```jsp
<?js
import { cookies, setCookie } from 'cow:web'

const theme = req.get('theme')
if (theme === 'dark' || theme === 'light') {
  setCookie(res, 'theme', theme, { maxAge: 60 * 60 * 24 * 30 })
}
?>
<p>Saved theme: <?= h(cookies(req).theme || 'none') ?></p>
```

Open `/theme?theme=dark`. The response carries this header. The page still says
`none`, because the browser has not sent the cookie back yet:

```text
set-cookie: theme=dark; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000
```

Then open `/theme`.

Output:

```html
<p>Saved theme: dark</p>
```

`setCookie(res, name, value, options)` appends a `Set-Cookie` field without
replacing other cookies. The defaults are `Path=/`, host-only, `HttpOnly`, and
`SameSite=Lax`.

| Option | Value |
| --- | --- |
| `path` | The cookie path. |
| `domain` | An ASCII hostname. Cow normalizes a leading dot away. |
| `expires` | A valid `Date`, with a year from 1601 through 9999. |
| `maxAge` | Non-negative integer seconds. |
| `secure` | A boolean. |
| `httpOnly` | A boolean. |
| `sameSite` | `Lax`, `Strict`, or `None`. |

- Names use HTTP token characters. Brackets are not implicit cookie arrays.
- Values are URI-encoded, and `cookies(req)` decodes them.
- Duplicate names or malformed percent encodings read as `undefined`.

`deleteCookie(res, name, options)` uses the same scope and flags, and emits
`Max-Age=0` with an expired date. To delete a scoped cookie, pass the original
path and domain.

Cow validates cookies before it sets any header:

- Unknown options, invalid flags, and unsafe attribute values throw.
- `SameSite=None` requires `Secure`.
- A `__Secure-` name requires `Secure`. A `__Host-` name also requires
  `Path=/` and no `Domain`.
- Cow does not perform DNS, public-suffix, or current-host checks on a domain.
  The browser decides whether to accept it.

### Session options

`session()` accepts `name` (the cookie name, `cow_session` by default) and
`maxAge` (the session lifetime in seconds, 28800 by default, which is eight
hours). It also accepts the cookie scope and flag options that are described
above. It does not accept `expires`, because the session's stored lifetime
controls its expiry.

## SQLite connection options

Pass options as the second argument: `sqlite(filename, options)`.

| Option | Default | Notes |
| --- | --- | --- |
| `readOnly` | `false` | |
| `foreignKeys` | `true` | Restored at the start of every request. |
| `timeout` or `busyTimeout` | `5000` | Milliseconds. Also restored per request. |
| `readBigInts` | `false` | Statement result behavior. |
| `returnArrays` | `false` | Statement result behavior. |
| `allowBareNamedParameters` | `true` | Statement binding behavior. |
| `allowUnknownNamedParameters` | `false` | Statement binding behavior. |
| `doubleQuotedStringLiterals` | `false` | |

Native SQLite extensions are disabled. With `readBigInts: true`, convert
bigint values to strings before you pass them to `res.json()`, because JSON
has no bigint representation.

### Connections and workers

- Each worker owns one connection for each distinct filename and connection
  configuration.
- Multiple workers can therefore access the same on-disk file. `:memory:`
  creates a separate database in every worker.
- Keep queries and transactions short. A synchronous SQLite operation occupies
  its worker, and a long write transaction can make other workers wait up to
  the busy timeout.
- Connections close during normal worker recycling and graceful shutdown.

The adapter uses the runtime's built-in SQLite implementation and
transaction-state checks. No third-party native package is required. See
[runtime support](runtimes.md) for supported versions and Bun's
connection-close workaround.

## See also

- [Standard library](standard-library.md) for the inventory of JS/Web APIs,
  supported Node.js APIs, Cow helpers, and remaining gaps.
- [CSV contract and examples](standard-library.md#csv-contract-and-examples)
  for CSV import and export with `parseCsv()` and `stringifyCsv()` from
  `cow:csv`.
- [Persistent resources](resources.md) for how adapters such as SQLite keep
  connections across requests.
- [The forum guide](../examples/forum/README.md) for a complete application
  with sessions, CSRF, and password hashing.
