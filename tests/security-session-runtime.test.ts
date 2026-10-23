import test from 'node:test';
import assert from 'node:assert/strict';
import {signAuthSession,verifyAuthSession,isLiveAccount} from '../functions/api/exam/utils.ts';

const key='staging-test-secret-with-enough-randomness-123456789';
function fixture(){
 const row:any={id:'teacher-a',user_id:'user-a',username:'teacher-a',password:'pbkdf2:TEST_A',role:'teacher',
 is_active:1,expiry_date:null,target_audience:'Giáo viên',profile_active:1,profile_expiry_date:null,donvi:'School 1',lop:''};
 const db={prepare(){return {bind(){return {async first(){return {...row};}}}}}};
 return {row,db};
}
test('Signed live account session is valid only before account state changes',async()=>{
 const {row,db}=fixture();
 const token=await signAuthSession(row,{id:row.id,role:row.role,target_audience:row.target_audience},key);
 assert.equal((await verifyAuthSession(token,key,db))?.id,row.id);
 row.password='pbkdf2:NEW';assert.equal(await verifyAuthSession(token,key,db),null,'change password');
 row.password='pbkdf2:TEST_A';row.role='user';assert.equal(await verifyAuthSession(token,key,db),null,'change role');
 row.role='teacher';row.is_active=0;assert.equal(await verifyAuthSession(token,key,db),null,'account locked');
 row.is_active=1;row.profile_active=0;assert.equal(await verifyAuthSession(token,key,db),null,'profile locked');
 row.profile_active=1;row.target_audience='Học sinh';assert.equal(await verifyAuthSession(token,key,db),null,'audience changed');
});
test('Expired accounts and historical unsigned session types fail closed',async()=>{
 const {row,db}=fixture();
 row.expiry_date='2000-01-01';assert.equal(isLiveAccount(row),false);
 await assert.rejects(signAuthSession(row,{id:row.id},key));
 row.expiry_date=null;
 const valid=await signAuthSession(row,{id:row.id},key);
 assert.equal((await verifyAuthSession(valid,key,db))?.id,row.id);
 const oldToken=valid.split('.');
 const payload=JSON.parse(Buffer.from(oldToken[1],'base64url').toString('utf8'));
 assert.equal(payload.tokenType,'auth');
 assert.ok(payload.exp>payload.iat);
});
