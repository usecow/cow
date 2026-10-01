# Standard-library coverage

[Documentation index](README.md)

Use this page to find out which everyday website tasks you can do in a Cow
page, which API covers each one, and where the boundaries are. It also holds
the reference for Cow's CSV helpers.

This inventory compares website-author tasks, not function counts or PHP
syntax. PHP combines its core language with a broad set of built-in and
optional [extensions](https://www.php.net/manual/en/funcref.php). In the same
way, Cow can use existing JS/Web functionality and request-safe Node.js APIs
without duplicating them under new names.

> **Note:** Availability in the Node.js runtime alone is not evidence that an API
> works in a Cow page. Check the table below, the
> [import matrix](import-compatibility.md), and the
> [language contract](language-contract.md).

## Capabilities

| Website task | Available through | Boundary |
| --- | --- | --- |
| Strings, arrays, maps, sets, regex, JSON | JS intrinsics | No PHP coercion or array-key compatibility. JSON does not encode bigint. |
| Unicode normalization and grapheme segmentation | `String.normalize`, `Intl.Segmenter` | Choose code units, code points, or graphemes deliberately. |
| Dates, time zones, and number or currency display | `Date` and `Intl` | Not a general natural-language date parser or a decimal-money arithmetic library. |
| UTF-8, base64, hex, URL encoding | `TextEncoder`, `TextDecoder`, `Buffer`, `URL`, `URLSearchParams` | Strict UTF-8 decoding is explicit. Bracketed query names remain literal. |
| Files and directories | Supported `node:fs`, `node:fs/promises`, and `node:path` | Full reads and writes work. Raw streams, open handles, and watchers are blocked. |
| Outbound HTTP and JSON services | `fetch`, `Request`, `Response`, `Headers`, `AbortController` | Explicit awaits and cancellation. No blanket compatibility with Node.js HTTP clients. |
| Hashes, random values, and Web Crypto | `node:crypto` and `crypto.subtle` | Worker-level crypto mutation is unsupported. |
| Password verification and HTML escaping | `cow:web` | Fixed scrypt profile. Escaping is for HTML text and quoted attributes, not all contexts. |
| Forms, uploads, and response headers | `req` and `res` APIs, and `cow:web` | Buffered uploads. Explicit streamed file, download, and generated output is available. |
| Cookies and sessions | `cow:web` | SQLite-backed explicit snapshots, conflicts, and renewal. Not PHP's implicit shutdown writes. |
| SQL data and transactions | `cow:sqlite` and `cow:postgres` native adapters | SQLite and Postgres. Postgres needs the site to install `pg`. Other engines require concrete adapters. |
| CSV import and export | `cow:csv` | Buffered text API. No spreadsheet evaluation or automatic header mapping. |
| Cow/HTML syntax highlighting | `@cowlang/cow/highlight` native adapter | Shares the compiler's lexer; best-effort token classification, not a parse. Escaped HTML spans or a raw token stream. |
| XML/DOM, images, archives, and mail | No bundled implementation | `DOMParser` and `Image` globals, and raw `node:zlib`, `node:stream`, and `node:net`, are not exposed. Evaluate packages or adapters when you need them. |

For helper usage, see [SQLite, forms, and sessions](sqlite-sessions.md) and
[file responses, streaming, and error pages](output-and-errors.md).

### How these capabilities are tested

The [request-level audit tests](../test/standard-library.test.mjs) run these
operations inside page execution, including worker reuse. They are
representative checks, not exhaustive certification of every method in a
namespace.

The [session](../test/sessions.test.mjs), [SQLite](../test/sqlite.test.mjs),
[upload](../test/uploads.test.mjs), and [web-helper](../test/web.test.mjs)
tests cover deeper cases.

### Fill a gap with a package

The [import matrix](import-compatibility.md) defines package resolution, and
the [language contract](language-contract.md) lists the supported native
roots. Pure-JS packages can fill gaps, but you must test their compatibility.
Native adapters are trusted code with explicit lifetime responsibility. See
[persistent resources](resources.md).

## CSV contract and examples

`cow:csv` exports `parseCsv()` and `stringifyCsv()`. Both work on
text that is already in memory. Save this as `csv.cow`:

```jsp
<?js
import { parseCsv, stringifyCsv } from 'cow:csv'

const rows = parseCsv('name,notes\nClover,"Likes hay, and naps"\n')
res.setHeader('content-type', 'text/plain; charset=utf-8')
?>
Rows: <?= rows.length ?>
Notes: <?= rows[1][1] ?>
<?= stringifyCsv([['Daisy', 'Says "moo"'], ['Ada', null]]) ?>
```

Open `/csv`.

Output, with blank lines removed:

```text
Rows: 2
Notes: Likes hay, and naps
Daisy,"Says ""moo"""
Ada,""
```

The header row counts as a row, the quoted comma stays inside its cell, and
`null` becomes an empty quoted cell.

To import and export files, combine the helpers with `node:fs/promises`:

```js
import { readFile, writeFile } from 'node:fs/promises'
import { parseCsv, stringifyCsv } from 'cow:csv'

const rows = parseCsv(await readFile('/private/import.csv', 'utf8'))
await writeFile('/private/export.csv', stringifyCsv(rows), { flag: 'wx' })
```

### `parseCsv(text, options)`

Returns an array of rows. Each row is an array of string cells. The result
includes the header row, if the text has one.

- It does no numeric coercion, trimming, header mapping, or ragged-row repair.
- It accepts CRLF, LF, and CR record separators, quoted newlines, doubled
  quotes, and an optional leading BOM.
- Empty input produces no rows. A blank line is one row with one empty cell.
- A character after a closing quote must be a separator or a newline.

**Errors:** Malformed quoting throws `CsvError` / `COW_CSV_SYNTAX`, with a
1-based `line` and a UTF-16 `column`.

### `stringifyCsv(rows, options)`

Returns CSV text for an array of nonempty row arrays.

- Cells can be strings, numbers, booleans, bigint, or `null`. `null` becomes
  empty text.
- It emits CRLF after each row.
- It quotes empty cells, embedded delimiters, quotes, and newlines. Quotes are
  doubled. There is no backslash escape mode.
- It quotes a leading BOM inside a cell, so a round trip preserves it.

These quoting conventions follow the common format that
[RFC 4180](https://www.rfc-editor.org/info/rfc4180/) describes. Accepting
other line endings, Unicode, and variable column counts is intentional.

> **Warning:** CSV quoting is not spreadsheet formula protection. Cow
> preserves cell contents such as `=SUM(A1:A2)` literally. If your application
> exports untrusted text to spreadsheet software, it must choose its own
> formula-neutralization policy.

### Options and limits

Both functions share these options:

| Option | Default | Meaning |
| --- | --- | --- |
| `delimiter` | `,` | One UTF-16 code unit. Quote, CR, LF, and BOM are forbidden. |
| `maxLength` | 16,777,216 code units | Input or output text limit. |
| `maxRows` | 100,000 | |
| `maxColumns` | 10,000 per row | |
| `maxFieldLength` | 1,048,576 code units | Decoded or stringified cell limit. |

- Limits are positive safe integers. Exceeding one throws `COW_CSV_LIMIT`.
- Unknown options and unsupported input types throw `TypeError`.
- The functions are buffered, not streaming parsers.
- Decode file bytes explicitly before you parse them.

The [CSV tests](../test/csv.test.mjs) cover malformed input, limits, empty
rows, embedded line endings, and 150 seeded round trips.

## See also

- [SQLite, forms, and sessions](sqlite-sessions.md) for the database, form,
  cookie, and session helpers.
- [Request and response API](runtime-api.md) for `req`, `res`, and uploads.
- [Import compatibility](import-compatibility.md) for which packages and
  modules a page can import.
