import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { chooseWordOptionColumnCount, generateExamDocx } from '../src/exam-docx-generator.ts';
import { estimateWordOptionMeasure } from '../src/word-option-layout.ts';
const header={soGiaoDuc:'SO',truongHoc:'TRUONG',deThiTitle:'TEST',namHoc:'2026',monHoc:'TOAN',maDe:'1101'};
test('Smart answer layout chooses 4, 2 and 1 columns',()=>{
 assert.equal(chooseWordOptionColumnCount(['1','2','3','4']),4);
 assert.equal(chooseWordOptionColumnCount(['Đáp án đúng ở chương trình','Lựa chọn có nội dung trung bình','Giá trị 125','Giá trị 150']),2);
 assert.equal(chooseWordOptionColumnCount(['Một đoạn mô tả dài '.repeat(12),'Hai','Ba','Bốn']),1);
 assert.equal(chooseWordOptionColumnCount(['Dòng thứ nhất\nDòng thứ hai','B','C','D']),1);
});
test('DOCX has fixed-grid borderless option tables with every layout',async()=>{
 const questions=[
  {type:'4-1',content:'Câu ngắn?',options:{A:'1',B:'2',C:'3',D:'4'},answer:'A'},
  {type:'4-1',content:'Câu vừa?',options:{A:'Đáp án ở chương trình chính',B:'Nội dung có thêm mô tả',C:'Lựa chọn cỡ vừa',D:'Đáp án khác'},answer:'B'},
  {type:'4-1',content:'Câu dài?',options:{A:'Một đoạn mô tả rất dài '.repeat(15),B:'B',C:'C',D:'D'},answer:'A'}
 ];
 const zip=await JSZip.loadAsync(await generateExamDocx(header,questions));
 const xml=await zip.file('word/document.xml').async('string');
 assert.match(xml,/<w:tblLayout[^>]*w:type="fixed"/);
 for(const content of ['Câu ngắn?','Câu vừa?','Câu dài?','Nội dung có thêm mô tả'])assert.ok(xml.includes(content),content);
 const grids=[...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/gs)].map(m=>(m[1].match(/<w:gridCol\b/g)||[]).length);
 for(const count of [1,2,4])assert.ok(grids.includes(count),JSON.stringify(grids));
});

const system = String.raw`\begin{cases}800x+600y\ge900\\200x+400y\ge400\\x\ge0,\ y\ge0\end{cases}`;
const aligned = String.raw`\begin{aligned}a+b&=c\\d+e&=f\end{aligned}`;
const matrix = String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`;
test('Multiline systems, aligned expressions and compact matrices use a 2 by 2 Word layout', () => {
 for (const formula of [system,aligned,matrix]) {
  assert.ok(estimateWordOptionMeasure(formula).lineCount>=2,formula);
  assert.equal(chooseWordOptionColumnCount([formula,formula,formula,formula]),2,formula);
 }
});
test('Wide equations, user paragraph breaks and images keep one column',()=>{
 const wide=String.raw`\begin{matrix}1234567890123456789012345678901234567890&b\\a&b\end{matrix}`;
 assert.equal(chooseWordOptionColumnCount([wide,wide,wide,wide]),1);
 assert.equal(chooseWordOptionColumnCount(['A<br>B','x','y','z']),1);
 assert.equal(chooseWordOptionColumnCount(['<img src="a.png">','x','y','z']),1);
});
test('Short editable fractions choose four columns',()=>{
 const terms=[String.raw`$\frac{1}{2}$`,String.raw`$\frac{3}{4}$`,String.raw`$\frac{x}{y}$`,String.raw`$\sqrt{x}$`];
 assert.equal(chooseWordOptionColumnCount(terms),4);
});
test('Generated DOCX uses two columns, two rows and editable Office Math for inequalities',async()=>{
 const question={type:'4-1',content:'Chon he dung',options:{A:system,B:system,C:system,D:system},answer:'A'};
 const archive=await JSZip.loadAsync(await generateExamDocx(header,[question]));
 const xml=await archive.file('word/document.xml').async('string');
 const tables=[...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map(m=>m[1]);
 const optionTable=tables.find(t=>t.includes('800')&&t.includes('900'));
 assert.ok(optionTable,'Inequality table missing');
 assert.equal((optionTable.match(/<w:gridCol\b/g)||[]).length,2);
 assert.equal((optionTable.match(/<w:tr>/g)||[]).length,2);
 assert.equal((optionTable.match(/<w:tc>/g)||[]).length,4);
 assert.match(optionTable,/<m:oMath\b/);
 assert.match(optionTable,/<w:tblLayout[^>]*w:type="fixed"/);
});
