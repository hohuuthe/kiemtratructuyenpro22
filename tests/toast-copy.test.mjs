import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const source=readFileSync('src/main.js','utf8');

test('Toast copy button supports Clipboard API and fallback copy',()=>{
 assert.match(source,/copyBtn\.onclick = async \(\) =>/);
 assert.match(source,/navigator\.clipboard && navigator\.clipboard\.writeText/);
 assert.match(source,/await navigator\.clipboard\.writeText\(trimmedMsg\)/);
 assert.match(source,/document\.createElement\('textarea'\)/);
 assert.match(source,/document\.execCommand\('copy'\)/);
 assert.match(source,/showToast\('Đã sao chép thông báo\.', 'success'\)/);
 assert.match(source,/Không thể sao chép thông báo/);
});

test('Toast attempts synchronous copy while click activation is valid and retains errors for inspection',()=>{
 const begin=source.indexOf('copyBtn.onclick = async () =>');
 const end=source.indexOf('toast.appendChild(copyBtn)',begin);
 assert.ok(begin>=0 && end>begin);
 const handler=source.slice(begin,end);
 assert.ok(handler.indexOf("document.execCommand('copy')")<handler.indexOf('await navigator.clipboard.writeText(trimmedMsg)'),
   'The fallback must execute before the first await while transient user activation exists');
 assert.match(handler,/ta\?\.remove\(\)/);
 assert.match(source,/type === 'error' \? 15000/);
});

test('Word import toast distinguishes safe-copy save and safe-copy retry',()=>{
 assert.match(source,/receipt\.safeCopy/);
 assert.match(source,/Đã lưu bản nhập an toàn/);
 assert.match(source,/Bản nhập an toàn của tệp Word đã tồn tại/);
});
