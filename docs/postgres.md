# Postgres

[Documentation index](README.md)

This guide shows you how to connect a Cow site to Postgres, change its schema
with migrations, query rows, and group writes in a transaction.

Cow includes a first-party Postgres adapter, `cow:postgres`. It uses the
[`pg`](https://www.npmjs.com/package/pg) driver, which your site installs.

## Connect to a database

1. In the folder that holds your site, install the driver:

   ```bash
   npm install pg
   ```

   Cow looks for `pg` in your site first, then next to Cow itself.

1. Set `DATABASE_URL` to your connection string, for example
   `postgres://cow:secret@localhost:5432/pasture`.

1. Save this as `_db.cow` in your site folder:

   ```js
   <?js
   import { postgres } from 'cow:postgres'

   export default await postgres(process.env.DATABASE_URL)
   ```

Import the helper from any page. The leading underscore keeps it private, so
visitors cannot request it.

## Change the schema with migrations

To create and change tables, list the changes as migration steps and call
`db.migrate()`. Each step runs once, in order. Cow records each step in a
`cow_migrations` table. Save this as `_db.cow`:

```js
<?js
import { postgres } from 'cow:postgres'

const db = await postgres(process.env.DATABASE_URL)

await db.migrate([
  `CREATE TABLE herd (
    id serial PRIMARY KEY,
    name text NOT NULL
  )`,
  "ALTER TABLE herd ADD COLUMN notes text NOT NULL DEFAULT ''",
  async (tx) => {
    await tx.run('UPDATE herd SET notes = $1 WHERE notes = $2', ['New arrival', ''])
  }
])

export default db
```

A step is a SQL string or a function that receives the transaction. When you
need another change, add a step to the end of the list.

- Cow runs every pending step in one transaction. If a step fails, the whole
  batch rolls back.
- An advisory lock makes other workers and other servers wait while one of
  them migrates.
- When no step is pending, `migrate()` reads one row, so a helper can call it
  on every request.
- `migrate()` resolves to the number of steps applied.

> **Warning:** Never edit, reorder, or remove a step that has run. Cow counts
> steps, so a changed step does not run again on an existing database. When the
> database has more steps applied than the list contains, `migrate()` fails
> with `COW_POSTGRES_MIGRATION_AHEAD` instead of running older code against a
> newer schema.

## Query rows

Every query method returns a promise, so `await` it. Pass values as bound
parameters, with `$1`, `$2`, and so on in the SQL. Save this as `herd.cow`:

```jsp
<?js
import db from './_db.cow'

if (req.method() === 'POST') {
  const values = await req.formData()
  await db.run('INSERT INTO herd (name) VALUES ($1)', [values.get('name')])
  res.redirect('/herd')
}

const animals = await db.all('SELECT name FROM herd ORDER BY id')
?>
<form method="post">
  <input name="name" required>
  <button>Add</button>
</form>
<ul>
<?js for (const animal of animals) { ?>
  <li><?= animal.name ?></li>
<?js } ?>
</ul>
```

Open `/herd`, and add Clover.

Output:

```html
<ul>
  <li>Clover</li>
</ul>
```

### Query methods

| Method | What it does | Returns |
| --- | --- | --- |
| `db.exec(sql)` | Runs SQL without parameters. It is intended for schema setup. | A promise that resolves when the SQL has run. |
| `db.run(sql, parameters)` | Runs one statement that changes data. | A promise of `{ changes, rows }`. `rows` holds any `RETURNING` rows. |
| `db.get(sql, parameters)` | Reads one row. | A promise of the row, or `undefined` when no row matches. |
| `db.all(sql, parameters)` | Reads every row. `db.query()` is an alias. | A promise of an array of rows. |
| `db.transaction(callback, options)` | Runs the callback in a [transaction](#group-writes-in-a-transaction). | A promise of what the callback returns. |
| `db.migrate(steps)` | Runs each pending [migration step](#change-the-schema-with-migrations) once, in order. | A promise of the number of steps applied. |
| `db.inTransaction` | Reports whether a transaction is open on this handle. | `true` or `false`. |

Parameters can be an array, or one value for one placeholder. To read the id
of a new row, add `RETURNING id` and read `result.rows[0].id`.

### Values

`pg` converts column types to JavaScript values:

- `timestamp`, `timestamptz`, and `date` columns arrive as `Date` objects.
- `json` and `jsonb` columns arrive as objects and arrays.
- `bigint` and `numeric` columns arrive as strings, because a JavaScript number
  cannot hold every value exactly.

## Group writes in a transaction

To make several writes succeed or fail together, wrap them in
`db.transaction()`. The transaction commits only when its callback succeeds.
If the callback throws, Cow rolls the transaction back. Save this as
`adopt.cow`:

```jsp
<?js
import db from './_db.cow'

const id = await db.transaction(async (tx) => {
  const result = await tx.run(
    'INSERT INTO herd (name) VALUES ($1) RETURNING id',
    ['Daisy']
  )
  await tx.run(
    'UPDATE herd SET notes = $1 WHERE id = $2',
    ['Arrived with paperwork', result.rows[0].id]
  )
  return result.rows[0].id
})
?>
<p>Daisy is animal number <?= id ?>.</p>
```

Open `/adopt`.

Output:

```html
<p>Daisy is animal number 2.</p>
```

Run the queries through `tx`, the handle that the callback receives. A
transaction holds one connection from the pool, and only `tx` uses it.

To choose an isolation level, pass `{ isolation: 'repeatable read' }` or
`{ isolation: 'serializable' }`. The default is Postgres's `read committed`.

> **Note:** A response cannot finish while a Postgres transaction is open. Cow
> reports `COW_POSTGRES_RESPONSE_IN_TRANSACTION` and rolls back instead of
> sending a misleading success. Await the transaction first, and then call
> `res.redirect()`, `res.json()`, or another method that ends the response.

### Transaction rules

- A nested `tx.transaction()` call uses a savepoint. If its callback throws,
  only the nested work rolls back.
- When the request ends with a transaction still open, Cow closes its
  connection, and Postgres rolls the transaction back. Unfinished work cannot
  leak into the next request.
- A handle that you keep past its request rejects further use with
  `COW_POSTGRES_REQUEST_ENDED`.

## Stop work when the visitor leaves

When a visitor disconnects, a query that is already running finishes, but the
next query fails with `COW_REQUEST_CANCELLED`. A page that loops over many
queries stops early. Its open transaction rolls back.

## Connection options

Pass options as the second argument, `postgres(url, options)`, or pass one
object: `postgres({ connectionString, max })`.

| Option | Default | Notes |
| --- | --- | --- |
| `connectionString` or `url` | none | A `postgres://` URL. Required. |
| `max` | `5` | Connections in each worker's pool. |
| `connectTimeout` | `10000` | Milliseconds to wait for a connection. |
| `idleTimeout` | `30000` | Milliseconds before an idle connection closes. |
| `statementTimeout` | `0` | Milliseconds before Postgres cancels a statement. `0` means no limit. |
| `ssl` | none | Passed to `pg`'s `ssl` option, for example `{ rejectUnauthorized: true }`. |

### Connections and workers

- Each worker keeps one pool for each distinct connection string and option
  set. The pool stays open between requests.
- A site can therefore open up to `workers × max` connections. Keep that below
  the server's `max_connections`.
- Pools close during normal worker recycling and graceful shutdown.

### Sessions

The [session helpers](sqlite-sessions.md#sign-a-visitor-in-with-a-session) in
`cow:web` store sessions in SQLite. A site that uses Postgres for its data can
keep its sessions in a SQLite file.

## Troubleshooting

### cow:postgres needs the pg package

Cow could not find `pg` in your site or next to Cow. In the folder that holds
your site, run `npm install pg`.

## See also

- [SQLite, forms, and sessions](sqlite-sessions.md) for the SQLite adapter and
  session helpers.
- [Persistent resources](resources.md) for how adapters keep connections
  across requests.
