import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  boardWindowOpen, canDiscoverBoard, canManageBoard, unitAndClassMatch,
  boardListProjection, normalizeClassList
} from '../functions/api/board/common.ts';

const student={id:'s1',user_id:'u-s1',role:'user',target_audience:'Học sinh',donvi:'THPT A',lop:'12A1'};
const teacher={id:'t1',user_id:'u-t1',role:'teacher',target_audience:'Giáo viên',donvi:'THPT A'};

test('board discovery enforces login, status, time, unit and class',()=>{
  const base={id:'b1',creator_id:'t2',status:'open',access_mode:'public',starts_at:null,ends_at:null};
  assert.equal(canDiscoverBoard(null,base,false),false);
  assert.equal(canDiscoverBoard(student,base,false),true);
  assert.equal(canDiscoverBoard(student,{...base,status:'draft'},false),false);
  assert.equal(canDiscoverBoard(student,{...base,starts_at:new Date(Date.now()+60000).toISOString()},false),false);
  assert.equal(canDiscoverBoard(student,{...base,ends_at:new Date(Date.now()-60000).toISOString()},false),false);
  const unit={...base,access_mode:'unit',target_donvi:'THPT A',target_lop:'12A1,12A2'};
  assert.equal(unitAndClassMatch(student,unit),true);
  assert.equal(canDiscoverBoard(student,unit,false),true);
  assert.equal(canDiscoverBoard({...student,lop:'12A3'},unit,false),false);
  assert.equal(canDiscoverBoard({...student,donvi:'THPT B'},unit,false),false);
});

test('owner/admin rules and public projection never expose access hash/settings to students',()=>{
  const row={id:'b1',name:'Board',creator_id:'t1',status:'open',access_mode:'protected',
    access_code_hash:'pbkdf2:secret',settings_json:'{"private":true}',student_permission:'draw',
    max_participants:60,revision:2,created_at:'x',updated_at:'y'};
  assert.equal(canManageBoard(teacher,row,false),true);
  assert.equal(canManageBoard(student,row,false),false);
  assert.equal(canManageBoard(student,row,true),true);
  const pub=boardListProjection(row,false);
  assert.equal(pub.protected,true);
  assert.equal('access_code_hash' in pub,false);
  assert.equal('settings' in pub,false);
  const owner=boardListProjection(row,true);
  assert.deepEqual(owner.settings,{private:true});
});

test('class list normalization is bounded and deduplicated',()=>{
  assert.deepEqual(normalizeClassList('12A1, 12A1, 12A2'),['12A1','12A2']);
  assert.equal(normalizeClassList(Array.from({length:100},(_,i)=>'L'+i)).length,50);
});

test('implementation is lazy, bounded and does not push live strokes into Neon',()=>{
  const main=fs.readFileSync('src/main.js','utf8');
  const ui=fs.readFileSync('src/interactive-board-ui.js','utf8');
  const api=fs.readFileSync('functions/api/boards.ts','utf8');
  const join=fs.readFileSync('functions/api/board/join.ts','utf8');
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  const pages=fs.readFileSync('functions/api/board/pages.ts','utf8');
  assert.match(main,/import\('\.\/interactive-board-ui\.js'\)/);
  assert.match(main,/tab === 'boards'/);
  assert.doesNotMatch(main,/^import .*interactive-board-ui/m);
  assert.match(api,/LIMIT \? OFFSET \?/);
  assert.doesNotMatch(api,/SELECT\s+\*/i);
  assert.match(join,/exp:\s*now \+ 300/);
  assert.doesNotMatch(join,/access_code_hash.*realtime_path/s);
  assert.match(worker,/setWebSocketAutoResponse/);
  assert.match(worker,/acceptWebSocket/);
  assert.match(worker,/message\.length>65536/);
  assert.match(worker,/packet\.ops\.length>80/);
  assert.doesNotMatch(worker,/NEON_DATABASE_URL|DATABASE_URL/);
  assert.match(worker,/requestedPageId!==signedPageId/);
  assert.match(worker,/sameUser\.length>=3/);
  assert.match(worker,/storage\.deleteAll/);
  assert.match(worker,/objectCount>=1000/);
  assert.match(worker,/rateOps>400/);
  assert.doesNotMatch(worker,/JWT_SECRET/);
  assert.match(join,/BOARD_REALTIME_SECRET/);
  assert.match(ui,/\/api\/board\/join/);
  assert.match(ui,/scheduleReconnect/);
  assert.match(ui,/board_deleted/);
  assert.match(ui,/board\/pages/);
  assert.match(pages,/Chỉ người quản lý bảng được đọc trực tiếp metadata trang/);
  assert.match(pages,/Mỗi bảng tối đa 20 trang/);
  assert.match(worker,/board-page-reset/);
  assert.match(ui,/policy_changed/);
  assert.match(worker,/internal\/board-policy/);
  assert.match(worker,/Board policy changed/);
  assert.match(api,/LOWER\(\?\) = ANY/);
});

test('worker prevents student overwrite/delete of objects owned by another actor',()=>{
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  assert.match(worker,/existing && !canManage && existing\.creatorId!==actor\.userId/);
  assert.match(worker,/!existing \|\| \(!canManage && existing\.creatorId!==actor\.userId\)/);
});

test('time helper behaves deterministically for open windows',()=>{
  const now=Date.now();
  assert.equal(boardWindowOpen({starts_at:new Date(now-1000).toISOString(),ends_at:new Date(now+1000).toISOString()},now),true);
  assert.equal(boardWindowOpen({starts_at:new Date(now+1000).toISOString(),ends_at:null},now),false);
});
