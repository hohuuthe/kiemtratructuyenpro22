import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { chooseWordOptionColumnCount, generateExamDocx } from '../src/exam-docx-generator.ts';
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
