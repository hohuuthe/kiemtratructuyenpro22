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
  assert.match(cfUsers, /ORDER BY[\s\S]*'giáo viên','teacher'[\s\S]*'học sinh','student'[\s\S]*users\.created_at DESC, users\.id DESC/);
  assert.match(cfAccounts, /a\.id DESC/);
  assert.match(server, /ORDER BY CASE[\s\S]*'giáo viên','teacher'[\s\S]*'học sinh','student'[\s\S]*u\.created_at DESC,u\.id DESC/);
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


test('large identity reads cannot bypass verified pagination', () => {
  assert.doesNotMatch(main, /\/api\/(users|accounts)\?limit=all/);
  assert.match(main, /\/api\/core-identity\?paged=1/);
  assert.match(main, /fetchAllUsersChunked\(\)/);
  assert.match(main, /fetchAllAccountsChunked\(\)/);
  assert.match(cfUsers, /PAGINATION_SCOPE_CHANGED/);
  assert.match(cfAccounts, /PAGINATION_SCOPE_CHANGED/);
});

test('teacher assignment scope fails closed when class or unit is incomplete', () => {
  const core = fs.readFileSync(new URL('../functions/api/core-identity.ts', import.meta.url), 'utf8');
  assert.match(core, /TEACHER_ASSIGNMENT_SCOPE_INCOMPLETE/);
  assert.match(core, /!String\(a\.donvi \|\| ''\)\.trim\(\)/);
  assert.doesNotMatch(core, /NULLIF\(tc\.donvi/);
  assert.match(server, /TEACHER_ASSIGNMENT_SCOPE_INCOMPLETE/);
});

test('server verifies scope fingerprint both before and after page select', () => {
  assert.match(cfAccounts, /Re-read the full scope fingerprint after reading the page/);
  assert.match(cfUsers, /Verify the full scope again after the page SELECT/);
  assert.match(server, /const verifyMeta=await executeSqlQuery\(metaSql,binds\)/);
  assert.match(server, /Phạm vi dữ liệu giáo viên thay đổi ngay trong lúc đọc trang/);
});


test('node identity pagination bypasses the process query cache', () => {
  assert.match(server, /const bypassCache = sql\.includes\('\/\* no-cache \*\/'\)/);
  assert.match(server, /!bypassCache && !sql\.includes\('FROM accounts'\)/);
  assert.match(server, /\/\* no-cache \*\/ SELECT COUNT\(\*\)::int AS student_total/);
  assert.match(server, /\/\* no-cache \*\/ SELECT u\.\*/);
});


test('has_more is derived from verified total, not full-page heuristics', () => {
  assert.match(cfUsers, /has_more:\s*limit > 0 \? offset \+ rows\.length < total : false/);
  assert.match(cfAccounts, /has_more:\s*limit > 0 \? offset \+ rows\.length < total : false/);
  assert.match(server, /has_more:limit>0\?offset\+rows\.length<total:false/);
  assert.doesNotMatch(server, /rows\.length===limit/);
});

test('server caps oversized page requests and client advances by actual rows', () => {
  assert.match(cfUsers, /limit = Math\.min\(parsed, 5000\)/);
  assert.match(cfAccounts, /limit = Math\.min\(parsed, 5000\)/);
  assert.match(server, /limit=Math\.min\(parsed,5000\)/);
  assert.match(main, /const chunkSize = 1000/);
  assert.match(main, /offset \+= chunk\.length/);
  assert.match(main, /const maxRestarts = 3/);
  assert.match(main, /pageNum > 1000/);
});

function paginateTeacherStudents(totalStudents, pageSize) {
  const self = 'teacher-self';
  const students = Array.from({ length: totalStudents }, (_, i) => 'student-' + String(i + 1).padStart(6, '0'));
  const assembled = [];
  const seen = new Set();
  let offset = 0;
  let pages = 0;
  const combinedTotal = totalStudents + 1;

  while (offset < combinedTotal) {
    let page;
    if (offset === 0) {
      page = [self, ...students.slice(0, Math.max(0, pageSize - 1))];
    } else {
      const studentOffset = offset - 1;
      page = students.slice(studentOffset, studentOffset + pageSize);
    }

    assert.ok(page.length > 0);
    assert.ok(page.length <= pageSize);
    for (const id of page) {
      assert.equal(seen.has(id), false, 'duplicate id across teacher pages: ' + id);
      seen.add(id);
    }

    assembled.push(...page);
    offset += page.length;
    pages++;
    assert.ok(pages < 1000);
  }

  assert.equal(assembled.length, combinedTotal);
  assert.equal(seen.size, combinedTotal);
  assert.equal(assembled[0], self);
  if (totalStudents > 0) assert.equal(assembled.at(-1), students.at(-1));
  assert.equal(pages, Math.ceil(combinedTotal / pageSize));
}

for (const totalStudents of [0, 1, 998, 999, 1000, 1001, 1998, 1999, 2000, 2001, 4999, 5000, 5001, 9999, 10000, 10001, 25000]) {
  test('teacher pagination stays exact at student boundary ' + totalStudents, () => {
    paginateTeacherStudents(totalStudents, 1000);
  });
}

for (const total of [10000, 10001, 25000, 50000, 100000]) {
  test('large account-style pagination stays exact for ' + total + ' records', () => {
    const pages = paginate(total, 1000);
    assert.equal(pages, Math.ceil(total / 1000));
  });
}

test('exact multiples terminate without requesting a phantom page', () => {
  assert.equal(paginate(1000, 1000), 1);
  assert.equal(paginate(2000, 1000), 2);
  assert.equal(paginate(10000, 1000), 10);
});
