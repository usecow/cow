import ts from './syntax.mjs'
import { lexTemplate } from './lexer.mjs'
import { templateFormat } from './template-format.mjs'
import { trustHtml } from './html-trust.mjs'

// Best-effort syntax highlighting for Cow templates and code, sharing the
// compiler's lexer so block boundaries (strings, comments, regexes, `?>`
// rules) always match what actually compiles. Unlike the compiler this module
// never throws: malformed source still highlights as far as it lexes.

const kind = ts.SyntaxKind
const trivia = new Set([
  kind.WhitespaceTrivia, kind.NewLineTrivia, kind.SingleLineCommentTrivia,
  kind.MultiLineCommentTrivia, kind.ShebangTrivia, kind.ConflictMarkerTrivia
])
// After these a slash is division; otherwise try a regex. Highlighting keeps
// the cheap token heuristic (no parser fallback): `)` counts as an expression
// end here, so `if (x) /re/` shades as division — an accepted imperfection.
const expressionEnd = new Set([
  kind.Identifier, kind.PrivateIdentifier, kind.NumericLiteral, kind.BigIntLiteral,
  kind.StringLiteral, kind.RegularExpressionLiteral, kind.NoSubstitutionTemplateLiteral,
  kind.TemplateTail, kind.CloseBracketToken, kind.CloseParenToken, kind.TrueKeyword,
  kind.FalseKeyword, kind.NullKeyword, kind.ThisKeyword, kind.SuperKeyword
])
const strings = new Set([
  kind.StringLiteral, kind.NoSubstitutionTemplateLiteral,
  kind.TemplateHead, kind.TemplateMiddle, kind.TemplateTail
])

// Contextual keywords that read as members far more often than keywords.
const memberish = new Set([kind.GetKeyword, kind.SetKeyword, kind.ConstructorKeyword])

function classify(token, previous, code, end) {
  if (token === kind.SingleLineCommentTrivia || token === kind.MultiLineCommentTrivia) return 'comment'
  if (strings.has(token)) return 'string'
  if (token === kind.NumericLiteral || token === kind.BigIntLiteral) return 'number'
  if (token === kind.RegularExpressionLiteral) return 'regex'
  const property = previous === kind.DotToken || previous === kind.QuestionDotToken
  const identifierish = token === kind.Identifier || memberish.has(token) ||
    (property && token >= kind.FirstKeyword && token <= kind.LastKeyword)
  if (identifierish) return /^\s*\(/.test(code.slice(end, end + 8)) ? 'call' : 'text'
  if (token >= kind.FirstKeyword && token <= kind.LastKeyword) return 'keyword'
  return 'text'
}

function* codeTokens(code) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, code)
  const templates = []
  let previous
  let last = 0
  for (let token = scanner.scan(); token !== kind.EndOfFileToken; token = scanner.scan()) {
    if ((token === kind.SlashToken || token === kind.SlashEqualsToken) && !expressionEnd.has(previous)) {
      token = scanner.reScanSlashToken()
    } else if (token === kind.CloseBraceToken && templates.length) {
      if (templates[templates.length - 1] === 0) {
        token = scanner.reScanTemplateToken(false)
        if (token === kind.TemplateTail) templates.pop()
      } else templates[templates.length - 1]--
    } else if (token === kind.OpenBraceToken && templates.length) {
      templates[templates.length - 1]++
    }
    if (token === kind.TemplateHead) templates.push(0)
    const end = scanner.getTextPos()
    yield { type: classify(token, previous, code, end), value: code.slice(last, end) }
    last = end
    if (!trivia.has(token)) previous = token
  }
  if (last < code.length) yield { type: 'text', value: code.slice(last) }
}

// "html-string"-led tokens are quoted values; `>` closes the tag itself.
const attrPattern = /"[^"]*"?|'[^']*'?|\/?>|[^\s"'=/>]+|[\s=/]+/g

function emitAttributes(segment, push) {
  for (const part of segment.match(attrPattern) || []) {
    if (part === '>' || part === '/>') push('html-tag', part)
    else if (part[0] === '"' || part[0] === "'") push('html-string', part)
    else if (/[^\s=/]/.test(part)) push('html-attr', part)
    else push('text', part)
  }
}

// Text regions are HTML fragments; a tag or comment interrupted by a Cow
// block (`<a href="<?= url ?>">`) carries its state into the next region.
function emitHtml(text, state, push) {
  let cursor = 0
  if (state.inComment) {
    const end = text.indexOf('-->')
    const stop = end === -1 ? text.length : end + 3
    push('html-comment', text.slice(0, stop))
    if (end === -1) return
    state.inComment = false
    cursor = stop
  }
  if (state.inTag) {
    const end = text.indexOf('>', cursor)
    const stop = end === -1 ? text.length : end + 1
    emitAttributes(text.slice(cursor, stop), push)
    if (end === -1) return
    state.inTag = false
    cursor = stop
  }
  const pattern = /<!--[\s\S]*?(?:-->|$)|<![^<>]*(?:>|$)|<\/?[a-zA-Z][^<>]*(?:>|$)/g
  pattern.lastIndex = cursor
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    push('text', text.slice(cursor, match.index))
    const value = match[0]
    if (value.startsWith('<!--')) {
      push('html-comment', value)
      state.inComment = !value.endsWith('-->')
    } else if (value.startsWith('<!')) {
      push('html-tag', value)
      state.inTag = !value.endsWith('>')
    } else {
      const name = value.match(/^<\/?[a-zA-Z][\w:.-]*/)[0]
      push('html-tag', name)
      emitAttributes(value.slice(name.length), push)
      state.inTag = !value.endsWith('>')
    }
    cursor = match.index + value.length
  }
  push('text', text.slice(cursor))
}

export function highlightTokens(source, { language = 'ts', code = false } = {}) {
  source = String(source)
  if (source.charCodeAt(0) === 0xFEFF) source = source.slice(1)
  const tokens = []
  const push = (type, value) => { if (value) tokens.push({ type, value }) }
  if (code) {
    for (const token of codeTokens(source)) push(token.type, token.value)
    return tokens
  }
  let blocks
  try {
    blocks = lexTemplate(source, { language: language === 'js' ? 'js' : 'ts', tags: ['<?js', '<?ts'], fail: () => {} })
  } catch {
    push('text', source)
    return tokens
  }
  // Block values exclude their delimiters, so every gap between blocks is a
  // Cow tag: `<?js`, `<?ts`, `<?=` or `?>`.
  const html = { inTag: false, inComment: false }
  let cursor = 0
  for (const block of blocks) {
    if (block.start > cursor) push('tag', source.slice(cursor, block.start))
    if (block.type === 'text') emitHtml(block.value, html, push)
    else for (const token of codeTokens(block.value)) push(token.type, token.value)
    cursor = block.start + block.value.length
  }
  if (cursor < source.length) push('tag', source.slice(cursor))
  return tokens
}

const escapeHtml = value => String(value).replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

export function highlight(source, { language, filename, code, classPrefix = 'cow-' } = {}) {
  if (language === undefined && filename) language = templateFormat(filename)?.language
  return trustHtml(highlightTokens(source, { language, code }).map(({ type, value }) =>
    type === 'text' ? escapeHtml(value) : `<span class="${classPrefix}${type}">${escapeHtml(value)}</span>`
  ).join(''))
}
