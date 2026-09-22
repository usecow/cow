# Cow editor support (local, optional)

This extension supplies Cow `.cow` and JSP/TSP language modes, HTML with embedded JS/TS
highlighting, snippets and textual `req.`, `res.` and `cow.` API suggestions.
It never evaluates a site, starts a server, modifies settings or runs a build.
The `$cow-check` problem matcher can consume `cow check` output in an optional
VS Code task.

After a project-local Cow installation, the extension is at
`node_modules/@cowlang/cow/editor/vscode/`. Load it in an extension-development
window using absolute paths:

```sh
code --extensionDevelopmentPath=/absolute/path/to/my-site/node_modules/@cowlang/cow/editor/vscode /absolute/path/to/my-site/site
```

Quote paths containing spaces. This does not require publishing an extension
or logging into a marketplace. If another JSP extension owns the file type,
choose **Cow**, **Cow JSP** or **Cow TSP** from the language-mode selector for that file.
Nothing changes which extensions Cow's server executes.

From a source checkout, use its `editor/vscode/` directory instead. Installing
the npm package does not install the extension in VS Code.

`cowjs` / `cowts` insert a code block. In `.cow` files, `cowhelper` starts a
code-only helper with an export, and `cowimport` imports a private helper.
Shared snippets include `cowh` for escaped
HTML, `cowinclude` with an explicit await, `cowform`, `cowjson`, and `cowupdate`.
API suggestions are textual: they do not resolve shadowed bindings, aliases,
HTML versus code context, or types. Highlighting is not syntax validation.
Use `cow check` for compiler diagnostics. This is not a full JSP/TSP language
server, formatter, debugger or template type checker.

Cow helpers use the same tagged syntax highlighting as pages. The package's
API declarations can also support standalone TS or JSDoc helpers. This extension
does not add `.cow` module resolution to TypeScript; see the
[authoring guide](../../docs/authoring.md).
The automated editor tests validate contributions and provider behavior with a
VS Code API stub.
