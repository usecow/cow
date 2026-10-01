# Persistent resources

[Documentation index](README.md)

Cow runs every page fresh on each request, but a database connection should
outlive one request. This page explains how a Cow-aware package keeps a
connection open across requests, and how to write such an adapter with
`defineResource()`.

If you only want SQLite or Postgres, skip this page.
[`cow:sqlite`](sqlite-sessions.md) and [`cow:postgres`](postgres.md) are
already adapters, and you use them with an ordinary import.

## Use a Cow-aware package

Pages use ordinary imports. A Cow-aware package hides connection reuse behind its
normal application API.

In these examples, `@acme/cow-mysql` stands in for a Cow-aware adapter
package. Save this as `_db.cow`:

```js
<?js
import { mysql } from '@acme/cow-mysql'

export default await mysql({
  url: process.env.DATABASE_URL,
  maxConnections: 5
})
```

Then import the helper from a page:

```jsp
<?js
import db from './_db.cow'

const users = await db.query('select id, name from users')
?>
<?js for (const user of users) { ?>
  <p><?= h(user.name) ?></p>
<?js } ?>
```

Cow evaluates the local `_db.cow` helper for every request. The adapter
package is different. Cow loads it in the persistent worker realm, where it
keeps its connections between requests.

## Write an adapter with `defineResource()`

Inside the adapter package, import `defineResource()` from the
`@cowlang/cow/resource` export:

```js
// Inside a Cow-aware adapter package
import { defineResource } from '@cowlang/cow/resource'

const acquirePool = defineResource({
  name: 'mysql',

  key(options) {
    return `${options.url}:${options.maxConnections}`
  },

  async open(options) {
    return createPool(options)
  },

  async acquire(pool, { request, signal }) {
    return createRequestFacade(pool, { request, signal })
  },

  async release(facade, { error }) {
    await facade.finish({ rollback: Boolean(error) })
  },

  async close(pool) {
    await pool.close()
  }
})

export function mysql(options) {
  return acquirePool(options)
}
```

`createPool()` and `createRequestFacade()` are the adapter's own code.
`defineResource()` returns a function. Call it with options to get the
request's facade.

| Member | Required | What it does |
| --- | --- | --- |
| `name` | Yes | Names the adapter. |
| `key(options)` | Yes | Returns a string that identifies one resource instance. It must be synchronous. |
| `open(options, context)` | Yes | Opens the persistent resource, such as a pool. The context carries `worker` and `root`, the site directory. |
| `acquire(resource, context)` | No | Returns the value that one request uses. The context carries `options`, `request`, `signal`, and `root`. |
| `release(value, outcome)` | No | Runs when the request finishes. `outcome.error` is set when the request failed. |
| `close(resource)` | Yes | Closes the persistent resource. |

An adapter can also define a synchronous `beforeResponse(facade)` check. See
[response checks for adapter authors](sqlite-sessions.md#response-checks-for-adapter-authors).

Options must be structured-cloneable, so a persistent adapter cannot
accidentally retain a request VM through its configuration.

### Declare native entry points

Adapter authors declare exact native entry points in their `package.json`:

```json
{ "cow": { "native": ["./index.mjs"] } }
```

- Only these entries and their native dependency graph use the Node.js worker
  lifetime. An ordinary package is not automatically an adapter.
- Calling `defineResource` from request code fails with
  `COW_RESOURCE_DEFINITION_SCOPE`. Definitions retain callbacks, so they must
  live inside the declared native entry.
- Native entries reject query and fragment variants. They require an ESM
  `import`, not a CommonJS `require`.
- Changes to native adapter code require a restart.

`@cowlang/cow/sqlite` and `@cowlang/cow/postgres` already declare their
native entries.

To load a driver that the site installed, resolve it from `root`, as
`cow:postgres` does with `pg`. A driver found that way lives in the worker
realm with the adapter.

## Resource lifetime

- Cow opens resources lazily and keys them per worker. It hashes the key
  before it stores or reports it.
- Concurrent and repeated acquisitions of the same key in one request return
  one memoized facade.
- Cow releases leases in reverse acquisition order, after success or failure.
- Persistent resources close before normal worker recycling or shutdown. After
  a hard timeout or a process crash, only the operating system and the remote
  service can notice the lost connection.

### Teardown

Teardown stops new resource acquisitions. It waits for acquisitions that Cow
already accepted, and then releases their leases. This covers a
`Promise.all()` that rejects before a sibling acquisition finishes.

A stuck acquisition or release is still bounded by the request execution
timeout. Forced termination cannot run ordinary cleanup hooks. Application
code should continue to await its work.

## Size pools and limits

> **Note:** Every worker opens its own instance. With four workers and a
> five-connection adapter pool, the application can open up to 20 connections.
> Size pools with the worker count in mind.

Resource instances are bounded per execution worker. The default limit is 64,
and it includes pending opens and acquisitions.

- At capacity, Cow closes the least recently used **idle** instance before it
  opens another.
- If every slot is in use, acquisition fails with `COW_RESOURCE_LIMIT` (503).
  Cow never closes an active lease to make room.
- The limit counts adapter instances, not connections inside an adapter's own
  pool.
- Adapter registrations have a separate limit, which is 128 by default.

## Failures and cleanup

An acquire, reset, or release failure poisons that instance:

1. Cow blocks new leases on the instance.
1. Cow closes the instance after all existing leases finish.
1. After a successful close, the next acquisition opens a fresh instance.

If the close itself fails, the instance remains quarantined, and Cow replaces
the worker after the request. Cow neither repeatedly retries the failed close
nor opens more handles beside it. This also applies to failed idle eviction.
Failed shutdown still reports an error.

Adapter authors must clean up partially opened handles if `open()` rejects,
because Cow never receives those handles.

Cow retains rendering failures, resource release and close failures, and
cleanup-hook failures as bounded `cause`/`errors` trees in embedded errors and
server logs.

> **Warning:** Cleanup does not imply rollback of writes that are already
> committed. Temporary tables, `:memory:` SQLite databases, and other
> connection-local state disappear on eviction or replacement. Use a
> disk-backed database for persistent application data.

## See also

- [SQLite, forms, and sessions](sqlite-sessions.md) for the adapter that ships
  with Cow.
- [Request lifecycle](request-lifecycle.md) for when a request starts, ends,
  and cleans up.
- [Embedding Cow](embedding.md) for running pages from your own program.
