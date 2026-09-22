import { parentPort } from 'node:worker_threads'
import { compileTemplate } from './compiler.mjs'

// Uses the same bounded queue, startup, cancellation, timeout and replacement
// protocol as execution workers, but never evaluates application code.
parentPort.on('message', task => {
  if (task?.type === 'shutdown') {
    parentPort.postMessage({ type: 'shutdown-complete' })
    return
  }
  try {
    const { source, filePath, language } = task.template
    parentPort.postMessage({ id: task.id, ok: true, result: compileTemplate(source, { filePath, language }) })
  } catch (error) {
    parentPort.postMessage({ id: task.id, ok: false, error: {
      name: error?.name, message: error?.message || String(error), stack: error?.stack,
      code: error?.code, status: error?.status,
      filePath: error?.filePath, line: error?.line, column: error?.column
    } })
  }
})

parentPort.postMessage({ type: 'ready' })
