import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXAM_QUESTION_INVENTORY_SQL,validateExamQuestionInventory,checkExamStartWindow} from '../src/exam-question-readiness.js';

const config={selectedLessons:['Bài 1','Bài 2'],countsDetail:{count41NB:1,count41TH:1,count41VD:0},count41:2,countTF4:1,countSQ:0,countTL:0};
const rows=[
 {type:'4-1',level:'NB',lesson:'Bài 1',available:1},
 {type:'4-1',level:'TH',lesson:'Bài 1',available:1},
 {type:'TF4',level:'NB',lesson:'Bài 2',available:1}
];
test('metadata-only pass and missing categories/levels fail closed',()=>{
 assert.equal(validateExamQuestionInventory(rows,config).ready,true);
 assert.equal(validateExamQuestionInventory(rows.slice(0,2),config).ready,false);
 assert.equal(validateExamQuestionInventory(rows.slice(1),config).ready,false);
 assert.equal(validateExamQuestionInventory(rows,{...config,selectedLessons:[]}).ready,false);
 assert.equal(validateExamQuestionInventory(rows,{...config,countsDetail:{count41NB:3}}).ready,false);
});
test('server date restriction includes not-started, expired, malformed and correct time',()=>{
 const gate={access_control:{enabled:true,startTime:'2026-10-29T01:00:00Z',endTime:'2026-10-29T02:00:00Z'}};
 assert.equal(checkExamStartWindow(gate,Date.parse('2026-10-29T00:59:59Z')).code,'EXAM_NOT_STARTED');
 assert.equal(checkExamStartWindow(gate,Date.parse('2026-10-29T02:00:01Z')).code,'EXAM_CLOSED');
 assert.equal(checkExamStartWindow(gate,Date.parse('2026-10-29T01:30:00Z')).ready,true);
 assert.equal(checkExamStartWindow({access_control:'INVALID'},Date.now()).ready,false);
});
test('query is metadata only, scoped to teacher and excludes blank content',()=>{
 assert.match(EXAM_QUESTION_INVENTORY_SQL,/COUNT\(DISTINCT id\)/);
 assert.match(EXAM_QUESTION_INVENTORY_SQL,/creator_id = \?/);
 assert.doesNotMatch(EXAM_QUESTION_INVENTORY_SQL,/SELECT \*/);
 assert.doesNotMatch(EXAM_QUESTION_INVENTORY_SQL,/SELECT .*answer/i);
});
test('Cloudflare and Express block questions until authoritative preflight passes',()=>{
 for(const file of ['functions/api/exam/generate.ts','server.ts']){
  const src=readFileSync(file,'utf8');
  assert.match(src,/checkExamStartWindow\(dbExam\)/);
  assert.match(src,/validateExamQuestionInventory\(/);
  assert.match(src,/EXAM_QUESTION_INVENTORY_SQL/);
  const generateSection=src.slice(src.indexOf('Preflight inventory check failed:'),src.indexOf('const normalizeType',src.indexOf('Preflight inventory check failed:')));
  assert.doesNotMatch(generateSection,/SELECT \* FROM questions'\)/);
  const pre=src.indexOf('validateExamQuestionInventory(');
  const body=src.indexOf('SELECT * FROM questions WHERE');
  assert.ok(pre>0&&body>pre);
  assert.match(src,/preflightOnly === true/);
 }
 const ui=readFileSync('src/main.js','utf8');
 assert.match(ui,/preflightOnly:true/);
 assert.doesNotMatch(ui,/\/api\/questions\?metaOnly=true&teacherId=/);
 assert.match(ui,/window\.examAvailabilityVerified/);
});
