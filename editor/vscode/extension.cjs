const vscode = require('vscode')

// Textual page-binding suggestions, not a pretend TypeScript language server.
const api = {
  req: {
    id: 'id(): string', url: 'url(): string', method: 'method(): string',
    address: 'address(): string | null', scheme: "scheme(): 'http' | 'https' | null", host: 'host(): string | null',
    headers: 'headers(): readonly headers', header: 'header(name): header value',
    params: 'params(): readonly first query values', get: 'get(name): string | undefined', getAll: 'getAll(name): string[]',
    body: 'body(): bytes', text: 'text(): string', json: 'json(): unknown', formData: 'formData(options?): Promise<FormValues>'
  },
  res: {
    status: 'status(code): response', setHeader: 'setHeader(name, value): response', header: 'header(name, value): response',
    getHeader: 'getHeader(name): string | string[] | undefined', removeHeader: 'removeHeader(name): response',
    type: 'type(contentType): response', write: 'write(value): response', commit: 'commit(): response',
    flush: 'flush(): Promise<void> — commits metadata; not streaming', end: 'end(value?): never',
    stream: 'stream(iterable): Promise<never> — await terminal streaming output',
    sendFile: 'sendFile(absolutePath): Promise<never>', download: 'download(absolutePath, filename?): Promise<never>',
    send: 'send(value): never', json: 'json(value): never; json(): response', redirect: 'redirect(location, status?): never',
    statusCode: 'readonly number', phase: 'readonly buffering | committed | finished', headersSent: 'readonly boolean', finished: 'readonly boolean'
  },
  cow: {
    info: 'info({format?: "html" | "json"}?): never — private runtime diagnostic page',
    requestId: 'readonly string', signal: 'readonly AbortSignal', onCleanup: 'onCleanup(callback): void',
    defer: 'defer(callback): void', track: 'track(promise): Promise — explicit completion barrier'
  }
}

exports.activate = context => {
  const selectors = [{ language: 'cow' }, { language: 'cow-jsp' }, { language: 'cow-tsp' }]
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selectors, {
    provideCompletionItems(document, position) {
      const prefix = document.lineAt(position.line).text.slice(0, position.character)
      const match = /\b(req|res|cow)\.([A-Za-z]*)$/.exec(prefix)
      if (!match) return []
      return Object.entries(api[match[1]]).filter(([name]) => name.startsWith(match[2])).map(([name, detail]) => {
        const item = new vscode.CompletionItem(name, detail.startsWith('readonly') ? vscode.CompletionItemKind.Property : vscode.CompletionItemKind.Method)
        item.detail = `Cow: ${detail}`
        item.insertText = name
        return item
      })
    }
  }, '.'))
}
exports.deactivate = () => {}
