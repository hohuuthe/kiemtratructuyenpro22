import test from 'node:test';
import assert from 'node:assert/strict';
import { Document, Paragraph, Packer } from 'docx';
import JSZip from 'jszip';
import { renderScientificContent } from '../src/scientific-formula-engine.ts';
import { renderExamReviewMath, renderExamDetailOptions } from '../src/exam-detail-formula-renderer.js';
import { cleanHTMLText } from '../src/exam-pdf-generator.ts';
import { parseFormattedText } from '../src/exam-docx-generator.ts';

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
