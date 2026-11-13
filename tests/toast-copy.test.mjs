import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {copyToastMessage} from '../src/toast-copy.js';

const source=readFileSync('src/main.js','utf8');

function documentStub({execResult=true,throwExec=false}={}) {
  const calls=[], oldFocus={focus:()=>calls.push('restore')};
  const textarea={
    value:'',style:{},setAttribute:()=>{},focus:()=>calls.push('focus'),
    select:()=>calls.push('select'),setSelectionRange:()=>calls.push('range'),
    remove:()=>calls.push('remove')
  };
  return {
    calls,textarea,activeElement:oldFocus,
    createElement:name=>{assert.equal(name,'textarea');return textarea;},
    body:{appendChild:node=>{assert.equal(node,textarea);calls.push('append');}},
    execCommand:name=>{calls.push(name);if(throwExec)throw new Error('not permitted');return execResult;}
  };
}

test('Toast button is non-submitting and calls the shared clipboard helper',()=>{
  assert.match(source,/import \{ copyToastMessage \} from '\.\/toast-copy\.js'/);
  assert.match(source,/copyBtn\.type = 'button'/);
  assert.match(source,/copyBtn\.onclick = async \(event\) =>/);
  assert.match(source,/event\?\.preventDefault\?\.\(\)/);
  assert.match(source,/await copyToastMessage\(trimmedMsg\)/);
  assert.match(source,/showToast\('Đã sao chép thông báo\.', 'success'\)/);
});

test('Synchronous fallback succeeds on clipboard-restricted Electron/browser',async()=>{
  const doc=documentStub();
  const events=[];
  const clipboard={writeText:async()=>events.push('modern')};
  assert.equal(await copyToastMessage('[ROUNDTRIP_REJECTED] ∼ — công thức 143',{doc,clipboard}),true);
  assert.equal(doc.textarea.value,'[ROUNDTRIP_REJECTED] ∼ — công thức 143');
  assert.deepEqual(events,[]);
  assert.deepEqual(doc.calls,['append','focus','select','range','copy','remove','restore']);
});

test('Modern Clipboard API is fallback when execCommand fails',async()=>{
  const doc=documentStub({execResult:false});
  const writes=[];
  assert.equal(await copyToastMessage('Lỗi 503',{doc,clipboard:{writeText:async text=>writes.push(text)}}),true);
  assert.deepEqual(writes,['Lỗi 503']);
});

test('Both APIs failing reports failure without a false success',async()=>{
  const doc=documentStub({throwExec:true});
  assert.equal(await copyToastMessage('Cần sao chép',{doc,clipboard:{writeText:async()=>{throw Error('denied');}}}),false);
  assert.equal(await copyToastMessage('',{doc}),false);
});

test('Word import toast distinguishes safe-copy save and safe-copy retry',()=>{
  assert.match(source,/receipt\.safeCopy/);
  assert.match(source,/Đã lưu bản nhập an toàn/);
  assert.match(source,/Bản nhập an toàn của tệp Word đã tồn tại/);
});
