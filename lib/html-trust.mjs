import { AsyncLocalStorage } from 'node:async_hooks'

// A native module, so there is one store per worker: pages, helpers and
// bundled modules all mark trusted HTML here. <?= ?> prints a string as-is
// only when h() or raw() returned that exact string in the current request.
const trusted = new AsyncLocalStorage()

export function trustHtml(html) {
  trusted.getStore()?.add(html)
  return html
}

export function isTrustedHtml(text) {
  return trusted.getStore()?.has(text) === true
}

export function runWithTrustedHtml(callback) {
  return trusted.run(new Set(), callback)
}
