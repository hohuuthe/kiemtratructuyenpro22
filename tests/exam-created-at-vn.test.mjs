import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {
  EXAM_CREATION_TIME_ZONE, parseExamCreatedAt, formatExamCreatedAtVN
} from '../src/exam-created-at-vn.js';

test('Vietnam timezone is explicit and unchanged by viewer locale',()=>{
  assert.equal(EXAM_CREATION_TIME_ZONE,'Asia/Ho_Chi_Minh');
  const fromUtc=formatExamCreatedAtVN('2026-10-24T17:30:05.000Z');
  assert.deepEqual(fromUtc,{hour:'00:30:05',date:'25/10/2026',iso:'2026-10-24T17:30:05.000Z'});
  assert.deepEqual(formatExamCreatedAtVN('2026-10-25T00:30:05+07:00'),fromUtc);
  assert.deepEqual(formatExamCreatedAtVN('2026-10-24 17:30:05'),fromUtc,
    'historical SQL UTC without suffix must not be interpreted using viewer local timezone');
  assert.deepEqual(formatExamCreatedAtVN('2026-10-24T17:30:05.000000+00:00'),fromUtc);
});
test('Timezone conversion handles end of month, leap day and offset',()=>{
  assert.deepEqual(formatExamCreatedAtVN('2024-02-29T18:01:02Z'),{
    hour:'01:01:02',date:'01/03/2024',iso:'2024-02-29T18:01:02.000Z'
  });
  assert.deepEqual(formatExamCreatedAtVN('2026-01-01T00:00:00-05:00'),{
    hour:'12:00:00',date:'01/01/2026',iso:'2026-01-01T05:00:00.000Z'
  });
  assert.equal(formatExamCreatedAtVN('2026-10-25 00:00:00').date,'25/10/2026');
  assert.equal(formatExamCreatedAtVN('2026-10-25T00:00:00+0700').hour,'00:00:00');
});
test('Reject missing or invalid timestamps without fabricating a creation time',()=>{
  for(const value of [
    null, undefined, false,0, 1720000000000,'',' ','2026-10-25',
    '2026-02-29T01:00:00Z','2026-13-01T01:00:00Z',
    '2026-10-25T24:00:00Z','2026-10-25T00:60:00Z',
    '2026-10-25T12:34Z','yesterday','2026-10-25T12:34:56+15:00',
    '2026-10-25T12:34:56Z<script>'
  ]) assert.equal(formatExamCreatedAtVN(value),null,'unexpected parse: '+String(value));
  assert.equal(parseExamCreatedAt(new Date('invalid')),null);
});
test('Vietnam timezone rendering stays identical in other operating system timezones',()=>{
  const code="import {formatExamCreatedAtVN} from './src/exam-created-at-vn.js'; "+
    "process.stdout.write(JSON.stringify(formatExamCreatedAtVN('2026-10-24 17:30:05')));";
  const outputs=[];
  for(const tz of ['UTC','America/New_York','Pacific/Auckland']){
    const p=spawnSync(process.execPath,['--input-type=module','-e',code],{
      encoding:'utf8',env:{...process.env,TZ:tz}
    });
    assert.equal(p.status,0,'Failed in '+tz+': '+p.stderr);
    outputs.push(p.stdout);
  }
  assert.equal(new Set(outputs).size,1);
  assert.deepEqual(JSON.parse(outputs[0]),{
    hour:'00:30:05',date:'25/10/2026',iso:'2026-10-24T17:30:05.000Z'
  });
});
test('The frontend and both exam APIs use persisted created_at, not updated_at',()=>{
  const main=readFileSync('src/main.js','utf8');
  const pages=readFileSync('functions/api/exams.ts','utf8');
  const node=readFileSync('server.ts','utf8');
  const html=readFileSync('public/components/tab-exams.html','utf8');
  const css=readFileSync('src/style.css','utf8');
  assert.match(main,/formatExamCreatedAtVN\(item\.created_at \?\? item\.createdAt\)/);
  assert.doesNotMatch(main,/formatExamCreatedAtVN\(item\.updated_at/);
  assert.match(main,/class="exam-config-created-time" datetime="/);
  assert.match(main,/class="exam-config-created-hour"/);
  assert.match(main,/class="exam-config-created-date"/);
  assert.match(pages,/SELECT ec\.\*, u\.donvi AS teacher_donvi/);
  assert.match(pages,/created_at, updated_at\) VALUES/);
  assert.match(node,/ec\.created_at, ec\.updated_at/);
  assert.match(html,/Thời gian tạo[\s\S]*?<\/th>/);
  assert.match(css,/\.exam-configs-table \.exam-config-created-time[\s\S]*?flex-direction: column/);
  assert.match(css,/\.exam-configs-table th:nth-child\(12\) \{ width: 8%; \}/);
});
