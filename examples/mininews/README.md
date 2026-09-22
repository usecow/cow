# MiniNews — one-file news editor

A small original CuteNews-inspired example, not a clone or an import of its code.
A Nordic-minimal web interface: warm paper tones, muted green, serif headings,
flat sections, clear action hierarchy, labeled controls and compact tables.
A dashboard separates the overview from the news list.
There is no CSS framework, editor package, build step or separate setup script.
A small, optional browser script adds Markdown buttons; the editor works without it.

The Nordic identity stays distinct: Apple's [branding](https://developer.apple.com/design/human-interface-guidelines/branding)
guidance supports custom headline typography alongside readable system UI text.
The design adapts interaction principles from Apple's [typography](https://developer.apple.com/design/human-interface-guidelines/typography),
[buttons](https://developer.apple.com/design/human-interface-guidelines/buttons),
[accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility/)
and [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
guidance for the web; it is not a native Apple UI or a claim of HIG certification.
It uses locally available fonts without downloads, 44 CSS-pixel control
targets, a keyboard skip link, visible focus/press states and semantic status text.
Light/dark and increased/forced-contrast appearances follow browser preferences.
Text uses relative sizes and the layout reflows; native forms remain usable when
the optional formatting script is unavailable. No custom motion is used.
Preview explicitly says it is unsaved and links back to the editor. Publication
help explains what saving does; save feedback confirms public or private state.
Deletion remains a separate confirmation page, not the primary editor action.

## Drop it in

[Install Cow locally](../../docs/getting-started.md) in your project. Copy
**only `node_modules/@cowlang/cow/examples/mininews/site/news.cow`** into your own
writable `site/` directory. From a source checkout, the file is
`examples/mininews/site/news.cow`.

```sh
npm exec --offline -- cow site
```

Visit `/news`. Do not keep your editable application or database in `node_modules`.
Renaming the page works too; `updates.cow` is reached at `/updates`.
It imports the `cow:web` and `cow:sqlite` helpers already provided by Cow.

On the first visit it creates `_news.sqlite` and a random `_news.setup-key`
beside the page. Read the key from disk, enter it on the setup page and create
your editor account (password: 12–256 characters). The setup key is never shown
to visitors. The installer locks once the account exists. The key file can be
removed after setup; it is not used by the installed editor. Keep the database.

The source is one file, **not** the data. SQLite may also create journal/WAL
sidecars. Cow blocks underscore-prefixed paths and SQLite files from web access.
Other web servers need equivalent private-file protection. Use HTTPS for real
logins. Cookies use the direct request scheme; forwarded headers are not trusted.
When an HTTPS reverse proxy forwards plain HTTP to Cow, set `secure: true` in
the `session(...)` options in your copied `news.cow`. The built-in CLI sees the
HTTP connection, not the browser's HTTPS connection. Do not enable Secure
cookies for an ordinary local HTTP preview.

Run the example from this checkout:

```sh
node ./bin/cow.mjs ./examples/mininews/site --host 127.0.0.1 --port 0
```

Open the address printed by Cow with `/news` appended. No other example's data
is used.

## Write and publish

- Log in to the dashboard: real draft/published counts, recent stories and shortcuts.
- Choose **Add news**, enter an article title and a full story.
- The optional short story is used in listings. Otherwise an excerpt is shown.
- Formatting buttons wrap selected text in Markdown. They never save or publish.
- **Preview** renders the submitted Markdown without saving or publishing it.
- Choose **Draft** or **Published**, then **Save news**.
- **Edit news** lists both drafts and published items, with title search/paging.
- **Help / About** contains formatting, integration and private-data instructions.
- Edit changes the stored item; switching to Draft removes it from public views.
- Delete is POST-only, with a confirmation page/checkbox and stale-version check.

Visitors see only published entries, ten per page, with individual permalinks.
The editor is intentionally one account: no roles, comments, media uploads,
password reset emails, scheduled publishing, plugins or rich-text editor.

Sessions have an eight-hour lifetime. Login rotates the session identity; logout
revokes it. Every form uses CSRF protection. Passwords are salted scrypt hashes.
Login attempts use one persistent, bounded bucket (eight per fifteen minutes).
That simple lockout can also block the legitimate editor during an attack; it
is not a full abuse-prevention system. Competing edits fail with 409 and retain
the submitted text. Double submissions reuse the existing item while it still
exists; open Add news again for another item. This is not a permanent replay log
after deletion.

## Markdown subset

Supports paragraphs/line breaks, `#` through `######` headings, `**bold**`,
`*italic*`, backtick inline code, fenced code, flat bullet/numbered lists,
blockquotes and `[links](https://example.com)`.

Raw HTML is escaped. Links allow HTTP, HTTPS, mailto and explicit `/site`, `#hash`
or `./relative`/`../relative` references; unsafe schemes are omitted. Images,
HTML blocks, nested lists, tables, link titles and full CommonMark behavior are
not implemented. Keep URLs with parentheses percent-encoded. Raw article HTML
and code are displayed as text, never executed. Preview and public
output use the same renderer. Bodies are limited to 20,000 characters.

Both story fields have optional bold, italic, heading, list, quote, link and
inline-code buttons. These insert literal Markdown and respect field length
limits. Preview shows the short and full stories separately. The fixed inline
script is allowed by its CSP hash; raw story text never becomes executable code.

## Include news on an existing page

```html
<h1>My website</h1>
<?js await include('./news.cow', { mode: 'feed', url: '/news', limit: 5 }) ?>
```

For a nested editor, use its actual paths, for example
`include('./updates/news.cow', { mode: 'feed', url: '/updates/news', limit: 5 })`.
The explicit URL builds item links; it is not read from an untrusted query.
The limit is 1–50. Feed mode is selected by include locals only: it ignores form
actions/query view switches, makes no login session, does not change response
headers and emits a `.cow-news` fragment without a document/editor layout.
It uses the same adjacent database as the standalone page; parent CSS supplies
the fragment's appearance. Unconfigured/empty feeds display an empty-state line.

## Data and boundaries

Back up the database with the server stopped (or a proper SQLite backup tool);
do not copy a live SQLite main file while ignoring its journal. To move/rename
the editor, also move/rename its `_name.sqlite` data to match the new page stem.
Session cookie names depend on the database path, so moving it requires login
again. The generated setup key is private; never commit live credentials/data.
There are no default credentials or automatic demo posts.

## Verification and disposable demo

The example carries its own tests: `npm test` from `examples/mininews/`
exercises installation, Markdown safety, preview/publishing, includes,
sessions, conflicts and concurrent submissions. The runtime's separate
package-install test also runs a single-file copy from the archive.

For a temporary local demo, run `npm run preview` from `examples/mininews/` in
this checkout. It prints an address and a random test login, and adds three demo items
in a temporary directory. It does not touch the example's real data or ship
those credentials/posts. Stop it with Ctrl+C to remove that temporary demo.
