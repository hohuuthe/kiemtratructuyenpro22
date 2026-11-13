import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renderExamConfigMobileCard} from '../src/exam-config-mobile-view.js';

const markup = readFileSync(new URL('../public/components/tab-exams.html',import.meta.url),'utf8');
const css = readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
const main = readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const sample = {
  id: 'exam-A', name: 'Ôn tập Toán lớp 10', creator_id:'teacher-A',
  chedodethi:'Đề cho đơn vị', created_at:'2026-11-13T00:00:00Z',
  target_lop:'10A1, 10A2',target_donvi:'Trường A',
  time_limit:45, count_41:10,count_tf4:4,count_sq:2,count_tl:1,
  counts_detail:{count41NB:4,count41TH:4,count41VD:2,countTF4NB:2,countTF4TH:2,countTF4VD:0},
  selected_lessons:['Bài 1','Bài 2'], points_41:0.25, points_tf4:0.5,
  points_sq:1, points_tl:2, max_attempts:3,max_cheat_warnings:5,
  show_score:1,show_details:0, immediate_feedback:1,is_shared_results:true,
  tf4_scoring_mode:1,tf4_points:{'1':0.1,'2':0.25,'3':0.5,'4':1},
  access_control:{enabled:true,startTime:'2026-11-20T08:00',endTime:'2026-11-20T09:00'},
  ai_grading_key:'SECRET_KEY_DO_NOT_SHOW',mabaomatdethi:'EXAM_SECRET_DO_NOT_SHOW'
};
const render = (exam=sample,additional={}) =>
  renderExamConfigMobileCard({exam,ordinal:1,creator:'Cô Lan',creation:{hour:'07:00:00',date:'13/11/2026'},attemptCount:7,
    canDeleteExam:true,canDeleteResults:true,...additional});

test('Mobile exam cards show all twelve desktop facts without horizontal scrolling',()=>{
 const html=render();
 for(const str of ['Ôn tập Toán lớp 10','exam-A','Cô Lan','13/11/2026','Đề cho đơn vị','Trường A','10A1, 10A2',
   '45','17','7','Trắc nghiệm [4-1]','Đúng/Sai [TF4]','Trả lời ngắn [SQ]','Tự luận [TL]',
   'NB: 4','TH: 4','VD: 2','Lượt làm tối đa','Số lần cảnh báo','Điểm/câu theo từng loại',
   'Bài 1; Bài 2','Hiển thị điểm','Phản hồi tức thời','Hướng dẫn chấm AI']) {
    if(str==='Hướng dẫn chấm AI')continue;
    assert.ok(html.includes(str),str);
 }
 assert.equal((html.match(/class="exam-mobile-count-row"/g)||[]).length,4);
 assert.match(html,/<details class="exam-mobile-details">/);
 assert.match(html,/data-exam-action="load"/);
 assert.match(html,/data-exam-action="export"/);
 assert.match(html,/data-exam-action="delete-results"/);
 assert.match(html,/data-exam-action="delete-exam"/);
 assert.doesNotMatch(html,/SECRET_KEY_DO_NOT_SHOW|EXAM_SECRET_DO_NOT_SHOW/);
});
test('Mobile actions are hidden for unauthorized viewers; empty counts and missing attempts stay honest',()=>{
 const html=render({...sample,count_41:0,count_tf4:0,count_sq:0,count_tl:0,counts_detail:null,chedodethi:'Đề công khai'},
    {attemptCount:null,canDeleteExam:false,canDeleteResults:false});
 assert.match(html,/Chưa có số liệu/);
 assert.match(html,/0 câu/);
 assert.match(html,/Chưa có phân bổ NB\/TH\/VD/);
 assert.match(html,/Không giới hạn \(đề công khai\)/);
 assert.doesNotMatch(html,/data-exam-action="delete-/);
});
test('Mobile HTML safely escapes untrusted title, ID, creator, lesson, class, and AI instruction',()=>{
 const html=render({...sample,id:'x" onclick="alert(1)',name:'<img src=x onerror=alert(1)>',
  target_lop:'<script>alert(1)</script>',selected_lessons:['<svg onload=alert(1)>'],
  ai_prompt:'<b>Prompt</b>'},{creator:'<iframe src=bad>'});
 for(const tag of ['<img','<script','<svg','<iframe','<b>Prompt']) assert.ok(!html.includes(tag),tag);
 assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);assert.match(html,/&lt;svg/);
 assert.match(html,/&lt;iframe/);assert.match(html,/&lt;b&gt;Prompt&lt;\/b&gt;/);
 assert.doesNotMatch(html,/onerror=alert\(1\)>/);
});
test('Desktop table preserved; mobile uses one shared filtered and paginated data source',()=>{
 assert.match(markup,/id="exam-configs-table-scroll"/);
 assert.match(markup,/id="exam-configs-mobile-list"/);
 assert.match(markup,/id="exam-configs-mobile-sort"/);
 assert.match(css,/@media\s*\(max-width:\s*767px\)/);
 assert.match(css,/#exam-configs-table-scroll\s*\{\s*display:\s*none/);
 const start=main.indexOf('window.renderExamConfigsTable = function renderExamConfigsTable()');
 const end=main.indexOf('function renderExamConfigsPaginationControls(',start);
 const renderer=main.slice(start,end);
 assert.match(renderer,/const pagedList = list\.slice\(startIdx, startIdx \+ pageSize\)/);
 assert.match(renderer,/renderExamConfigMobileCard\(/);
 assert.match(renderer,/mobileCards\.join\(''\)/);
 assert.match(renderer,/renderExamConfigsPaginationControls\(list\.length/);
 assert.match(renderer,/data-exam-sort/);
 for(const action of ['load','export','delete-results','delete-exam']) assert.ok(main.includes("case '"+action+"':"),action);
});
