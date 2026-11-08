import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  verifyExamConfigQuestionPool,
  examQuestionPoolFailureMessage,
  normalizeExamPoolLesson,
  normalizeExamPoolType,
  normalizeExamPoolLevel
} from '../src/exam-question-pool-integrity.js';

const q = (id, creatorId, lesson, type, level) => ({id, creatorId, lesson, type, level});

test('question pool verification requires exact creator, selected lesson, type and level', () => {
  const config = {
    creatorId: 'teacher-A',
    selectedLessons: [' Bài 1 ', 'BÀI   2'],
    count41: 3, count41NB: 1, count41TH: 1, count41VD: 1,
    countTF4: 1, countTF4NB: 1, countTF4TH: 0, countTF4VD: 0,
    countSQ: 0, countTL: 0
  };
  const rows = [
    q('1','teacher-A','bài 1','4-1','NB'),
    q('2','teacher-A','BÀI 1','mcq','TH'),
    q('3','teacher-A','bài   2','trac_nghiem','VD'),
    q('4','teacher-A','bài 2','true_false','NB'),
    q('5','teacher-B','bài 1','4-1','NB'),
    q('6','teacher-A','bài 3','4-1','NB')
  ];
  const result = verifyExamConfigQuestionPool(config, rows);
  assert.equal(result.ok, true);
  assert.equal(result.requiredTotal, 4);
  assert.equal(result.eligibleTotal, 4);
  assert.equal(result.counts['4-1-NB'], 1);
  assert.equal(result.counts['4-1-TH'], 1);
  assert.equal(result.counts['4-1-VD'], 1);
  assert.equal(result.counts['TF4-NB'], 1);
});

test('verification fails closed when one configured difficulty cell is short', () => {
  const config = {
    creatorId: 'teacher-A', selectedLessons: ['Bài 1'],
    count41: 2, count41NB: 1, count41TH: 1, count41VD: 0,
    countTF4: 0, countSQ: 0, countTL: 0
  };
  const result = verifyExamConfigQuestionPool(config, [
    q('1','teacher-A','Bài 1','4-1','NB'),
    q('2','teacher-B','Bài 1','4-1','TH')
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing[0], {
    reason: 'insufficient', type: '4-1', level: 'TH', required: 1, available: 0
  });
  assert.match(examQuestionPoolFailureMessage(result), /4-1 TH cần 1, hiện có 0/);
});

test('legacy configuration without difficulty breakdown verifies by total type count', () => {
  const config = {
    creatorId: 'teacher-A', selectedLessons: ['Bài 1'],
    count41: 2, count41NB: 0, count41TH: 0, count41VD: 0,
    countTF4: 0, countSQ: 0, countTL: 0
  };
  const result = verifyExamConfigQuestionPool(config, [
    q('1','teacher-A','Bài 1','4-1','NB'),
    q('2','teacher-A','Bài 1','4-1','VD')
  ]);
  assert.equal(result.ok, true);
});

test('missing creator or lessons is rejected for non-empty exam configuration', () => {
  const base = {count41: 1, countTF4: 0, countSQ: 0, countTL: 0};
  assert.equal(verifyExamConfigQuestionPool({...base, selectedLessons:['Bài 1']}, []).ok, false);
  assert.equal(verifyExamConfigQuestionPool({...base, creatorId:'teacher-A', selectedLessons:[]}, []).ok, false);
});

test('normalizers keep editor availability counts aligned with server-era aliases', () => {
  assert.equal(normalizeExamPoolLesson('  BÀI   10  '), 'bài 10');
  assert.equal(normalizeExamPoolType('MCQ'), '4-1');
  assert.equal(normalizeExamPoolType('true_false'), 'TF4');
  assert.equal(normalizeExamPoolType('tra_loi_ngan'), 'SQ');
  assert.equal(normalizeExamPoolType('tu_luan'), 'TL');
  assert.equal(normalizeExamPoolLevel(' th '), 'TH');
  assert.equal(normalizeExamPoolLevel(''), '');
});

test('load flow verifies authoritative bank total and pool before applyExamConfig', () => {
  const app = readFileSync('src/main.js', 'utf8');
  const fetchStart = app.indexOf('async function fetchAllQuestionsChunked(onProgress)');
  const fetchEnd = app.indexOf('window.fetchAllQuestionsChunked = fetchAllQuestionsChunked', fetchStart);
  const fetchPart = app.slice(fetchStart, fetchEnd);
  assert.match(fetchPart, /fetchAuthoritativeTotal/);
  assert.match(fetchPart, /const expectedTotal = await fetchAuthoritativeTotal\(\)/);
  assert.match(fetchPart, /const finalTotal = await fetchAuthoritativeTotal\(\)/);
  assert.match(fetchPart, /allQuestions\.length !== expectedTotal/);
  assert.match(fetchPart, /receivedIds\.size !== allQuestions\.length/);

  const loadStart = app.indexOf('window.loadExamConfigById = async function loadExamConfigById');
  const loadEnd = app.indexOf('window.openExportDocxModal', loadStart);
  const loadPart = app.slice(loadStart, loadEnd);
  const verifyIndex = loadPart.indexOf('await ensureExamConfigQuestionPoolLoaded(draftToLoad)');
  const applyIndex = loadPart.indexOf('applyExamConfig(resJson.data)');
  assert.ok(verifyIndex >= 0, 'must verify pool before loading exam');
  assert.ok(applyIndex > verifyIndex, 'applyExamConfig must happen only after verified pool');

  const countStart = app.indexOf('function updateAvailableCounts()');
  const countEnd = app.indexOf('function restoreExamConfig()', countStart);
  const countPart = app.slice(countStart, countEnd);
  assert.match(countPart, /normalizeExamPoolType\(q\.type\) === type/);
  assert.match(countPart, /normalizeExamPoolLevel\(q\.level\) === level/);
  assert.match(countPart, /normalizeExamPoolLesson\(q\.lesson\)/);
});
