# Cow website

Cow's homepage, documentation, examples, and comparison pages, built with Cow.

From the repository root:

```sh
node bin/cow.mjs website/site --port 4180 --workers 2
```

Open http://127.0.0.1:4180. No extra dependencies or frontend build step.

The homepage (`site/index.cow`) uses `assets/home-alt.css` and `assets/home-alt.mjs`.
Its displayed source and `/welcome` endpoint share `_welcome.cow`. The form works
without browser JavaScript and updates inline when JavaScript is available.

The hello form submits to a real `hello.cow` endpoint. JavaScript/TypeScript example switching and copy buttons are progressive enhancements. The form works without client JavaScript. Cow escapes the submitted name; the site does not evaluate visitor-provided code.

The installation guide covers npm releases, project-local and global commands,
and local package archives. Its availability note distinguishes an unpublished
build from an installable registry release.

The site hosts its two typefaces locally. Body text uses Funnel Sans, and headings, buttons, the nav, and the wordmark use Lexend. Both are licensed under the SIL Open Font License. Their licenses are in `site/assets/FUNNEL-SANS-OFL.txt` and `site/assets/LEXEND-OFL.txt`. Outfit, the earlier typeface (`site/assets/OFL.txt`), is still used by the icon gallery and is available in the font picker. The two roles are the `--font-body` and `--font-heading` tokens at the top of `site/assets/site.css`.

The `docs/`, `why/`, and `examples/` directories contain public pages. `_site.cow` provides the shared layout and code highlighting; `_article.cow` renders guide content from `_docs.cow` and `_pages.cow`. Documentation search filters locally with JavaScript and also accepts a `q` query on the server. The source files and private helpers are not public routes.

The logo and favicon share `cow-mark.svg`; `favicon.svg` is an identical alias.
JavaScript-only controls are hidden if the browser script does not run.

## Preview other body fonts

To compare body fonts on the real pages, start the site with `COW_SITE_FONTS=1`:

```sh
node --env-file=website/.env.fonts bin/cow.mjs website/site --port 8130
```

A font picker appears in the bottom-right corner. It has one dropdown for the body font and one for the heading font, loads the fonts from Google Fonts, and remembers your choice across pages. This mode relaxes the content security policy to allow Google Fonts, so use it only for local previews. Without the variable, the picker and the relaxed policy are both absent.

Verify with `node --test website/website.test.mjs` and `node bin/cow.mjs check website/site`.
