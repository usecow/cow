export type HighlightTokenType =
  | 'tag'
  | 'keyword'
  | 'string'
  | 'number'
  | 'regex'
  | 'comment'
  | 'call'
  | 'html-tag'
  | 'html-attr'
  | 'html-string'
  | 'html-comment'
  | 'text'

export interface HighlightToken {
  type: HighlightTokenType
  value: string
}

export interface HighlightOptions {
  /** Template code language; derived from `filename` when omitted. */
  language?: 'js' | 'ts'
  /** Treat the whole source as one code region instead of a Cow template. */
  code?: boolean
}

export interface HighlightHtmlOptions extends HighlightOptions {
  /** Template file name used to derive `language` (.cow, .jsp, .tsp). */
  filename?: string
  /** Prefix for emitted span classes; the default is `cow-`. */
  classPrefix?: string
}

/**
 * Lexes Cow template or code source into a flat token stream for
 * highlighting. Concatenating the token values reproduces the source (after
 * any leading UTF-8 BOM is dropped). Never throws on malformed input.
 */
export function highlightTokens(source: string, options?: HighlightOptions): HighlightToken[]

/**
 * Renders source as HTML-escaped text with `<span class="cow-...">` wrappers
 * around classified tokens, ready for a `<pre><code>` block.
 */
export function highlight(source: string, options?: HighlightHtmlOptions): string
