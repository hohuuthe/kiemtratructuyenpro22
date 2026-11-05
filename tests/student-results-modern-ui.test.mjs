import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildStudentAttemptHistoryMarkup,
    buildStudentResultDetailMarkup,
    escapeStudentText,
    filterStudentResultPage,
    studentAnswerStatus,
    studentResultDuration,
    studentResultPageStats,
    sortStudentAttemptHistory
} from '../src/student-results-ui.js';

const rows = [
    {id:'s1',exam_id:'e1',can_view_score:true,can_view_details:true,exam_name:'Kiểm tra Toán',score:8.5,correct_count:9,total_questions:10,time_taken:125,created_at:'2026-10-24T08:00:00Z'},
    {id:'s2',exam_id:'e2',can_view_score:true,can_view_details:true,exam_name:'Kiểm tra Hóa',score:4.2,correct_count:4,total_questions:10,time_taken:80,created_at:'2026-10-23T08:00:00Z'},
    {id:'s3',exam_id:'e1',can_view_score:true,can_view_details:true,exam_name:'Bài kiểm tra Toán',score:6,correct_count:6,total_questions:10,time_taken:65,created_at:'2026-10-22T08:00:00Z'}
];

test('Private history page computes stats without fetching other pages',()=>{
    assert.deepEqual(studentResultPageStats(rows,120),{total:120,best:8.5,distinctExams:2});
    assert.deepEqual(filterStudentResultPage(rows,{query:'toan'}).map(x=>x.id),['s1','s3']);
    assert.deepEqual(filterStudentResultPage(rows,{scoreBand:'high'}).map(x=>x.id),['s1']);
    assert.deepEqual(filterStudentResultPage(rows,{sort:'score-asc'}).map(x=>x.id),['s2','s3','s1']);
    assert.equal(studentResultDuration(65),'1:05');
});
test('Result review keeps raw grading feedback hidden unless server marks owned student detail scope',()=>{
    const result={
        exam_name:'<img src=x onerror=alert(1)>',
        score:7,can_view_score:true,can_view_details:true,correct_count:1,total_questions:2,time_taken:85,created_at:'2026-10-24',
        details:[
            {question:{type:'4-1',content:'Tính $x^2$',options:{A:'Đáp án A',B:'Đáp án B'}},userAnswer:'B',correctAnswer:'A',isCorrect:false,score:0,aiFeedback:'SECRET_TEACHER_FEEDBACK'},
            {question:{type:'TL',content:'Viết đoạn văn'},userAnswer:'<script>boom()</script>',correctAnswer:'SECRET_ANSWER_KEY',score:2,aiFeedback:'SECRET_AI_FEEDBACK'}
        ]
    };
    const html=buildStudentResultDetailMarkup(result,{formatDate:()=> '24/10/2026'});
    assert.ok(html.includes('Chi tiết bài làm'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('<script>boom()'));
    assert.ok(html.includes('SECRET_ANSWER_KEY'));
    assert.ok(!html.includes('SECRET_TEACHER_FEEDBACK'));
    assert.ok(!html.includes('SECRET_AI_FEEDBACK'));
    const scopedHtml=buildStudentResultDetailMarkup({...result,student_feedback_scope:'owned-detail'},{formatDate:()=> '24/10/2026'});
    assert.ok(scopedHtml.includes('SECRET_AI_FEEDBACK'));
    assert.ok(scopedHtml.includes('Xem chi tiết nhận xét AI'));
    assert.ok(scopedHtml.includes('student-essay-ai-dialog'));
    assert.ok(!scopedHtml.includes('SECRET_TEACHER_FEEDBACK'));
    assert.ok(html.includes('Đáp án đúng'));
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


test('Attempt history is compact, escaped and sorted by highest visible score first',()=>{
    const attempts=[
        {id:'a1',exam_id:'e1',exam_name:'Đề <A>',score:7.5,can_view_score:true,time_taken:130,created_at:'2026-10-22T08:00:00Z',cheat_warning_count:2},
        {id:'a2',exam_id:'e1',exam_name:'Đề <A>',score:9,can_view_score:true,time_taken:80,created_at:'2026-10-21T08:00:00Z',cheat_warning_count:0},
        {id:'a3',exam_id:'e1',exam_name:'Đề <A>',score:9,can_view_score:true,time_taken:90,created_at:'2026-10-23T08:00:00Z',cheat_warning_count:1}
    ];
    assert.deepEqual(sortStudentAttemptHistory(attempts).map(x=>x.id),['a3','a2','a1']);
    const html=buildStudentAttemptHistoryMarkup(attempts,{examName:'Đề <A>',formatDate:()=> '23/10/2026'});
    assert.ok(html.includes('Các lần làm bài'));
    assert.ok(html.includes('Thời gian làm'));
    assert.ok(html.includes('Vi phạm'));
    assert.ok(html.includes('2 lần'));
    assert.ok(html.includes('&lt;A&gt;'));
    assert.ok(!html.includes('Đề <A>'));
});


test('Student attempt button has standalone controller wiring without changing the large main bundle',()=>{
    const ui=readFileSync('src/student-results-ui.js','utf8');
    const index=readFileSync('index.html','utf8');
    assert.match(ui,/student-result-attempts-request/);
    assert.match(ui,/detail: \{ examId:/);
    assert.match(index,/student-attempt-history-controller\.js/);
});

test('Student result cards always show the recorded violation count',()=>{
    const ui=readFileSync('src/student-results-ui.js','utf8');
    const css=readFileSync('src/style.css','utf8');
    assert.match(ui,/student-result-violation/);
    assert.match(ui,/result\.cheat_warning_count/);
    assert.match(ui,/Vi phạm/);
    assert.match(ui,/Math\.max\(0, Math\.floor\(Number\(result\.cheat_warning_count\) \|\| 0\)\)/);
    assert.match(css,/\.student-result-violation\.no-violation/);
    assert.match(css,/\.student-result-violation\.has-violation/);
});
