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
