import { cpus, totalmem } from 'node:os'
import { compileSource, tokenize } from '../lib/compiler.mjs'

const compile = (fragment, blocks) => {
  const source = fragment.repeat(blocks)
  const lexStarted = performance.now()
  tokenize(source, 'js', 'benchmark.jsp')
  const lexerMs = Number((performance.now() - lexStarted).toFixed(2))
  const started = performance.now()
  const code = compileSource(source, { filePath: 'benchmark.jsp', language: 'js' })
  return { blocks, sourceBytes: Buffer.byteLength(source), outputBytes: Buffer.byteLength(code),
    lexerMs, milliseconds: Number((performance.now() - started).toFixed(2)) }
}

const cases = []
for (const [name, fragment] of [
  ['plain', '<?js echo(1); ?>text'],
  ['division', '<?js echo(12 / 3); ?>text'],
  ['regex', '<?js echo(/[?>]/.source); ?>text'],
  ['contextual', '<?= {valueOf(){return 10}} / 2 ?>']
]) {
  compile(fragment, 32)
  const samples = []
  for (const blocks of [32, 128, 512, 2048]) {
    const runs = Array.from({ length: 3 }, () => compile(fragment, blocks))
    const times = runs.map(run => run.milliseconds).sort((a, b) => a - b)
    const lexerTimes = runs.map(run => run.lexerMs).sort((a, b) => a - b)
    samples.push({ ...runs[0], milliseconds: undefined, lexerMs: undefined,
      medianMs: times[1], runsMs: times, lexerMedianMs: lexerTimes[1], lexerRunsMs: lexerTimes })
  }
  cases.push({ name, fragment, samples })
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, logicalCPUs: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3),
  note: 'Warm tokenize and compileSource microbenchmarks only; not HTTP throughput, production sizing or peak memory evidence.',
  cases
}, null, 2))
