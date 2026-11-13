import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { matchesQuestionBankLevel, countQuestionBankLevels } from '../src/question-bank-level-filter.js';

const app = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/components/tab-questions.html', import.meta.url), 'utf8');

function section(begin, end) {
    const a = app.indexOf(begin);
    const b = app.indexOf(end, a + begin.length);
    assert.ok(a >= 0 && b > a, 'Cannot find code section: ' + begin);
    return app.slice(a, b);
}

test('Difficulty counts and list filtering use identical exact level semantics', () => {
    const questions = [{ level: 'NB' }, { level: 'TH' }, { level: 'VD' }, { level: 'NB' }, { level: 'other' }, {}];
    assert.deepEqual(countQuestionBankLevels(questions), { NB: 2, TH: 1, VD: 1 });
    for (const level of ['NB', 'TH', 'VD']) {
        assert.equal(questions.filter(q => matchesQuestionBankLevel(q, level)).length, countQuestionBankLevels(questions)[level]);
    }
    assert.equal(questions.filter(q => matchesQuestionBankLevel(q, 'ALL')).length, 6);
    assert.deepEqual(countQuestionBankLevels([]), { NB: 0, TH: 0, VD: 0 });
});

test('Compact responsive stats replace four redundant buttons; lesson and teacher controls remain', () => {
    assert.doesNotMatch(html, /q-type-btn/);
    assert.match(html, /id="question-type-stats" class="grid grid-cols-2 lg:grid-cols-4/);
    assert.match(html, /id="question-lesson-filter"/);
    assert.match(html, /id="question-teacher-filter"/);
    const stats = section('function updateQuestionStats()', 'window.deleteQuestionsBySelectedLesson');
    assert.match(stats, /onclick="setQuestionTypeFilter/);
    assert.match(stats, /onclick="setQuestionLevelFilter/);
    assert.match(stats, /aria-pressed/);
    assert.match(stats, /focus-visible:outline/);
});

test('Statistics render 4 type headers and 12 independently clickable difficulty cells', () => {
    const stats = section('function updateQuestionStats()', 'window.deleteQuestionsBySelectedLesson');
    const nodes = {
        'question-lesson-filter': { value: 'Bài 1' },
        'question-teacher-filter': { value: 'teacher-a', selectedOptions: [{ textContent: 'Giáo viên A' }] },
        'question-type-stats': { innerHTML: '' }
    };
    const context = {
        document: { getElementById: id => nodes[id] },
        questions: [
            { type: '4-1', level: 'NB', lesson: 'Bài 1', teacher: 'teacher-a' },
            { type: '4-1', level: 'TH', lesson: 'Bài 1', teacher: 'teacher-a' },
            { type: 'TF4', level: 'VD', lesson: 'Bài 1', teacher: 'teacher-a' },
            { type: 'TL', level: 'NB', lesson: 'Bài 1', teacher: 'teacher-b' },
            { type: 'SQ', level: 'NB', lesson: 'Bài 2', teacher: 'teacher-a' }
        ],
        isUserQuestionCreator: () => true,
        matchesQuestionTeacher: (q, teacher) => !teacher || q.teacher === teacher,
        matchesQuestionType: (q, type) => q.type === type,
        getSelectedQuestionTeacherId: () => 'teacher-a',
        countQuestionBankLevels,
        escapeHTML: text => text,
        isAdminLoggedIn: true,
        questionTypeFilter: '4-1',
        questionLevelFilter: 'NB'
    };
    runInNewContext(stats, context);
    context.updateQuestionStats();
    const output = nodes['question-type-stats'].innerHTML;
    assert.equal(output.split('onclick="setQuestionTypeFilter(').length - 1, 4);
    assert.equal(output.split('onclick="setQuestionLevelFilter(').length - 1, 12);
    assert.match(output, /\[4-1\]: 2/);
    assert.match(output, /\[TF4\]: 1/);
    assert.match(output, /\[SQ\]: 0/);
    assert.match(output, /\[TL\]: 0/);
    assert.match(output, /setQuestionLevelFilter\('TF4', 'VD'\)/);
    assert.match(output, /aria-label="Lọc câu hỏi 4-1 mức độ NB"/);
    assert.match(output, /aria-pressed="true"/);
});

test('Direct level click selects its type; header click resets only the level', () => {
    const setters = section('function setQuestionTypeFilter(type)', 'let recentlySavedIds = new Set()');
    const calls = [];
    const context = {
        clearRecentQuestionFocus: () => calls.push('recent'),
        updateQuestionStats: () => calls.push('stats'),
        renderQuestionsList: () => calls.push('list')
    };
    const code = "let questionTypeFilter = '4-1'; let questionLevelFilter = 'ALL';\n" + setters +
        "\nsetQuestionLevelFilter('TL', 'TH');\n" +
        "const afterLevel = [questionTypeFilter, questionLevelFilter];\n" +
        "setQuestionTypeFilter('TF4');\n" +
        "const afterType = [questionTypeFilter, questionLevelFilter];\n" +
        "setQuestionLevelFilter('bad-type', 'NB'); setQuestionLevelFilter('TF4', 'invalid');\n" +
        "({ afterLevel, afterType, final: [questionTypeFilter, questionLevelFilter] });";
    const state = runInNewContext(code, context);
    assert.deepEqual(Array.from(state.afterLevel), ['TL', 'TH']);
    assert.deepEqual(Array.from(state.afterType), ['TF4', 'ALL']);
    assert.deepEqual(Array.from(state.final), ['TF4', 'ALL']);
    assert.deepEqual(calls, ['recent', 'stats', 'list', 'recent', 'stats', 'list']);
});

test('List, bulk selection, page reset, recent import and show-all use one difficulty state', () => {
    const list = section('function renderQuestionsList()', 'window.toggleQuestionSelection = function');
    const selectAll = section('window.selectAllQuestions = function', 'window.deleteSelectedQuestions = function');
    assert.match(list, /matchesQuestionBankLevel\(q, questionLevelFilter\)/);
    assert.match(selectAll, /matchesQuestionBankLevel\(q, questionLevelFilter\)/);
    assert.match(list, /questionLevelFilter !== lastQuestionsLevelFilter/);
    assert.match(list, /lastQuestionsLevelFilter = questionLevelFilter/);
    assert.match(app, /window.setQuestionLevelFilter = setQuestionLevelFilter/);
    const focus = section('async function revealSavedQuestions(records)', 'window.filterQuestions = function filterQuestions');
    assert.equal(focus.split("questionLevelFilter = 'ALL'").length - 1, 2);
});
