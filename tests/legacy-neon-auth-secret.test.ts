import test from 'node:test';
import assert from 'node:assert/strict';
import {getDynamicSecret} from '../functions/api/exam/utils.ts';

test('legacy short JWT_SECRET does not turn healthy database into 503, persists DB-scoped secret',async()=>{
  const state={value:''};
  const db={connectionUrl:'postgresql://test@tenant-one.invalid/test',prepare(sql:string){
    return {bind(...args:any[]){this.args=args;return this;},
      async run(){if(sql.includes('INSERT INTO _internal_secrets')&&!state.value)state.value=this.args?.[0]||'';return {success:true};},
      async first(){return {value:state.value};}
    };
  }};
  const first=await getDynamicSecret(db,'legacy-secret');
  const second=await getDynamicSecret(db,'legacy-secret');
  assert.equal(first.length,64);
  assert.equal(first,second);
  assert.notEqual(first,'legacy-secret');
  const strong=await getDynamicSecret(db,'strong-secure-env-secret-which-is-over-32-chars');
  assert.equal(strong.length,64);
  assert.notEqual(first,strong);
});
