# Documentation style guide

[Documentation index](README.md)

Cow's docs follow the [Google developer documentation style guide](https://developers.google.com/style)
and borrow page structure from the [GitLab documentation style guide](https://docs.gitlab.com/development/documentation/styleguide/)
and the [PHP manual](https://www.php.net/manual/en/). When this page does not
answer a question, use Google's guide.

This guide applies to `docs/*.md`, the example READMEs, and the website guides in
`website/site/_docs.cow`.

## Who you are writing for

Write for someone who knows HTML and some JavaScript, wants a working page
soon, and might read English as a second language. Answer "how do I do this?"
before "how does Cow do this?"

## Voice

- Talk to the reader as "you". Do not use "we" or "the user".
- Use present tense and active voice: "Cow escapes the value", not "the value
  will be escaped".
- Be conversational, not chatty. Contractions are fine in guides. Write
  "do not" when a negative matters, and in reference tables.
- Put the condition before the instruction: "To read every value, call
  `req.getAll(name)`."
- Leave out "simply", "just", "easy", "obviously", and "please". If a step were
  easy for everyone, nobody would be reading about it.
- Write "for example" and "that is", not "e.g." and "i.e.".
- Say what the reader can do, not what Cow "allows" or "enables".
- Say what the reader does, not what they can skip. Do not list the things
  that the reader "does not need", such as a build step, a config file, a
  framework, or a registry. That list is the homepage's pitch. In a guide, it
  answers a question that the reader did not ask, and it names tools that they
  may never have used. Mention a missing step once, in the place where a
  reader would otherwise go and do it, and state it as a fact about Cow: "Cow
  has no configuration file."
- Keep docs timeless. Avoid "currently", "new", "now", and "soon". Put
  unreleased behavior behind a clear label instead.
- Keep cow puns out of instructions, reference text, and error messages. A
  heading or an example name can have some fun. Steps cannot.

## Sentences and words

- One idea per sentence. If a sentence has a semicolon or a second "and",
  try two sentences.
- Use serial commas: "Node.js, Bun, Deno, and Nub".
- Use sentence case for headings: "Read uploaded files".
- Start task headings with a verb ("Read uploaded files"). Use a noun phrase
  for concepts and reference ("Request lifetime").
- Spell out zero through nine. Use numerals for 10 and above, and for anything
  with a unit, a version, or a status code.
- Define a term once, then use the same word every time.

### Word list

| Use | Meaning | Not |
| --- | --- | --- |
| Cow | The web runtime and its `cow` command. | the Cow language |
| runtime | Node.js, Bun, Deno, or Nub. Write "JavaScript runtime" on first mention, and wherever a reader could confuse it with Cow. It matches the `--runtime` flag. | host, platform |
| engine | The JavaScript engine inside a runtime: V8 or JavaScriptCore. | runtime |
| host | Only the HTTP Host header, a hostname, or a machine. | a name for Node.js, Bun, Deno, or Nub |
| page | A `.cow` file that answers a URL. | template, view |
| include | A `.cow` file rendered into another page with `include()`. | partial |
| helper | A code-only `.cow` file that other files import. | library file |
| private file | A file or folder whose name starts with `_`. Cow never serves it. | hidden file |
| Node.js | The runtime. Write `node` only for the command or the `--runtime` value. | Node, NodeJS |

## Page structure

Every page starts with one or two sentences that say what the page helps you
do. Then choose the structure that matches the page type.

### Task pages

Use these for "how do I" topics, such as handling a form.

1. Say what the reader ends up with.
1. List prerequisites, if there are any.
1. Give numbered steps. One action per step. Put the result of a step in the
   same step, after the action.
1. Show the complete file, not a fragment, the first time a file appears.
1. End with what to read next.

### Concept pages

Use these for "how does it work" topics, such as the request lifetime. Open with
the plain-language rule. Follow it with a small example. Put the precise
details and edge cases after the example, not before it.

### Reference pages

Use these for lookup, such as the request API. Follow the PHP manual's entry
layout, and keep the same order for every entry:

1. **Signature**, in a code span or block: `req.getAll(name)`.
1. **Description**: one sentence that starts with a verb. "Returns every value
   of a query parameter, in URL order."
1. **Parameters** and **return value**, including what comes back when the
   thing is missing.
1. **Errors**: the status code and `COW_*` code, when there is one.
1. **Example**, with its output.
1. **Notes** for surprises and security advice.
1. **See also** links.

Short entries can fit in a table row. Give an entry its own heading when it
needs an example or a note.

### Troubleshooting

Use the error text or the symptom as the heading. Then give the cause and the
fix, in that order.

## Examples

Examples are the most-read part of any page, so treat them as the main content.

- Make every example complete enough to paste into a file and run.
- Name the file in the sentence before the code block: "Save this as
  `contact.cow`:".
- Show the result. Follow the example with the URL to open and an **Output:**
  block, in the way the PHP manual does.
- Keep examples small. One idea per example. Use a second example for the
  variation.
- Escape output with `h()` in every example that prints request data, even
  when escaping is not the point of the example.
- Use realistic, friendly names: `name`, `notes`, `Clover`. Avoid `foo` and `bar`.
- Use `example.com`, `example.test`, and `127.0.0.1` for hosts.
- Write placeholders in capitals inside code, and explain them after the block:
  "Replace `SITE_DIRECTORY` with the path to your site."
- Tag every code block with a language: `jsp` for pages (GitHub highlights the
  `<? ?>` tags), `html` for rendered output, `js`, `ts`, `sh`, `json`, or `text`.
- Run every example before you publish it. Paste the real output, not the
  output you expect.

### Coming from PHP

Many readers know PHP. When Cow matches PHP, say so in one clause, because it
lets those readers skip ahead: "`null` prints nothing, as in PHP." When Cow
differs from PHP in a way that can surprise someone, use a note.

## Notes and warnings

Use a callout for information that a reader must not miss, and no more than
two or three on a page. If everything is a note, nothing is.

```md
> **Note:** Something that is surprising, but not dangerous.

> **Warning:** Something that can lose data, leak data, or open a security hole.
```

Do not hide a warning inside a long paragraph. Do not use a note for
information that belongs in the main text.

## Links

- Describe the destination: "See [forms and file uploads](runtime-api.md#forms-and-file-uploads)",
  not "see [here](runtime-api.md#forms-and-file-uploads)".
- Use relative links inside `docs/`.
- Link the first mention of another topic in a section, not every mention.

## Accuracy comes first

Friendly wording never replaces a precise fact. Keep every limit, default,
status code, error code, and version number exact. When you make a sentence
shorter, check that it still says the same thing. If a detail only matters to a
few readers, move it lower on the page instead of deleting it.

## Checklist

Before you send a docs change:

- [ ] The first two sentences say what the page is for.
- [ ] Every example names its file, runs as written, and shows its output.
- [ ] Steps are numbered, with one action in each.
- [ ] No "simply", "just", "easy", "e.g.", or "i.e.".
- [ ] No "you do not need X, Y, or Z" lists. The page says what to do.
- [ ] Lists use serial commas, and headings use sentence case.
- [ ] Warnings about security or data loss are callouts, not buried text.
- [ ] Limits, defaults, and error codes match the code and the tests.
