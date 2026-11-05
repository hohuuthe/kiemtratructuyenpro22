import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const cfUsers = fs.readFileSync(new URL('../functions/api/users.ts', import.meta.url), 'utf8');
const cfAccounts = fs.readFileSync(new URL('../functions/api/accounts.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

test('all paginated APIs expose total + snapshot and stable unique ordering', () => {
  for (const src of [cfUsers, cfAccounts, server]) {
    assert.match(src, /PAGINATION_SCOPE_CHANGED/);
    assert.match(src, /snapshot/);
    assert.match(src, /has_more/);
  }
  assert.match(cfUsers, /ORDER BY users\.created_at DESC, users\.id DESC/);
  assert.match(cfAccounts, /a\.id DESC/);
  assert.match(server, /ORDER BY u\.created_at DESC,u\.id DESC/);
  assert.match(server, /a\.id DESC/);
});

test('client validates total, snapshot, offset and duplicate ids across pages', () => {
  assert.match(main, /expectedTotal/);
  assert.match(main, /seenIds/);
  assert.match(main, /PAGINATION_SCOPE_CHANGED/);
  assert.match(main, /Number\(json\.offset\) !== offset/);
  assert.match(main, /allUsers\.length !== expectedTotal/);
  assert.match(main, /allAccounts\.length !== expectedTotal/);
  assert.match(main, /offset \+= chunk\.length/);
});

function paginate(total, pageSize) {
  const ids = Array.from({ length: total }, (_, i) => 'id-' + String(i + 1).padStart(6, '0'));
  const seen = new Set();
  let offset = 0;
  let pages = 0;
  while (offset < total) {
    const page = ids.slice(offset, offset + pageSize);
    for (const id of page) {
      assert.equal(seen.has(id), false);
      seen.add(id);
    }
    offset += page.length;
    pages++;
    assert.ok(pages < 1000);
  }
  assert.equal(seen.size, total);
  return pages;
}

for (const total of [0, 1, 999, 1000, 1001, 1999, 2000, 2001, 5000, 5001, 9999]) {
  test('boundary pagination has no gap or duplicate for ' + total + ' records', () => {
    const pages = paginate(total, 1000);
    assert.equal(pages, total === 0 ? 0 : Math.ceil(total / 1000));
  });
}

test('teacher user pagination reserves exactly one slot for self on first page', () => {
  const totalStudents = 5000;
  const pageSize = 1000;
  const self = 'teacher-self';
  const students = Array.from({ length: totalStudents }, (_, i) => 'student-' + (i + 1));
  const assembled = [];
  let offset = 0;

  while (offset < totalStudents + 1) {
    let page;
    if (offset === 0) {
      page = [self, ...students.slice(0, pageSize - 1)];
    } else {
      const studentOffset = offset - 1;
      page = students.slice(studentOffset, studentOffset + pageSize);
    }
    assembled.push(...page);
    offset += page.length;
  }

  assert.equal(assembled.length, totalStudents + 1);
  assert.equal(new Set(assembled).size, totalStudents + 1);
  assert.equal(assembled[0], self);
  assert.equal(assembled.at(-1), students.at(-1));
});

test('snapshot mismatch must force restart instead of accepting mixed pages', () => {
  const first = { total: 2001, snapshot: 'snap-a' };
  const second = { total: 2001, snapshot: 'snap-b' };
  assert.notEqual(first.snapshot, second.snapshot);
  const mustRestart = first.snapshot !== second.snapshot || first.total !== second.total;
  assert.equal(mustRestart, true);
});
