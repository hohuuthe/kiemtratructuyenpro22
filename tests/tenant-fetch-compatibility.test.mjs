import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Do not attach obsolete browser X-Tenant-Slug after hostname-only backend routing',()=>{
 const ui=readFileSync('src/main.js','utf8');
 assert.doesNotMatch(ui,/headers\.set\(['"]X-Tenant-Slug['"]/);
 assert.doesNotMatch(ui,/headers\.has\(['"]X-Tenant-Slug['"]/);
 assert.match(ui,/response\.status === 421/);
 assert.match(ui,/response\.status === 401/);
});
