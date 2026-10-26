import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listDocumentLinks,createDocumentLink,updateDocumentLink,deleteDocumentLink,DocumentLinkServiceError} from '../src/document-links-service.js';
const actor={id:'teacher-A',role:'teacher'};
const base={id:'doc-1',tieu_de:'Tài liệu ôn tập',duong_link:'https://example.org/file',doi_tuong_duoc_truy_cap:'student',hoat_dong:1,mo_ta:'Bài 1',danh_muc:'Tin học'};
const calls=[];
const db={
 async all(sql,args){calls.push({sql,args});return [{...base}]},
 async first(sql,args){calls.push({sql,args});return {id:args[0],id_nguoi_tao:'teacher-A'};},
 async run(sql,args){calls.push({sql,args});return 1;}
};
test('public visibility is enforced in SQL before data is returned',async()=>{
 calls.length=0;
 await listDocumentLinks(db,null);
 assert.deepEqual(calls[0].args,['public']);
 assert.match(calls[0].sql,/hoat_dong = 1/);
 assert.match(calls[0].sql,/CURRENT_TIMESTAMP/);
});
test('teacher management is restricted to own account',async()=>{
 calls.length=0;
 await listDocumentLinks(db,actor,{manage:true});
 assert.match(calls[0].sql,/id_nguoi_tao = \?/);
 assert.deepEqual(calls[0].args,['teacher-A']);
 await assert.rejects(()=>listDocumentLinks(db,{id:'s',role:'user',target_audience:'Học sinh'},{manage:true}),{status:403});
});
test('creator field from request is never trusted',async()=>{
 calls.length=0;
 await createDocumentLink(db,actor,{...base,id_nguoi_tao:'attacker'},()=> 'new-id');
 const row=calls.find(c=>c.sql.startsWith('INSERT'));
 assert.equal(row.args[0],'new-id');
 assert.equal(row.args[1],'teacher-A');
});
test('update and deletion use owner-qualified SQL',async()=>{
 calls.length=0;
 await updateDocumentLink(db,actor,base);
 await deleteDocumentLink(db,actor,base.id);
 for(const call of calls.filter(c=>/^(UPDATE|DELETE)/.test(c.sql))){
   assert.match(call.sql,/AND id_nguoi_tao = \?/);
   assert.equal(call.args.at(-1),'teacher-A');
 }
});
test('tab loads asynchronously and exposes same API on Express and Cloudflare Pages',()=>{
 const main=readFileSync('src/main.js','utf8');
 const server=readFileSync('server.ts','utf8');
 const cf=readFileSync('functions/api/documents.ts','utf8');
 const ui=readFileSync('src/document-links-ui.js','utf8');
 const index=readFileSync('index.html','utf8');
 assert.match(main,/window\.__documentsTabRequested/);
 assert.match(main,/connectDocumentLinks\(\)/);
 assert.match(main,/'tab-documents'/);
 assert.match(index,/data-sidebar-tab="documents"/);
 assert.match(server,/app\.get\('\/api\/documents'/);
 assert.match(server,/app\.post\('\/api\/documents'/);
 assert.match(server,/app\.put\('\/api\/documents'/);
 assert.match(server,/app\.delete\('\/api\/documents'/);
 assert.match(cf,/listDocumentLinks/);
 assert.match(ui,/safeLink/);
});

test('student and teacher audience query uses SQL array overlap',async()=>{
 calls.length=0;
 await listDocumentLinks(db,{id:'s',role:'student'});
 assert.match(calls[0].sql,/doi_tuong_truy_cap_nhieu && ARRAY/);
 assert.deepEqual(calls[0].args,['public','authenticated','student']);
 calls.length=0;
 await createDocumentLink(db,actor,{...base,doi_tuong_truy_cap_nhieu:['student','teacher']},()=> 'multi-id');
 const insert=calls.find(c=>c.sql.startsWith('INSERT'));
 assert.match(insert.sql,/doi_tuong_truy_cap_nhieu/);
 assert.equal(insert.args.at(-1),'{student,teacher}');
});

test('admin gets full management and teacher is limited to own document',async()=>{
 const otherDb={...db,
  async all(sql,args){return [
   {...base,id:'mine',id_nguoi_tao:'teacher-A'},
   {...base,id:'other',id_nguoi_tao:'teacher-B'}
  ];},
  async first(sql,args){return {id:args[0],id_nguoi_tao:'teacher-B'};}
 };
 const admin={id:'administrator',role:'admin'};
 const adminRows=await listDocumentLinks(otherDb,admin,{manage:true});
 assert.deepEqual(adminRows.map(r=>r.co_quyen_quan_ly),[true,true]);
 const teacherRows=await listDocumentLinks(otherDb,actor,{manage:true});
 assert.deepEqual(teacherRows.map(r=>r.co_quyen_quan_ly),[true,false]);
 await assert.rejects(()=>updateDocumentLink(otherDb,actor,base),{status:403});
 await assert.rejects(()=>deleteDocumentLink(otherDb,actor,base.id),{status:403});
 await updateDocumentLink(otherDb,admin,base);
 await deleteDocumentLink(otherDb,admin,base.id);
});
