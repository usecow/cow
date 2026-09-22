import { parentPort } from 'node:worker_threads'
import { basename } from 'node:path'

// Register before the real compiler's listener. Only the test-owned slow page
// stalls; all other jobs use the production compiler and worker protocol. A
// deterministic busy worker tests deadlines independently of compiler speed.
parentPort.on('message', task => {
  if (task?.template?.filePath && basename(task.template.filePath) === 'slow.jsp') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000)
  }
})
await import('../../lib/compiler-worker.mjs')
