import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { splitScientificContent } from '../src/scientific-formula-tokenizer.js';
import { joinFormattedFractionArguments, findIncompleteWordFractions, generateQuestionBankDocx } from '../src/question-bank-docx-generator.ts';

const broken = '\\frac{f(x+h)-f(x)}';
const full = '\\frac{f(x+h)-f(x)}{h}';
test('No truncated numerator is emitted as a math token', () => {
 const tokens=splitScientificContent('Tính '+broken+' rồi trả lời');
 assert.ok(!tokens.some(x=>x.type==='math'&&x.value===broken));
 assert.ok(tokens.map(x=>x.value).join('').includes(broken));
 assert.deepEqual(findIncompleteWordFractions(broken),[broken]);
 assert.deepEqual(findIncompleteWordFractions(full),[]);
});
test('Restore only presentation tags between numerator and denominator',()=>{
 assert.equal(joinFormattedFractionArguments('\\frac{f(x+h)-f(x)}</span><span>{h}'),full);
 assert.equal(joinFormattedFractionArguments(broken),broken);
});
async function run(content) {
 const q={id:'Q1',type:'TL',lesson:'Bài 1',content,answer:'1'};
 const plan={questions:[q],ids:['Q1'],totalSelected:1,requestedCount:1,selectedLessons:1};
 const warnings=[];const blob=await generateQuestionBankDocx(plan,{onFormulaWarning:x=>warnings.push(x)});
 const zip=await JSZip.loadAsync(await blob.arrayBuffer());
 return {xml:await zip.file('word/document.xml').async('string'),warnings};
}
test('Malformed source still yields a complete DOCX and explicit warning',async()=>{
 const {xml,warnings}=await run('Đạo hàm: '+broken);
 assert.match(xml,/Câu 1:/);
 assert.ok(xml.includes(broken));
 assert.equal(warnings.length,1);
 assert.match(warnings[0].location,/Q1/);
});
test('Valid fraction remains real editable Word math',async()=>{
 const {xml,warnings}=await run('Đạo hàm: $'+full+'$');
 assert.match(xml,/<m:f>/);
 assert.deepEqual(warnings,[]);
});
test('HTML-split fraction gets converted without inventing operands',async()=>{
 const {xml,warnings}=await run('Đạo hàm: $\\frac{f(x+h)-f(x)}</span><span>{h}$');
 assert.match(xml,/<m:f>/);
 assert.deepEqual(warnings,[]);
});
