# Compiler implementation

[Documentation index](README.md)

These notes help contributors work on Cow's compiler. They cover the
compilation workers, the lexer, and the compiler benchmark.

## Compilation workers

`CowApp` uses a dedicated compilation worker for cold entry pages and a bounded
LRU cache in the dispatcher. Entry source reads, cold-compilation admission,
queued compiled results, cached results, and includes have separate documented
bounds. A large transform can be terminated without stopping the HTTP event
loop or an unrelated execution worker. Includes compile within an execution
worker and share that request's deadline. Low-level synchronous compiler
utilities intentionally remain available for tools and offline builds.

[Isolation tests](../test/compiler-isolation.test.mjs) use a stalled worker
fixture for deterministic deadline checks, alongside real large-source tests
for cancellation and shutdown. Syntax regressions are in the
[compiler](../test/compiler.test.mjs) and [lexer](../test/lexer.test.mjs) tests.

## Lexical architecture

The dedicated [Cow lexer](../lib/lexer.mjs) scans original source in text,
code, and echo modes using the pinned TypeScript scanner. It preserves strings,
comments, regexes, and template literals and their interpolations as lexical
values rather than treating their tag-looking text as a boundary. Echo contents
are expressions. Ordinary code tags share their pending syntax context across
HTML. Helpers use the same lexer without inserting output statements for
surrounding whitespace.

JavaScript slash recognition needs syntactic context. Unambiguous token
contexts take a fast path. Ambiguous cases use the TypeScript parser on the
retained code prefix, with inert HTML output and echo-expression wrappers. Safe
top-level statement checkpoints discard irrelevant earlier context. Source
offsets stay attached to tokens for diagnostics and source maps.

## Run the benchmark

Run `npm run bench:compiler` from the checkout. It measures lexer and complete
compiler time for plain blocks, division, regular expressions, and contextual
slash cases. Each fixture has one warmup and three samples per input size.
Complete compilation includes lexing. Do not add the two timings together.

Ambiguous slash cases can reparse an unfinished construct, so the lexer is not
guaranteed linear for all inputs. The benchmark excludes filesystem access,
worker messaging, HTTP handling, and peak memory.

## See also

- [Server operations](operations.md#compilation-and-retained-state) for the
  compiler limits and their defaults.
- [Language contract](language-contract.md) for the page and helper rules that
  the compiler implements.
