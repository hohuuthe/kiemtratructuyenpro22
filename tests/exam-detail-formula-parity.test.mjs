import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  getExamDetailOption, renderExamDetailQuestion, renderExamDetailOptions
} from '../src/exam-detail-formula-renderer.js';
import { renderScientificContent } from '../src/scientific-formula-engine.ts';

const sample = {
  type: '4-1',
  content: 'Cho $\\frac{\\sqrt{x}}{2}$ và $\\int_0^1 x^2dx$',
  options: {
    A: { text: '$\\frac{1}{2}$' },
    B: { text: '$\\ce{H2O}$' },
    C: { text: '$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$' },
    D: { text: '$E=mc^2$' }
  }
};

test('Detail question is exactly the student scientific rendering including display math', () => {
  const html = renderExamDetailQuestion(sample, 0, 24);
  assert.ok(html.includes(renderScientificContent(sample.content)));
  assert.match(html, /class="exam-detail-question responsive-q-text/);
  assert.match(html, /--base-q-size:24px/);
  assert.ok(!html.includes('<p>'), 'block equations must never be nested inside a paragraph');
});

test('MC answer cards show all four original formulas using the student engine', () => {
  const html = renderExamDetailOptions(sample, 'B', 'A', 20);
  assert.equal((html.match(/class="exam-detail-option /g) || []).length, 4);
  for (const letter of ['A','B','C','D']) {
    const input = sample.options[letter].text;
    assert.ok(html.includes(renderScientificContent(input)), letter);
  }
  assert.match(html, /Học sinh chọn/);
  assert.match(html, /Đáp án đúng/);
  assert.match(html, /responsive-a-text/);
  assert.ok(!html.includes('selectAnswer('));
});

test('TF4 preserves chemistry, signs, physics and records student responses without editing grades', () => {
  const question = {
    type:'TF4', content:'$\\ce{SO4^{2-}}$',
    options: {
      A: {text:'Phản ứng $\\ce{2H2 + O2 -> 2H2O}$'},
      B: {text:'Ion $\\ce{NH4+}$'},
      C: {text:'$p^2+2pq+q^2=1$'},
      D: {text:'$E=mc^2$'}
    }
  };
  const old = JSON.stringify(question);
  const html = renderExamDetailOptions(question, {A:true, B:false}, 'A&C');
  for (const letter of ['A','B','C','D']) {
    assert.ok(html.includes(renderScientificContent(question.options[letter].text)), letter);
  }
  assert.match(html, /HS: Đúng/);
  assert.match(html, /HS: Sai/);
  assert.match(html, /ĐA: Đúng/);
  assert.match(html, /ĐA: Sai/);
  assert.equal(JSON.stringify(question), old, 'read-only review must not alter question or answer data');
});

test('Legacy JSON, arrays and numerical option indexes retain formulas', () => {
  const q = {options:JSON.stringify({A:{content:'$x^2$'}, B:'$\\sqrt{2}$', C:{value:'$\\pi$'}, D:{text:'$\\ce{CO2}$'}})};
  assert.equal(getExamDetailOption(q,'A').text, '$x^2$');
  assert.equal(getExamDetailOption(q,'B').text, '$\\sqrt{2}$');
  assert.equal(getExamDetailOption({options:['$a$','$b$','$c$','$d$']},'D').text,'$d$');
  assert.equal(getExamDetailOption({options:{0:'$a$',1:'$b$',2:'$c$',3:'$d$'}},'C').text,'$c$');
  assert.equal(getExamDetailOption({options:{1:'$a$',2:'$b$',3:'$c$',4:'$d$'}},'C').text,'$c$');
  assert.ok(renderExamDetailOptions({type:'4-1',options:q.options}, 'C', 'A').includes(renderScientificContent('$\\pi$')));
});

test('Saved shuffled option order is respected, without mutating original keys', () => {
  const q={...sample,shuffledOptions:['D','C','B','A']};
  const html=renderExamDetailOptions(q,'D','A');
  assert.ok(html.indexOf('data-option-key="D"') < html.indexOf('data-option-key="A"'));
  assert.equal((html.match(/Học sinh chọn/g)||[]).length,1);
  assert.equal((html.match(/Đáp án đúng/g)||[]).length,1);
});

test('Images stay images and untrusted HTML/URLs are never injected', () => {
  const q={type:'4-1',options:{
    A:{text:'<script>alert(1)</script> $x^2$',image:'javascript:alert(1)'},
    B:{text:'$\\frac{1}{3}$',image:'https://example.org/image.png?x=1&y=2'},
    C:{text:'',image:'data:image/png;base64,AA=='},
    D:{text:'$\\ce{H2O}$'}
  }};
  const html=renderExamDetailOptions(q,'B','B');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('https://example.org/image.png?x=1&amp;y=2'));
  assert.ok(html.includes('data:image/png;base64,AA=='));
});

test('Absent old option content is reported, never invented', () => {
  assert.match(renderExamDetailOptions({type:'4-1',options:{}},'A','B'),/không có nội dung/);
  assert.equal(renderExamDetailOptions({type:'TL',content:'$E=mc^2$'},'', ''),'');
});

test('All 516 interdisciplinary fixture sources stay equivalent to student display', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/scientific-formulas-516.json','utf8'));
  assert.equal(fixture.cases.length, 516);
  for (const item of fixture.cases) {
    const source = String(item.latex);
    const expected = renderScientificContent(source);
    const question = renderExamDetailQuestion({content:source},0);
    const answer = renderExamDetailOptions({type:'4-1',options:{A:{text:source}}},'A','A');
    assert.ok(question.includes(expected), 'Question ' + item.id);
    assert.ok(answer.includes(expected), 'Option ' + item.id);
  }
});

test('The actual review modal calls the shared renderer and typesetter', () => {
  const main=readFileSync('src/main.js','utf8');
  const start=main.indexOf('window.showExamDetail = async function showExamDetail(');
  const end=main.indexOf('window.onRankingCheckboxChange =',start);
  assert.ok(start>0 && end>start);
  const review=main.slice(start,end);
  assert.match(review,/renderExamDetailQuestion\(d\.question, i/);
  assert.match(review,/renderExamDetailOptions\(d\.question, d\.userAnswer, d\.correctAnswer/);
  assert.match(review,/queueMathJax\(modalEl\)/);
  assert.match(review,/always-scrollbar-y/);
});
