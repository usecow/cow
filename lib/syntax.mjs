import ts from 'typescript'

export const parserVersion = '5.9.3'
if (ts.version !== parserVersion) {
  throw Object.assign(new Error(`Cow requires TypeScript parser ${parserVersion}; found ${ts.version}. Reinstall Cow's dependencies without overriding its parser version.`), { code: 'COW_PARSER_VERSION' })
}
export default ts
