import test from 'node:test';
import assert from 'node:assert/strict';
import { Document, Paragraph, Packer } from 'docx';
import JSZip from 'jszip';
import { renderScientificContent } from '../src/scientific-formula-engine.ts';
import { renderExamReviewMath, renderExamDetailOptions } from '../src/exam-detail-formula-renderer.js';
import { cleanHTMLText } from '../src/exam-pdf-generator.ts';
import { parseFormattedText } from '../src/exam-docx-generator.ts';
import { formatAnswerDisplay } from '../src/exam-excel-generator.ts';

const samples=[
 'Thẻ <p> trong HTML dùng để tạo phần tử nào?',
 'Thẻ <div> dùng để nhóm nội dung nào?',
 'Thẻ <b> và <i> có tác dụng gì?',
 'Thẻ <span> và <table> khác nhau thế nào?',
 'Phân biệt <script>, <img>, <a href="https://example.com">.',
 'Cú pháp <p>Văn bản</p> là gì?',
 'Dòng lệnh `<p>` trong HTML.',
 'Đáp án A. <p> là thẻ đoạn văn.'
];
const breakExamples=[
 '<br>', '<br/>', '<br />', '<BR/>',
 'A. <br/>', 'A. <br/>.', 'Đáp án A: <br/>',
 '<br/> là thẻ đơn.', '<br/ >.',
 'Câu nào dùng <br/>?', 'Thẻ <br/> dùng để làm gì trong HTML?',
 'Trong HTML, thẻ <br> có tác dụng gì?',
 'Cú pháp <br /> là thẻ xuống dòng.',
 'Mã nguồn \`<br/>\` trong HTML.',
 'Dòng một<br/>Dòng hai',
 'B. <hr/> và C. <br/>.',
 '&lt;br/&gt;', '&lt;br&gt;', '&lt;br /&gt;',
];
for(const sample of breakExamples){
 test('questions, answers, review and PDF preserve literal HTML breaks: '+sample,()=>{
   for(const render of [renderScientificContent, renderExamReviewMath, cleanHTMLText]){
     const html=render(sample);
     // Source tag spelling is preserved in escaped output, never executed.
     if (/<br\s*\/?\s*>/i.test(sample) || /&lt;br\s*\/?\s*&gt;/i.test(sample)) {
       assert.match(html,/&lt;br\s*\/?\s*&gt;/i,'literal HTML break swallowed: '+html);
     }
     assert.ok(!/<br\s*\/?\s*>/i.test(html),'raw HTML break was executed: '+html);
   }
 });
}
test('real newline creates a line break without interpreting source HTML tags',()=>{
 const html=renderScientificContent('Dòng một\\nDòng hai và mã <br/>');
 assert.match(html,/Dòng một<br\\s*\\/?>Dòng hai/);
 assert.match(html,/&lt;br\\/&gt;/);
});
test('actual HTML answer choices rendered in review retain source tags',()=>{
 const options={type:'4-1', options:{
   A:{text:'<br/ >.'}, B:{text:'<hr/>.'}, C:{text:'<qr/>.'}, D:{text:'<dr/>.'}
 }};
 const html=renderExamDetailOptions(options,'A','B');
 for(const tag of ['br/ ','hr/','qr/','dr/']) assert.ok(html.includes('&lt;'+tag+'&gt;'),html);
 assert.ok(!/<(?:br|hr|qr|dr)\b[^>]*>/i.test(html),html);
});
test('Word export preserves literal HTML break examples and actual newlines',async()=>{
 for(const sample of breakExamples){
   const xml=await docxXml(sample);
   if(/<br\s*\/?\s*>|&lt;br\s*\/?\s*&gt;/i.test(sample))
     assert.match(xml,/&lt;br\s*\/?\s*&gt;/i,xml);
 }
});
const encode=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
for(const sample of samples){
 test('student/bank/review/PDF render literal HTML: '+sample.slice(0,45),()=>{
   for(const render of [renderScientificContent, renderExamReviewMath, cleanHTMLText]){
     const html=render(sample);
     const tags=[...sample.matchAll(/<[^>]+>/g)].map(x=>x[0]);
     for(const tag of tags) assert.ok(html.includes(encode(tag).replaceAll('"','&quot;')),'missing '+tag+' in '+html);
     assert.ok(!/<(?:p|div|b|i|span|table|script|a)(?:\s|>)/i.test(html),'unsafe live markup: '+html);
   }
 });
}
test('formula and Markdown remain properly rendered without restoring source HTML',()=>{
 const html=renderScientificContent(String.raw`Giải thích <p>, công thức $\\frac{1}{2}$ và **đúng**`);
 assert.match(html,/&lt;p&gt;/);
 assert.match(html,/katex/);
 assert.match(html,/<strong/);
});
async function docxXml(input){
 const doc=new Document({sections:[{children:[new Paragraph({children:parseFormattedText(input)})]}]});
 const zip=await JSZip.loadAsync(await Packer.toBuffer(doc));
 return zip.file('word/document.xml').async('string');
}
test('Word exports educational HTML tags as literal text',async()=>{
 for(const sample of samples){
   const xml=await docxXml(sample);
   assert.ok(xml.includes('&lt;p&gt;')||!sample.includes('<p>'),sample);
   if(sample.includes('<div>'))assert.ok(xml.includes('&lt;div&gt;'));
   if(sample.includes('<span>'))assert.ok(xml.includes('&lt;span&gt;'));
   if(sample.includes('<b>'))assert.ok(xml.includes('&lt;b&gt;'));
 }
});
test('Word keeps legacy paired bold and subscript outside HTML-teaching questions',async()=>{
 const xml=await docxXml('Chữ <b>đậm</b> và H<sub>2</sub>O');
 assert.match(xml,/<w:b/);
 assert.match(xml,/<w:vertAlign w:val="subscript"/);
});

test('legacy paired inline formatting stays available outside HTML lessons',()=>{
  const formatted=renderScientificContent('H<sub>2</sub>O và <b>quan trọng</b>');
  assert.ok(formatted.includes('<sub>2</sub>'));
  assert.ok(formatted.includes('<b>quan trọng</b>'));
  const instructional=renderScientificContent('Trong HTML, cú pháp <b>quan trọng</b> có tác dụng gì?');
  assert.ok(instructional.includes('&lt;b&gt;quan trọng&lt;/b&gt;'));
  assert.ok(!instructional.includes('<b>'));
});

test('mixed HTML teaching text preserves chemical and math indices',()=>{
 const source='Trong HTML, thẻ <p> là gì? Chất H<sub>2</sub>O và x<sup>2</sup>.';
 const html=renderScientificContent(source);
 assert.ok(html.includes('&lt;p&gt;'),html);
 assert.ok(html.includes('H<sub>2</sub>O'),html);
 assert.ok(html.includes('x<sup>2</sup>'),html);
});
test('inline code span protects even matched formatting pairs',()=>{
 const html=renderScientificContent('Ví dụ \`<b>chữ đậm</b>\` và <p>');
 assert.ok(html.includes('&lt;b&gt;chữ đậm&lt;/b&gt;'),html);
 assert.ok(html.includes('&lt;p&gt;'),html);
});
test('encoded HTML teaching tags remain legible',()=>{
 const html=renderScientificContent('Thẻ &lt;p&gt; trong HTML?');
 assert.ok(html.includes('&lt;p&gt;'),html);
});
test('Word export mixed HTML and scientific subscripts preserves each', async()=>{
 const xml=await docxXml('Trong HTML, thẻ <p> là gì? Chất H<sub>2</sub>O');
 assert.ok(xml.includes('&lt;p&gt;'),xml);
 assert.match(xml,/<w:vertAlign w:val="subscript"/);
});

test('Excel answer output keeps HTML tags as literal text',()=>{
 for(const sample of ['<br/>','A. <br/>','<br/ >.']){
   assert.equal(formatAnswerDisplay('TL',sample),sample);
   assert.equal(formatAnswerDisplay('SQ',sample),sample);
 }
});
