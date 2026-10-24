import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenantFromHostname, resolveTenantFromRequest } from '../src/tenant-host-map.ts';
import { accountSessionState, isAccountEnabled, isUnexpiredAccountToken } from '../src/security-session.ts';

const tenants = { TENANT_HOST_MAP: JSON.stringify({
  'school-a.example.vn':'school_a',
  'school-b.example.vn':'school_b',
  'exam.example.vn':'default'
}) };

test('hostname alone selects a tenant; headers / query / referer cannot switch', () => {
  const request = (host, tenant) => ({url:'https://' + host + '/api/results?tenant='+tenant,
    headers:new Headers({'x-tenant-slug':tenant,Referer:'https://school-b.example.vn/'})});
  assert.equal(resolveTenantFromRequest(request('school-a.example.vn','school_b'),tenants),'school_a');
  assert.equal(resolveTenantFromRequest(request('school-b.example.vn','school_a'),tenants),'school_b');
  assert.equal(resolveTenantFromHostname('exam.example.vn',tenants),'default');
  assert.throws(()=>resolveTenantFromHostname('evil.example.vn',tenants));
  assert.throws(()=>resolveTenantFromHostname('school-a.example.vn.evil.com',tenants));
  assert.throws(()=>resolveTenantFromHostname('school-a.example.vn',{TENANT_HOST_MAP:'broken-json'}));
});
test('locked or changed accounts invalidate previously signed state', async () => {
  const original = {id:'a1',user_id:'u1',username:'t',password:'pbkdf2:abc',role:'admin',is_active:1};
  const proof = await accountSessionState(original);
  assert.equal(proof.length,64);
  assert.equal(isAccountEnabled(original),true);
  for (const changed of [{...original,password:'updated'},{...original,role:'teacher'},
    {...original,is_active:0},{...original,username:'renamed'}]) {
    assert.notEqual(await accountSessionState(changed),proof);
  }
  assert.equal(isAccountEnabled({...original,is_active:0}),false);
  assert.equal(isUnexpiredAccountToken({id:'a1',auth_state:proof,exp:Math.floor(Date.now()/1000)+3600}),true);
  assert.equal(isUnexpiredAccountToken({id:'a1',auth_state:proof,exp:Math.floor(Date.now()/1000)-1}),false);
});
test('Page and Node exam endpoints require atomic conflict protection and no name-only result ownership',async()=>{
  const fs=await import('node:fs');
  const page=fs.readFileSync('functions/api/exams.ts','utf8');
  const node=fs.readFileSync('server.ts','utf8');
  for (const source of [page,node]) {
    assert.match(source,/updated_at IS NOT DISTINCT FROM \?/);
    assert.match(source,/updateResult|result\.meta\?\.changes/);
    assert.match(source,/409/);
    assert.doesNotMatch(source,/r\.exam_id\s*=\s*e\.id\s+OR\s+r\.exam_name\s*=\s*e\.name/);
  }
  assert.doesNotMatch(node,/const fallbackRes\s*=\s*await executeSqlQuery\(`DELETE FROM results WHERE CAST\(id AS TEXT\) = \?/);
});
