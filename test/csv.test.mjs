import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CsvError, parseCsv, stringifyCsv } from '../lib/csv.mjs'

test('CSV parses quoted delimiters, doubled quotes and embedded line breaks without type coercion', () => {
  assert.deepEqual(parseCsv('name,note,id\r\n"Cow, site","a ""quote""\r\nand line",001\r\n'),
    [['name','note','id'],['Cow, site','a "quote"\r\nand line','001']])
  assert.deepEqual(parseCsv('\uFEFFa,b\nc,d\re,f'),[['a','b'],['c','d'],['e','f']])
  assert.deepEqual(parseCsv('a\tb\n"x\ty"\tz',{delimiter:'\t'}),[['a','b'],['x\ty','z']])
  assert.deepEqual(parseCsv(' a , b '),[[' a ',' b ']])
})

test('CSV distinguishes empty input, empty records and trailing fields', () => {
  for (const [text,expected] of [['',[]],['\uFEFF',[]],['\n',[['']]],['\n\n',[[''],['']]],
    ['""',[['']]],['a,',[['a','']]],['a,\r\n',[['a','']]], [',',[['','']]],['"",',[['','']]]]) {
    assert.deepEqual(parseCsv(text),expected,JSON.stringify(text))
  }
})

test('CSV rejects malformed quoting with original line and column', () => {
  for (const [text,line,column] of [['a"b',1,2],['"a"x',1,4],['"a" ',1,4],['a\r\n"b',2,3],['"x\n"z',2,2]]) {
    assert.throws(()=>parseCsv(text),error=>error instanceof CsvError && error.code==='COW_CSV_SYNTAX' && error.line===line && error.column===column)
  }
})

test('CSV output quotes safely and round-trips Unicode, delimiters, newlines and empty strings', () => {
  const rows = [['\uFEFFname','value'],['café','👩‍💻'],['a,b','a"b'],['line\r\nbreak',''],['001','=SUM(A1:A2)']]
  assert.deepEqual(parseCsv(stringifyCsv(rows)),rows)
  assert.equal(stringifyCsv([['']]),'""\r\n')
  assert.equal(stringifyCsv([[1,true,null,12n]]),'1,true,"",12\r\n')
  assert.equal(stringifyCsv([]),'')
  assert.deepEqual(parseCsv(stringifyCsv(rows,{delimiter:';'}),{delimiter:';'}),rows)
})

test('CSV bounds and input types fail explicitly for parsing and serialization', () => {
  for (const [text,settings] of [['abcd',{maxLength:3}],['abcd',{maxFieldLength:3}],['a,b',{maxColumns:1}],['a\nb',{maxRows:1}]]) {
    assert.throws(()=>parseCsv(text,settings),{code:'COW_CSV_LIMIT'})
  }
  for (const [rows,settings] of [[[['abc']],{maxLength:4}],[[['abcd']],{maxFieldLength:3}],[[['a','b']],{maxColumns:1}],[[['a'],['b']],{maxRows:1}]]) {
    assert.throws(()=>stringifyCsv(rows,settings),{code:'COW_CSV_LIMIT'})
  }
  for (const settings of [null,[],{delimiter:''},{delimiter:'xx'},{delimiter:'"'},{delimiter:'\n'},{typo:1},{maxRows:0},{maxLength:1.5}]) {
    assert.throws(()=>parseCsv('',settings),TypeError)
    assert.throws(()=>stringifyCsv([],settings),TypeError)
  }
  assert.throws(()=>parseCsv(Buffer.from('a')),TypeError)
  for (const rows of [null,{},[[]],['a'],[[undefined]],[[{}]],[[()=>{}]]]) assert.throws(()=>stringifyCsv(rows),TypeError)
})

test('CSV seeded round trips preserve literal cell content', () => {
  let seed=173
  const characters=['a','b',',','"','\r','\n',' ','é','日']
  const next=()=>{seed=(seed*1664525+1013904223)>>>0;return seed}
  for(let attempt=0;attempt<150;attempt++) {
    const rows=Array.from({length:1+next()%5},()=>Array.from({length:1+next()%5},()=>
      Array.from({length:next()%20},()=>characters[next()%characters.length]).join('')))
    assert.deepEqual(parseCsv(stringifyCsv(rows)),rows)
  }
})
