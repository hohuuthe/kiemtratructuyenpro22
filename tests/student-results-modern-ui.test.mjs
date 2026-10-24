import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildStudentResultDetailMarkup,
    escapeStudentText,
    filterStudentResultPage,
    studentAnswerStatus,
    studentResultDuration,
    studentResultPageStats
} from '../src/student-results-ui.js';

const rows = [
    {id:'s1',exam_id:'e1',exam_name:'Kiểm tra Toán',score:8.5,correct_count:9,total_questions:10,time_taken:125,created_at:'2026-10-24T08:00:00Z'},
    {id:'s2',exam_id:'e2',exam_name:'Kiểm tra Hóa',score:4.2,correct_count:4,total_questions:10,time_taken:80,created_at:'2026-10-23T08:00:00Z'},
    {id:'s3',exam_id:'e1',exam_name:'Bài kiểm tra Toán',score:6,correct_count:6,total_questions:10,time_taken:65,created_at:'2026-10-22T08:00:00Z'}
];

test('Private history page computes stats without fetching other pages',()=>{
    assert.deepEqual(studentResultPageStats(rows,120),{total:120,best:8.5,distinctExams:2});
    assert.deepEqual(filterStudentResultPage(rows,{query:'toan'}).map(x=>x.id),['s1','s3']);
    assert.deepEqual(filterStudentResultPage(rows,{scoreBand:'high'}).map(x=>x.id),['s1']);
    assert.deepEqual(filterStudentResultPage(rows,{sort:'score-asc'}).map(x=>x.id),['s2','s3','s1']);
    assert.equal(studentResultDuration(65),'1:05');
});
test('Result review escapes user-controlled metadata and never reveals keys or teacher feedback',()=>{
    const result={
        exam_name:'<img src=x onerror=alert(1)>',
        score:7,correct_count:1,total_questions:2,time_taken:85,created_at:'2026-10-24',
        details:[
            {question:{type:'4-1',content:'Tính $x^2$',options:{A:'Đáp án A',B:'Đáp án B'}},userAnswer:'B',correctAnswer:'A',isCorrect:false,score:0,aiFeedback:'SECRET_TEACHER_FEEDBACK'},
            {question:{type:'TL',content:'Viết đoạn văn'},userAnswer:'<script>boom()</script>',correctAnswer:'SECRET_ANSWER_KEY',score:2,aiFeedback:'SECRET_AI_FEEDBACK'}
        ]
    };
    const html=buildStudentResultDetailMarkup(result,{formatDate:()=> '24/10/2026'});
    assert.ok(html.includes('Chi tiết bài làm'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('<script>boom()'));
    assert.ok(!html.includes('SECRET_ANSWER_KEY'));
    assert.ok(!html.includes('SECRET_TEACHER_FEEDBACK'));
    assert.ok(!html.includes('SECRET_AI_FEEDBACK'));
    assert.ok(!html.includes('Đáp án đúng'));
    assert.ok(html.includes('scientific') || html.includes('katex'));
    assert.ok(html.includes('Đáp án B'));
});
test('Result status includes answer-not-submitted, graded, essay and partial truth-table',()=>{
    assert.equal(studentAnswerStatus({question:{type:'4-1'},userAnswer:null}).key,'unanswered');
    assert.equal(studentAnswerStatus({question:{type:'4-1'},userAnswer:'A',isCorrect:true}).key,'correct');
    assert.equal(studentAnswerStatus({question:{type:'TF4'},userAnswer:{A:false},isCorrect:false,score:0.25}).label,'Đúng một phần');
    assert.equal(studentAnswerStatus({question:{type:'TL'},userAnswer:'answer',isCorrect:false}).key,'recorded');
    assert.equal(escapeStudentText('<svg onload=alert(1)>'),'&lt;svg onload=alert(1)&gt;');
});
test('Original student-only private API contract is retained',()=>{
    const app=readFileSync('src/main.js','utf8');
    const ui=readFileSync('public/components/tab-ranking.html','utf8');
    const from=app.indexOf('// Student results are fetched only');
    const to=app.indexOf('window.refreshRankingResults',from);
    assert.ok(from>0 && to>from);
    const segment=app.slice(from,to);
    assert.match(segment,/fetch\('\/api\/results\/me\?limit=30&offset='/);
    assert.match(segment,/fetch\('\/api\/results\/me\?id='/);
    assert.doesNotMatch(segment,/fetch\('\/api\/results\?/);
    assert.match(segment,/seq !== myStudentRequestSeq/);
    assert.match(segment,/expectedAccount/);
    assert.match(ui,/ranking-student-panel/);
    assert.match(ui,/ranking-admin-panel/);
});

test('Compact student layout follows existing application forms without viewport clipping',()=>{
    const html=readFileSync('public/components/tab-ranking.html','utf8');
    const css=readFileSync('src/style.css','utf8');
    const source=readFileSync('src/main.js','utf8');
    assert.match(html,/student-results-panel hidden bg-white rounded-2xl shadow-xl/);
    assert.match(html,/ranking-student-score-filter/);
    assert.match(html,/ranking-student-sort/);
    assert.match(css,/#modal-content\.student-results-detail-modal\{[^}]*width:min\(900px,calc\(100vw - 32px\)\)/);
    assert.match(css,/height:min\(760px,calc\(100dvh - 32px\)\)/);
    assert.match(css,/overflow-y:auto!important/);
    assert.match(css,/overscroll-behavior:contain/);
    assert.match(css,/#modal-content\.student-results-detail-modal>button\{[^}]*position:sticky!important/);
    assert.match(css,/@media\(max-width:640px\)/);
    assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
    assert.match(css,/\.student-result-detail \.exam-detail-options\{max-width:100%;min-width:0\}/);
    assert.match(source,/modal\.prepend\(modalCloseButton\)/);
    assert.match(source,/modal\.scrollTop = 0/);
});
