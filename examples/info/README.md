# Runtime information

`cow.info()` shows a page about the running Cow server, like PHP's `phpinfo()`.

```jsp
<?js cow.info() ?>
```

## Installation

Save the line above as `info.cow` in your site, then start Cow:

```sh
npx @cowlang/cow my-site
```

Open <http://127.0.0.1:8000/info>.

> **Warning:** The page reveals versions and limits. Protect it, or delete it
> when you're done.
