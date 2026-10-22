import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';

const folder='artifacts/word-import-visual-qa';
mkdirSync(folder,{recursive:true});
const host='http://127.0.0.1:4175';
const server=spawn('node',['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4175','--strictPort'],
    {stdio:['ignore','pipe','pipe']});
let output='';
server.stdout.on('data',buf=>{output+=String(buf)});
server.stderr.on('data',buf=>{output+=String(buf)});
const paragraph=text=>'<w:p><w:r><w:t xml:space="preserve">'+text+'</w:t></w:r></w:p>';
const numerator='<m:num><m:e><m:r><m:t>f(x+h)-f(x)</m:t></m:r></m:e></m:num>';
const denominator='<m:den><m:e><m:r><m:t>h</m:t></m:r></m:e></m:den>';
async function wordFixture(valid) {
  const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '+
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'+
    '<w:p><w:r><w:t>Câu 1: [BÀI 1][NB][TL] Đạo hàm: </w:t></w:r>'+
    '<m:oMath><m:f>'+numerator+(valid?denominator:'')+'</m:f></m:oMath></w:p>'+
    paragraph('Đáp án: 1')+'</w:body></w:document>';
  const zip=new JSZip();zip.file('word/document.xml',xml);
  return Buffer.from(await zip.generateAsync({type:'uint8array'}));
}
async function ready(){
  for(let i=0;i<65;i++){
    try{if((await fetch(host)).ok)return;}catch{}
    await sleep(1000);
  }
  throw new Error('Vite not ready: '+output.slice(-1400));
}
const result={startedAt:new Date().toISOString(),checks:[],errors:[]};
const check=(label,passed,detail='')=>{
  result.checks.push({label,passed:Boolean(passed),detail});
  if(!passed)result.errors.push({label,detail});
};
let browser;
try {
  await ready();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',e=>result.errors.push({label:'browser-exception',detail:e.message}));
  await page.goto(host,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.showImportModal==='function' &&
    typeof window.importQuestions==='function',{timeout:30000});
  check('Word import modal available',true);
  async function openAndImport(buffer){
    await page.evaluate(()=>window.showImportModal());
    await page.locator('#import-file').setInputFiles({
      name:'CongThucToan.docx',
      mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer
    });
    await page.evaluate(()=>window.importQuestions());
    await page.locator('#import-preview-container').waitFor({state:'visible',timeout:15000});
    return page.locator('#import-preview-container').innerText();
  }
  const good=await openAndImport(await wordFixture(true));
  const status=await page.locator('#import-total-count').innerText();
  check('Exact imported question count from Word preview',status.includes('1 câu'),status);
  check('Word native equation converted into mathematical renderer',
    await page.locator('#import-preview-container .katex, #import-preview-container mjx-container').count()>0,good.slice(0,700));
  check('No review request for valid editable Equation',!good.includes('cần kiểm tra'),good.slice(0,700));
  await page.locator('#import-preview-container').screenshot({path:folder+'/verified-word-import.png'});
  result.verifiedPreview=status;
  const bad=await openAndImport(await wordFixture(false));
  check('Unsupported/incomplete Word equation explicitly flagged for review',
    bad.includes('cần kiểm tra')||bad.includes('chưa chuyển đổi'),bad.slice(0,800));
  const checked=await page.locator('#import-preview-container input[type="checkbox"]').count();
  check('Manual review control available on blocked equation',checked>0,'checkboxes='+checked);
  await page.locator('#import-preview-container').screenshot({path:folder+'/blocked-word-import.png'});
  // No writes are performed in these browser tests.
  result.blockedPreview=(await page.locator('#import-total-count').innerText());
} finally {
  if(browser)await browser.close();
  server.kill('SIGTERM');
  writeFileSync(folder+'/acceptance.json',JSON.stringify(result,null,2));
}
assert.equal(result.errors.length,0,JSON.stringify(result.errors,null,2));
