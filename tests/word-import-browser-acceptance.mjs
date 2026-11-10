import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';

const folder=process.env.WORD_IMPORT_ARTIFACT_DIR||'artifacts/word-import-visual-qa';
mkdirSync(folder,{recursive:true});
const suppliedBase=process.env.WORD_IMPORT_BASE_URL;
const serveDist=process.env.WORD_IMPORT_SERVE_DIST==='1';
const target=new URL(suppliedBase||'http://127.0.0.1:4175');
assert.ok(['http:','https:'].includes(target.protocol)&&!target.username&&!target.password,'Expected an HTTP(S) URL without credentials');
const host=target.href;
const server=suppliedBase?null:spawn(process.execPath,
    ['node_modules/vite/bin/vite.js',...(serveDist?['preview']:[]),'--host','127.0.0.1','--port','4175','--strictPort'],
    {stdio:['ignore','pipe','pipe']});
let output='';
server?.stdout.on('data',buf=>{output+=String(buf)});
server?.stderr.on('data',buf=>{output+=String(buf)});
let serverError;
server?.on('error',error=>{serverError=error});
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
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  return Buffer.from(await zip.generateAsync({type:'uint8array'}));
}
async function multilineAnswerFixture() {
  const math='<m:oMath><m:f>'+numerator+denominator+'</m:f></m:oMath>';
  const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '+
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'+
    paragraph('Câu 19: [BÀI 1][TH][TL] Chứng minh mệnh đề.')+
    paragraph('Đáp án:')+
    paragraph('- Bước 1: Lập luận trực tiếp.')+
    '<w:p><w:r><w:t>- Công thức: </w:t></w:r>'+math+'</w:p>'+
    paragraph('Câu 20: [BÀI 2][TH][TL] Liệt kê tập hợp.')+
    paragraph('Đáp án:')+
    paragraph('- Liệt kê các phần tử.')+
    paragraph('- Xác định các tập con cần tìm.')+
    paragraph('Câu 21: [BÀI 3][VD][TL] Viết bất phương trình và miền nghiệm.')+
    paragraph('Đáp án:')+
    paragraph('- Viết bất phương trình.')+
    '<w:p><w:r><w:t>- Kiểm tra bằng </w:t></w:r>'+math+'</w:p>'+
    '</w:body></w:document>';
  const zip=new JSZip();zip.file('word/document.xml',xml);
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  return Buffer.from(await zip.generateAsync({type:'uint8array'}));
}
async function ready(){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(serverError)throw serverError;
    if(server&&server.exitCode!==null)throw new Error('Vite stopped before readiness: '+output.slice(-1400));
    try{if((await fetch(host,{signal:AbortSignal.timeout(5000)})).ok)return;}catch{}
    await sleep(250);
  }
  throw new Error('Word import test target not ready: '+host+' '+output.slice(-1400));
}
const result={startedAt:new Date().toISOString(),target:host,
  mode:suppliedBase?'external-read-only':serveDist?'production-build':'development',
  checks:[],errors:[],blockedRequests:[]};
const check=(label,passed,detail='')=>{
  result.checks.push({label,passed:Boolean(passed),detail});
  if(!passed)result.errors.push({label,detail});
};
let browser;
try {
  await ready();
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  // A Preview URL must never turn this UI-only test into a real data write.
  // Apply the same policy locally: block every API request and every non-GET request.
  await context.route('**/*',route=>{
    const request=route.request();
    const url=new URL(request.url());
    if(request.method()!=='GET'||/(^|\/)api(?:\/|$)/i.test(url.pathname)){
      result.blockedRequests.push({method:request.method(),url:url.origin+url.pathname});
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  if(suppliedBase)await context.routeWebSocket('**/*',socket=>socket.close());
  const page=await context.newPage();
  page.on('pageerror',e=>result.errors.push({label:'browser-exception',detail:e.message}));
  await page.goto(host,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.showImportModal==='function' &&
    typeof window.importQuestions==='function',{timeout:30000});
  check('Word import modal available',true);
  async function openAndImport(buffer){
    // A live version gate can replace the modal immediately after DOM ready.
    // Retry only the opening gesture, never the import or any database write.
    let opened=false;
    for(let attempt=0;attempt<3;attempt++){
      await page.evaluate(()=>window.showImportModal());
      opened=await page.locator('#import-file').count()>0;
      if(opened)break;
      await page.waitForLoadState('domcontentloaded');
      await sleep(250);
    }
    if(!opened){
      const state=await page.evaluate(()=>({
        modalCount:document.querySelectorAll('#modal-container').length,
        contentCount:document.querySelectorAll('#modal-content').length,
        modalText:document.querySelector('#modal-content')?.textContent?.slice(0,180)||'',
        ready:document.readyState
      }));
      throw new Error('Word import modal has no file input: '+JSON.stringify(state));
    }
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
  result.blockedPreview=(await page.locator('#import-total-count').innerText());
  await page.locator('#import-preview-container input[type="checkbox"]').first().click();
  check('Checking the review box cannot approve an unresolved Equation',
    !(await page.locator('#import-preview-container input[type="checkbox"]').first().isChecked()));
  const correction=page.locator('#import-preview-container input[id^="word-correction-"]');
  await correction.fill('\\frac{x}');
  await page.getByRole('button',{name:'Kiểm tra & áp dụng',exact:true}).click();
  check('Invalid manual correction stays blocked',
    (await page.locator('#import-total-count').innerText()).includes('1 câu cần kiểm tra')&&await correction.count()===1);
  await correction.fill('\\frac{f(x+h)-f(x)}{h}');
  await page.getByRole('button',{name:'Kiểm tra & áp dụng',exact:true}).click();
  await correction.waitFor({state:'detached',timeout:10000});
  const corrected=await page.locator('#import-preview-container').innerText();
  check('Explicit valid correction renders a native mathematical preview',
    await page.locator('#import-preview-container .katex, #import-preview-container mjx-container').count()>0&&!corrected.includes('__WMATH_'));
  check('Explicit valid correction clears the pending review count',
    (await page.locator('#import-total-count').innerText()).includes('0 câu cần kiểm tra'));
  await page.mouse.move(0,0);
  await page.waitForFunction(()=>!document.querySelector('#toast-container-right .toast, #toast-container-center .toast'),null,{timeout:10000});
  await page.locator('#import-preview-container').screenshot({path:folder+'/corrected-word-import.png'});
  const multiline=await openAndImport(await multilineAnswerFixture());
  const multilineStatus=await page.locator('#import-total-count').innerText();
  check('Multiline TL answers on lines after Đáp án are retained as three questions',
    multilineStatus.includes('3 câu'),multilineStatus+' '+multiline.slice(0,1200));
  check('Multiline TL answers do not produce false missing-answer errors',
    !multiline.includes('thiếu dòng "Đáp án:"'),multiline.slice(0,1200));
  check('Equations inside multiline TL answers stay attached to their questions',
    !multiline.includes('Công thức Word không được gắn vào câu hỏi')&&!multiline.includes('__WMATH_'),
    multiline.slice(0,1200));
  // Deliberately never click LƯU VÀO NGÂN HÀNG. Network guards also block writes.
} catch(error) {
  result.errors.push({label:'browser-acceptance',detail:String(error.stack||error)});
  throw error;
} finally {
  if(browser)await browser.close();
  server?.kill('SIGTERM');
  result.passed=result.checks.filter(item=>item.passed).length;
  result.failed=result.checks.filter(item=>!item.passed).length+result.errors.filter(item=>item.label==='browser-acceptance'||item.label==='browser-exception').length;
  writeFileSync(folder+'/acceptance.json',JSON.stringify(result,null,2));
  console.log('WORD_IMPORT_BROWSER_ACCEPTANCE '+JSON.stringify({mode:result.mode,passed:result.passed,failed:result.failed,blockedRequests:result.blockedRequests.length}));
}
assert.equal(result.errors.length,0,JSON.stringify(result.errors,null,2));

