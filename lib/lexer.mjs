import ts from './syntax.mjs'

const kind = ts.SyntaxKind
const trivia = new Set([
  kind.WhitespaceTrivia, kind.NewLineTrivia, kind.SingleLineCommentTrivia,
  kind.MultiLineCommentTrivia, kind.ShebangTrivia, kind.ConflictMarkerTrivia
])
const opaque = new Set([
  ...trivia, kind.StringLiteral, kind.RegularExpressionLiteral,
  kind.NoSubstitutionTemplateLiteral, kind.TemplateHead, kind.TemplateMiddle, kind.TemplateTail
])
// Unambiguous lexical goals avoid invoking a parser for ordinary arithmetic or
// a regex on the right-hand side of an operator. Braces, parentheses, TS `!`,
// contextual keywords and identifiers after a line break use the parser below.
const expressionStart = new Set([
  kind.OpenParenToken, kind.OpenBracketToken, kind.CommaToken, kind.SemicolonToken,
  kind.EqualsToken, kind.EqualsGreaterThanToken, kind.QuestionToken, kind.ColonToken,
  kind.PlusToken, kind.MinusToken, kind.AsteriskToken, kind.AsteriskAsteriskToken,
  kind.PercentToken, kind.AmpersandToken, kind.BarToken, kind.CaretToken,
  kind.AmpersandAmpersandToken, kind.BarBarToken, kind.QuestionQuestionToken,
  kind.SlashToken, kind.SlashEqualsToken
])
const expressionEnd = new Set([
  kind.Identifier, kind.PrivateIdentifier, kind.NumericLiteral, kind.BigIntLiteral,
  kind.StringLiteral, kind.RegularExpressionLiteral, kind.NoSubstitutionTemplateLiteral,
  kind.TemplateTail, kind.CloseBracketToken, kind.TrueKeyword, kind.FalseKeyword,
  kind.NullKeyword, kind.ThisKeyword, kind.SuperKeyword
])

// JavaScript's slash token has a syntactic lexical goal: even a closing brace
// can precede division (an object/function expression) OR a regex (a statement
// block). Let the pinned JS/TS parser decide that goal in the stitched program,
// not in an isolated Cow block. The sentinel is never evaluated or emitted.
function startsRegex(prefix, language) {
  const at = prefix.length
  const parsed = ts.createSourceFile('cow-lexical-goal', prefix + '/__cow_lex__/',
    ts.ScriptTarget.Latest, false, language === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS)
  const visit = node => {
    if (node.pos > at || node.end <= at) return
    if (ts.isRegularExpressionLiteral(node) && node.getStart(parsed) === at) return true
    return ts.forEachChild(node, visit)
  }
  return !!visit(parsed)
}

// A forward scanner owns Cow's text/code/echo modes. TypeScript supplies JS/TS
// lexical values and slash disambiguation; it still validates the final program.
// Context uses inert output statements for HTML, and the same expression wrapper
// as the compiler for echo blocks. Code-only helpers do not emit outside text.
export function lexTemplate(source, { language, tags, fail, codeOnly = false }) {
  const tokens = []
  const context = []
  let depth = 0
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  const add = (type, start, end) => {
    const token = { type, value: source.slice(start, end) }
    Object.defineProperty(token, 'start', { value: start })
    tokens.push(token)
    if (type === 'text' && !codeOnly) {
      if (depth === 0) context.length = 0
      else context.push('echo("");\n')
    }
  }
  let cursor = 0
  while (cursor < source.length) {
    let open = source.indexOf('<?', cursor)
    let opener
    while (open !== -1) {
      opener = ['<?=', '<?js', '<?ts'].find(tag => source.startsWith(tag, open))
      if (opener) break
      open = source.indexOf('<?', open + 2)
    }
    if (open === -1) {
      add('text', cursor, source.length)
      break
    }
    if (open > cursor) add('text', cursor, open)
    if (opener !== '<?=' && !tags.includes(opener)) {
      fail(`${opener} cannot be used in a ${language.toUpperCase()} template`, open)
    }

    const echo = opener === '<?='
    const start = open + opener.length
    if (echo) { context.push('echo(String(('); depth += 3 }
    let contextStart = start
    let previous = echo ? kind.OpenParenToken : undefined
    let previousEnd = start
    scanner.setTextPos(start)
    let candidate = source.indexOf('?>', start)
    let close = source.length
    // Each entry counts braces inside one ${...}. Template interpolation can
    // contain nested templates, comments and regexes, all inert to Cow tags.
    const templates = []
    for (let token = scanner.scan(); token !== kind.EndOfFileToken; token = scanner.scan()) {
      const at = scanner.getTokenPos()
      if (token === kind.SlashToken || token === kind.SlashEqualsToken) {
        const goal = expressionStart.has(previous) ? true
          : expressionEnd.has(previous) && !/[\r\n\u2028\u2029]/.test(source.slice(previousEnd, at)) ? false
          : startsRegex(context.join('') + source.slice(contextStart, at), language)
        if (goal) token = scanner.reScanSlashToken()
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
      if (candidate !== -1 && candidate < end) {
        // A `//` comment ends at ?> like PHP's lexer; /* */ still hides it.
        if ((!opaque.has(token) || token === kind.SingleLineCommentTrivia) && templates.length === 0) {
          close = candidate
          break
        }
        // Skip all tag-looking text inside this lexical value in one search.
        candidate = source.indexOf('?>', end)
      }
      if ([kind.OpenBraceToken, kind.OpenParenToken, kind.OpenBracketToken, kind.TemplateHead].includes(token)) depth++
      else if ([kind.CloseBraceToken, kind.CloseParenToken, kind.CloseBracketToken, kind.TemplateTail].includes(token)) depth--
      if (!trivia.has(token)) { previous = token; previousEnd = end }
      // A top-level statement terminator is a safe lexical checkpoint. Keep
      // unfinished functions/blocks intact, but don't repeatedly parse earlier
      // unrelated statements when a later slash needs contextual classification.
      if (token === kind.SemicolonToken && depth === 0) {
        context.length = 0
        contextStart = end
      }
    }
    if (close === source.length && echo) fail('Echo block is missing its closing ?> tag', open)
    add(echo ? 'echo' : 'code', start, close)
    if (echo) depth -= 3
    if (echo && depth === 0) context.length = 0
    else if (echo) context.push(source.slice(contextStart, close).replace(/[;\s]+$/, ''), '\n) ?? ""));\n')
    else context.push(source.slice(contextStart, close), '\n')
    cursor = close === source.length ? close : close + 2
  }
  return tokens
}
