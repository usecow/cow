import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import { compileCowModule, compileSource } from '../lib/compiler.mjs'

const root=fileURLToPath(new URL('../editor/vscode/',import.meta.url))
const json=async file=>JSON.parse(await readFile(join(root,file),'utf8'))

test('editor contributions support Cow and legacy JSP/TSP with matching grammars and a Windows-aware diagnostic matcher',async()=>{
  const manifest=await json('package.json')
  assert.deepEqual(manifest.contributes.languages.map(value=>value.extensions[0]),['.cow','.jsp','.tsp'])
  for(const grammar of manifest.contributes.grammars) {
    const source=await json(grammar.path),block=source.patterns[0]
    assert.equal(source.scopeName,grammar.scopeName)
    const typed=grammar.language!=='cow-jsp'
    if(grammar.language==='cow') assert.ok(new RegExp(block.begin).test('<?js'))
    assert.ok(new RegExp(block.begin).test(typed?'<?ts':'<?js'))
    assert.ok(new RegExp(block.begin).test('<?='))
    assert.equal(grammar.embeddedLanguages[block.contentName],typed?'typescript':'javascript')
    assert.ok(new RegExp(block.end).test('?>'))
  }
  const pattern=new RegExp(manifest.contributes.problemMatchers[0].pattern.regexp)
  assert.deepEqual(pattern.exec('F:\\A Site\\index.jsp:12:3: Unexpected token').slice(1),['F:\\A Site\\index.jsp','12','3','Unexpected token'])
})

test('editor snippets remain valid Cow syntax after placeholder substitution',async()=>{
  const manifest=await json('package.json')
  for(const contribution of manifest.contributes.snippets) {
    const language=contribution.language==='cow-jsp'?'js':'ts'
    for(const snippet of Object.values(await json(contribution.path))) {
      let source=(Array.isArray(snippet.body)?snippet.body.join('\n'):snippet.body)
        .replace(/\$\{\d+:([^}]*)\}/g,'$1').replace(/\$\{\d+\}/g,'current').replace(/\$\d+/g,'')
      if(!source.startsWith('<?')) source=`<?${language} ${source} ?>`
      const filePath=contribution.language==='cow'?'test.cow':language==='ts'?'test.tsp':'test.jsp'
      try { assert.equal(typeof compileSource(source,{language,filePath}),'string') }
      catch(error) {
        if(contribution.language!=='cow'||error.code!=='COW_TEMPLATE_EXPORT') throw error
        assert.equal(typeof compileCowModule(source,filePath).code,'string')
      }
    }
  }
})

test('editor provider returns bounded static API suggestions without evaluating a page or loading a toolchain',async()=>{
  let provider,selectors
  const stub={ CompletionItem:class {constructor(label,kind){this.label=label;this.kind=kind}},
    CompletionItemKind:{Property:1,Method:2},languages:{registerCompletionItemProvider(selection,value){selectors=selection;provider=value;return {dispose(){}}}} }
  const module={exports:{}}
  vm.runInNewContext(await readFile(join(root,'extension.cjs'),'utf8'),{
    module,exports:module.exports,require(name){assert.equal(name,'vscode');return stub}
  })
  const context={subscriptions:[]};module.exports.activate(context)
  assert.equal(context.subscriptions.length,1)
  assert.deepEqual(Array.from(selectors,value=>value.language),['cow','cow-jsp','cow-tsp'])
  const complete=text=>provider.provideCompletionItems({lineAt:()=>({text})},{line:0,character:text.length})
  assert.deepEqual(Array.from(complete('  req.fo'),value=>value.label),['formData'])
  assert.ok(complete('cow.').some(value=>value.label==='track'))
  assert.ok(complete('cow.').some(value=>value.label==='info'))
  assert.ok(complete('res.').some(value=>value.label==='headersSent'&&value.kind===1))
  assert.ok(complete('res.').some(value=>value.label==='download'))
  assert.equal(complete('<p>hello</p>').length,0)
})
