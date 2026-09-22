import { extname } from 'node:path'

// Order is shared by routing and private error-page selection. Legacy formats
// keep their original tag/language rules; Cow pages use one typed code scope.
const formats = new Map([
  ['.cow', Object.freeze({ language: 'ts', tags: Object.freeze(['<?js', '<?ts']) })],
  ['.jsp', Object.freeze({ language: 'js', tags: Object.freeze(['<?js']) })],
  ['.tsp', Object.freeze({ language: 'ts', tags: Object.freeze(['<?ts']) })]
])
export const templateExtensions = Object.freeze([...formats.keys()])
export const templateFormat = file => formats.get(extname(file).toLowerCase())
