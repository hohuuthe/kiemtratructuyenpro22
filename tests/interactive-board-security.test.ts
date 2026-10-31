import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  boardWindowOpen, canDiscoverBoard, canManageBoard, canCreateInteractiveBoard, unitAndClassMatch,
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
  const realtime=fs.readFileSync('functions/api/board/realtime.ts','utf8');
  const workflow=fs.readFileSync('.github/workflows/interactive-board.yml','utf8');
  assert.match(main,/import\('\.\/interactive-board-ui\.js'\)/);
  assert.match(main,/tab === 'boards'/);
  assert.doesNotMatch(main,/^import .*interactive-board-ui/m);
  assert.match(api,/LIMIT \? OFFSET \?/);
  assert.match(api,/COUNT\(\*\) OVER\(\)/);
  assert.match(api,/WITH created_board AS/);
  assert.match(api,/WITH deleted_pages AS/);
  assert.doesNotMatch(api,/SELECT\s+\*/i);
  assert.match(join,/exp:\s*now \+ 300/);
  assert.match(join,/pageIds:/);
  assert.match(join,/allowed_page_ids/);
  assert.match(join,/realtime_base_path/);
  assert.doesNotMatch(join,/access_code_hash.*realtime_path/s);
  assert.match(worker,/setWebSocketAutoResponse/);
  assert.match(worker,/acceptWebSocket/);
  assert.match(worker,/message\.length>65536/);
  assert.match(worker,/packet\.ops\.length>80/);
  assert.doesNotMatch(worker,/NEON_DATABASE_URL|DATABASE_URL/);
  assert.match(worker,/!allowedPages\.includes\(requestedPageId\)/);
  assert.match(worker,/deletedpage:/);
  assert.match(worker,/sameUser\.length>=3/);
  assert.match(worker,/storage\.deleteAll/);
  assert.match(worker,/objectCount>=600/);
  assert.match(worker,/nextOps>400/);
  assert.match(worker,/snapshot_begin/);
  assert.match(worker,/searchParams\.get\('snapshot'\)===\'1\'/);
  assert.match(realtime,/searchParams\.get\('snapshot'\)===\'1\'/);
  assert.match(ui,/fetchPageSnapshot/);
  assert.match(ui,/import\('jspdf'\)/);
  assert.match(ui,/board-export-pdf/);
  assert.match(ui,/exportBoardPdf/);
  assert.match(worker,/snapshot_chunk/);
  assert.match(worker,/pointCount-oldPoints\+newPoints>40000/);
  assert.match(worker,/objectCount>=600/);
  assert.doesNotMatch(worker,/JWT_SECRET/);
  assert.match(join,/BOARD_REALTIME_SECRET/);
  assert.match(ui,/\/api\/board\/join/);
  assert.match(ui,/scheduleReconnect/);
  assert.match(ui,/pendingReliable/);
  assert.match(ui,/\/api\/ai\/generate/);
  assert.match(ui,/boardTextPayload/);
  assert.match(ui,/aiClusterPlan/);
  assert.match(ui,/applyAiCluster/);
  assert.match(ui,/board-ai-run/);
  assert.match(ui,/insertAiResult/);
  assert.match(ui,/gemini_api_key_/);
  assert.match(ui,/snapshot_begin/);
  assert.match(ui,/user_lock_state/);
  assert.match(ui,/data-board-user-clear/);
  assert.match(ui,/board-export-image/);
  assert.match(ui,/remoteLasers/);
  assert.match(ui,/templateObjects/);
  assert.match(ui,/setZoom/);
  assert.match(ui,/pinchStart/);
  assert.match(ui,/panPointers/);
  assert.match(ui,/requestFullscreen/);
  assert.match(ui,/board_deleted/);
  assert.match(ui,/board\/pages/);
  assert.match(pages,/Chỉ người quản lý bảng được đọc trực tiếp metadata trang/);
  assert.match(pages,/Mỗi bảng tối đa 20 trang/);
  assert.doesNotMatch(pages,/bumpBoard/);
  assert.doesNotMatch(pages,/UPDATE interactive_boards/);
  assert.match(worker,/board-page-reset/);
  assert.match(worker,/page_updated/);
  assert.match(ui,/board-page-form/);
  assert.match(ui,/policy_changed/);
  assert.match(worker,/internal\/board-policy/);
  assert.match(worker,/Board policy changed/);
  assert.match(worker,/set_user_lock/);
  assert.match(worker,/vote_toggle/);
  assert.match(worker,/voteRows/);
  assert.match(worker,/timer_start/);
  assert.match(worker,/present_page/);
  assert.match(ui,/vote_state/);
  assert.match(ui,/timer_state/);
  assert.match(ui,/page_focus/);
  assert.match(ui,/followTeacher/);
  assert.match(ui,/board-bring-here/);
  assert.match(worker,/clear_user_objects/);
  assert.match(worker,/stroke_cancel/);
  assert.match(worker,/op_ack/);
  assert.match(worker,/recentops:/);
  assert.match(worker,/type:'laser'/);
  assert.match(api,/LOWER\(\?\) = ANY/);
  assert.doesNotMatch(workflow,/functions\/\[slug\]\/api\/\[\[path\]\]/,'workflow must avoid invalid bracket glob');
  assert.ok(worker.indexOf('if(nextOps>400)') < worker.indexOf("await this.ctx.storage.put(recentKey,durableRecent)"),'rate limit must run before durable dedupe acceptance');
});

test('worker prevents student overwrite/delete of objects owned by another actor',()=>{
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  assert.match(worker,/existing && !canManage && existing\.creatorId!==actor\.userId/);
  assert.match(worker,/existing\?\.creatorId/);
  assert.match(worker,/!existing \|\| \(!canManage && existing\.creatorId!==actor\.userId\)/);
});

test('time helper behaves deterministically for open windows',()=>{
  const now=Date.now();
  assert.equal(boardWindowOpen({starts_at:new Date(now-1000).toISOString(),ends_at:new Date(now+1000).toISOString()},now),true);
  assert.equal(boardWindowOpen({starts_at:new Date(now+1000).toISOString(),ends_at:null},now),false);
});


test('VIP teacher policy gates smart board creation server-side',()=>{
  const normalTeacher={id:'t1',role:'teacher',target_audience:'Giáo viên',is_vip:false};
  const vipTeacher={...normalTeacher,is_vip:true};
  const admin={id:'a1',role:'admin',target_audience:'Quản trị viên',is_vip:false};
  const studentUser={id:'s1',role:'user',target_audience:'Học sinh',is_vip:true};
  assert.equal(canCreateInteractiveBoard(vipTeacher,false,true),true);
  assert.equal(canCreateInteractiveBoard(normalTeacher,false,true),false);
  assert.equal(canCreateInteractiveBoard(admin,true,false),true);
  assert.equal(canCreateInteractiveBoard(studentUser,false,false),false);
});

test('VIP profile field is wired through schema auth APIs and UI',()=>{
  const schema=fs.readFileSync('database-schema.sql','utf8');
  const utils=fs.readFileSync('functions/api/exam/utils.ts','utf8');
  const login=fs.readFileSync('functions/api/auth/login.ts','utf8');
  const users=fs.readFileSync('functions/api/users.ts','utf8');
  const userById=fs.readFileSync('functions/api/users/[id].ts','utf8');
  const main=fs.readFileSync('src/main.js','utf8');
  const boardUi=fs.readFileSync('src/interactive-board-ui.js','utf8');
  const modal=fs.readFileSync('public/components/user-modal.html','utf8');
  assert.match(schema,/is_vip INTEGER DEFAULT 0/);
  assert.match(utils,/ensureUserVipColumn/);
  assert.match(utils,/u\.is_vip AS profile_vip/);
  assert.match(login,/users\.is_vip/);
  assert.match(users,/is_vip/);
  assert.match(userById,/is_vip/);
  assert.match(modal,/id="usr-vip"/);
  assert.match(main,/syncUserVipField/);
  assert.match(main,/is_vip: document\.getElementById\('usr-vip'\)/);
  assert.match(boardUi,/canCreateBoard/);
  assert.match(boardUi,/actor\?\.is_vip/);
});

test('VIP and active switches have clickable labels and board controls expose stable interaction feedback',()=>{
  const modal=fs.readFileSync('public/components/user-modal.html','utf8');
  const ui=fs.readFileSync('src/interactive-board-ui.js','utf8');
  assert.match(modal,/label for="usr-vip"/);
  assert.match(modal,/label for="usr-active"/);
  assert.match(modal,/id="usr-vip"[^>]*aria-label="Người dùng VIP"/);
  assert.match(ui,/function selectBoardTool/);
  assert.match(ui,/aria-pressed/);
  assert.match(ui,/tool==='laser'.*sendOps/s);
  assert.match(ui,/desktopVisible/);
  assert.match(ui,/board-add-page[\s\S]*btn\.disabled=true/);
});



test('non-owner teacher role must not imply realtime manage permission',()=>{
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  assert.match(worker,/const canManage=actor\.permission==='manage'/);
  assert.doesNotMatch(worker,/actor\.role==='teacher'\s*\|\|\s*actor\.role==='admin'/);
});


test('join token normalizes interaction role so user-role students can be moderated',()=>{
  const join=fs.readFileSync('functions/api/board/join.ts','utf8');
  assert.match(join,/const realtimeRole = owner \? 'manager' : 'student'/);
  assert.match(join,/role: realtimeRole/);
});


test('reconnect dedupe survives socket replacement',()=>{
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  assert.match(worker,/recentops:/);
  assert.match(worker,/await this\.ctx\.storage\.put\(recentKey,durableRecent\)/);
  assert.doesNotMatch(worker,/actor\.recentOps/);
});


test('rejected optimistic mutations trigger client resync',()=>{
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  const ui=fs.readFileSync('src/interactive-board-ui.js','utf8');
  assert.match(worker,/resyncRequired=true/);
  assert.match(worker,/type:'resync_required'/);
  assert.match(ui,/m\.type==='resync_required'/);
  assert.match(ui,/connectSocket\(currentPageId\)/);
});

test('production board health check verifies secret binding and worker',()=>{
  const health=fs.readFileSync('functions/api/board/health.ts','utf8');
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  const router=fs.readFileSync('functions/[slug]/api/[[path]].ts','utf8');
  assert.match(health,/realtime_secret/);
  assert.match(health,/realtime_binding/);
  assert.match(health,/realtime_worker/);
  assert.match(worker,/\/internal\/health/);
  assert.match(worker,/idFromName\('__health__'\)/);
  assert.match(worker,/url\.pathname==='\/health'/);
  assert.match(router,/'board\/health': boardHealth/);
});


test('display role is separate from interaction privilege',()=>{
  const join=fs.readFileSync('functions/api/board/join.ts','utf8');
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  assert.match(join,/role: realtimeRole/);
  assert.match(join,/displayRole,/);
  assert.doesNotMatch(join,/role: owner \? \(isAdmin \? 'admin' : 'teacher'\) : 'student'/);
  assert.match(worker,/displayRole:String\(claims\.displayRole\|\|'student'\)/);
  assert.match(worker,/role:s\.displayRole\|\|'student'/);
});

test('PDF export refreshes signed page list when a new page is outside current token',()=>{
  const ui=fs.readFileSync('src/interactive-board-ui.js','utf8');
  assert.match(ui,/response\.status===403&&!retried/);
  assert.match(ui,/roomTokenExpiresAt=0/);
  assert.match(ui,/return fetchPageSnapshot\(pageId,true\)/);
});


test('interactive board mobile workspace keeps touch drawing professional and controls unique',()=>{
  const html=fs.readFileSync('public/components/tab-boards.html','utf8');
  const ui=fs.readFileSync('src/interactive-board-ui.js','utf8');
  const css=fs.readFileSync('src/style.css','utf8');
  assert.equal((html.match(/id="board-note-text-mobile"/g)||[]).length,1);
  assert.match(html,/id="board-participants-toggle"/);
  assert.match(html,/id="board-tools-panel"/);
  assert.match(html,/class="[^"]*board-stage-scroll/);
  assert.match(ui,/getCoalescedEvents/);
  assert.match(ui,/quadraticCurveTo/);
  assert.match(ui,/function applyBoardDeviceDefaults/);
  assert.match(ui,/mobileGesture/);
  assert.match(ui,/kind:'stroke_cancel'/);
  assert.match(ui,/centerX/);
  assert.match(ui,/board-participants-toggle/);
  const worker=fs.readFileSync('workers/interactive-board-worker.js','utf8');
  assert.match(worker,/kind==='stroke_cancel'/);
  assert.match(css,/#board-canvas-wrap\s*\{[\s\S]*min-width:760px/);
  assert.match(css,/\.board-tools-panel[\s\S]*position:sticky/);
  assert.match(css,/touch-action:none/);
});
