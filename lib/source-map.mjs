import { SourceMap } from 'node:module'

export function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r') {
      if (text[i + 1] === '\n') i++
      starts.push(i + 1)
    } else if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

export function position(starts, offset) {
  let low = 0, high = starts.length
  while (low + 1 < high) {
    const mid = (low + high) >>> 1
    if (starts[mid] <= offset) low = mid
    else high = mid
  }
  return { line: low + 1, column: offset - starts[low] + 1 }
}

export function originalOffset(spans, offset) {
  let low = 0, high = spans.length
  while (low + 1 < high) {
    const mid = (low + high) >>> 1
    if (spans[mid].start <= offset) low = mid
    else high = mid
  }
  const span = spans[low]
  return span ? span.origin + (span.linear ? Math.max(0, Math.min(offset, span.end) - span.start) : 0) : 0
}

// Compact ranges instead of a per-character map; survives worker serialization.
export class MappedText {
  text = ''
  spans = []
  append(text, origin = 0, linear = false) {
    if (!text) return
    this.spans.push({ start: this.text.length, end: this.text.length + text.length, origin, linear })
    this.text += text
  }
  copy(source, start, end) {
    // Statements arrive in source order, but copied spans can be disjoint.
    // Find the first overlap instead of rescanning every span per statement.
    let low = 0, high = source.spans.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (source.spans[middle].end <= start) low = middle + 1
      else high = middle
    }
    for (let index = low; index < source.spans.length && source.spans[index].start < end; index++) {
      const span = source.spans[index]
      const left = Math.max(start, span.start), right = Math.min(end, span.end)
      if (left < right) this.append(source.text.slice(left, right), span.origin + (span.linear ? left - span.start : 0), span.linear)
    }
  }
}

export function templateStack(stack, templates) {
  if (typeof stack !== 'string') return stack
  for (const template of templates.values()) {
    if (!template.sourceMap) continue
    const { payload, moduleLines, spans, sourceLines } = template.sourceMap
    const map = new SourceMap(payload)
    // Engines differ in whether stack-frame URLs retain percent encoding.
    // A legal URL query can contain malformed percent escapes. Decode valid
    // runs independently so those suffixes cannot break error reporting.
    const decoded = template.identifier.replace(/(?:%[0-9a-f]{2})+/gi, encoded => {
      try { return decodeURI(encoded) } catch { return encoded }
    })
    const identifiers = [...new Set([template.identifier, decoded])]
    const escaped = identifiers.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    stack = stack.replace(new RegExp(`(?:${escaped}):(\\d+):(\\d+)`, 'g'), (frame, line, column) => {
      const entry = map.findEntry(Number(line) - 1, Number(column) - 1)
      if (entry.originalLine !== undefined && !moduleLines) {
        return `${template.filePath}:${entry.originalLine + 1}:${entry.originalColumn + 1}`
      }
      if (entry.originalLine === undefined || moduleLines?.[entry.originalLine] === undefined) return frame
      const offset = moduleLines[entry.originalLine] + entry.originalColumn
      const at = position(sourceLines, originalOffset(spans, offset))
      return `${template.filePath}:${at.line}:${at.column}`
    })
  }
  return stack
}
