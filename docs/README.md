# Cow documentation

Cow is a web runtime for JavaScript and TypeScript. Use this index to find the
guide for what you want to do. If you have not used Cow before, start with
[Getting started](getting-started.md).

## Write a website

- [Getting started](getting-started.md): npm installation, your first page, local archives, deployment, and `cow check`.
- [Pages and helpers](templates.md): tags, inline code, includes, and private `.cow` modules.
- [Request and response API](runtime-api.md): page bindings, request metadata, forms, and uploads.
- [Diagnostics](runtime-api.md#diagnostics): the `cow.info()` page and JSON report.
- [SQLite, forms, and sessions](sqlite-sessions.md): queries, transactions, session updates, and cookie helpers.
- [Output and errors](output-and-errors.md): error pages, private file downloads, and streaming.
- [Authoring](authoring.md): optional declarations and editor support.

## Understand how Cow works

- [Language contract](language-contract.md): fresh request state and supported semantics.
- [Request lifecycle](request-lifecycle.md): async work, cleanup, and module boundaries.
- [Persistent resources](resources.md): explicit resource adapters and their lifetime.
- [Import compatibility](import-compatibility.md): native APIs and packages.
- [Standard library](standard-library.md): implemented functionality and coverage gaps.
- [JavaScript runtimes](runtimes.md): Node.js, Bun, Deno, and Nub selection and limits.
- [Embedding](embedding.md): execute requests or start a server from another program.
- [Operations](operations.md): limits, worker recovery, shutdown, and private status endpoints.

## Contribute to the docs

- [Documentation style guide](STYLEGUIDE.md): voice, page structure, examples, and the word list.
- [Compiler implementation](compiler.md): compilation workers, the lexer, and the benchmark.
