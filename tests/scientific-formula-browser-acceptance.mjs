import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const root = 'artifacts/formula-visual-qa';
mkdirSync(root, { recursive: true });
const report = { timestamp: new Date().toISOString(), checks: [], errors: [], files: [] };
const check = (label, condition, detail = '') => {
  report.checks.push({ label, passed: Boolean(condition), detail });
  if (!condition) report.errors.push({ label, detail });
};
const examples = [
  ['Toán – phân số lồng nhau', '$\\frac{\\frac{a}{b}}{\\frac{c}{d}}$'],
  ['Toán – phương trình bậc hai', '$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$'],
  ['Toán – ma trận', '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}'],
  ['Toán – tích phân', '$\\int_0^1 x^2\\,dx$'],
  ['Vật lý – tương đối', '$\\gamma=\\frac{1}{\\sqrt{1-v^2/c^2}}$'],
  ['Vật lý – Planck', '$E=\\frac{hc}{\\lambda}$'],
  ['Hóa học – nước', '\\ce{H2O}'],
  ['Hóa học – sulfát', '\\ce{SO4^{2-}}'],
  ['Hóa học – phản ứng', '\\ce{2H2 + O2 -> 2H2O}'],
  ['Hóa học – đồng vị', '\\ce{^{235}_{92}U}'],
  ['Sinh học – Hardy–Weinberg', '$p^2+2pq+q^2=1$'],
  ['Tin học – độ phức tạp', '$T(n)=O(n\\log n)$'],
  ['Thống kê – xác suất', '$P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}$'],
  ['Toán – logic', '$\\forall x\\in\\mathbb{R},\\;x^2\\geq 0$'],
  ['Toán – dòng hỗn hợp', 'Khi $x>0$, ta có $\\sqrt{x^2}=x$.']
];
const url = 'http://127.0.0.1:4173';
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: ['ignore','pipe','pipe'] });
let serverOutput = '';
vite.stdout.on('data', b => { serverOutput += String(b); });
vite.stderr.on('data', b => { serverOutput += String(b); });
async function ready() {
  for (let i=0;i<90;i++) {
    try { const r=await fetch(url); if (r.ok) return; } catch {}
    await sleep(1000);
  }
  throw new Error('Vite development server failed: ' + serverOutput.slice(-1000));
}
let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: {width: 1365,height: 850}, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push({ label:'pageerror', detail: e.message }));
  await page.goto(url, {waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(() => typeof window.renderScientificContent === 'function' && typeof window.queueMathJax === 'function', { timeout: 40000 });
  check('Student renderer initialized',true);
  // Use the actual built-in renderer and fallback on controlled, synthetic data.
  await page.evaluate((items) => {
    const existing=document.getElementById('formula-visual-qa'); if(existing)existing.remove();
    const root=document.createElement('section');
    root.id='formula-visual-qa';
    root.className='responsive-q-text';
    root.style.cssText='position:relative;z-index:2147483000;margin:20px auto;padding:24px;width:min(96%,1080px);background:white;color:#111827;font:18px/1.65 Arial,sans-serif;border-radius:14px;box-shadow:0 1px 8px #cbd5e1';
    root.innerHTML='<h1 style="font-weight:bold;font-size:24px">Nghiệm thu hiển thị công thức (dữ liệu mẫu)</h1>';
    for (let i=0;i<items.length;i++) {
      const row=document.createElement('div');
      row.className='scientific-qa-row';
      row.style.cssText='padding:10px 3px;border-bottom:1px solid #e2e8f0';
      row.dataset.formulaId=String(i+1);
      const caption=document.createElement('div');caption.style.cssText='font-size:12px;color:#64748b';caption.textContent=(i+1)+'. '+items[i][0];
      const expression=document.createElement('div');expression.className='scientific-qa-formula';expression.innerHTML=window.renderScientificContent(items[i][1]);
      row.append(caption,expression);root.append(row);
    }
    document.body.append(root);
    window.queueMathJax(root);
  },examples);
  await page.waitForFunction(() => document.querySelectorAll('#formula-visual-qa .scientific-mathjax-pending').length === 0, {timeout:30000});
  await sleep(300);
  const measured=await page.evaluate(() => [...document.querySelectorAll('.scientific-qa-row')].map(el=>({
    id:el.dataset.formulaId,
    hasMath:!!el.querySelector('.katex, mjx-container[jax="CHTML"]'),
    pending:el.querySelectorAll('.scientific-mathjax-pending').length,
    unresolved:el.querySelectorAll('.scientific-math-unresolved, merror, .mjx-merror').length,
    source:el.querySelector('.scientific-qa-formula')?.textContent?.slice(0,100),
    nestedScrollbars:[...el.querySelectorAll('mjx-container:not([display])')].filter(n=>getComputedStyle(n).overflowX==='auto').length
  })));
  report.measured=measured;
  for(const x of measured) check('Formula '+x.id+' correctly rendered',x.hasMath && !x.pending && !x.unresolved,JSON.stringify(x));
  check('Inline MathJax has no unnecessary scrollbars',measured.every(x=>!x.nestedScrollbars));
  await page.locator('#formula-visual-qa').screenshot({path:root+'/desktop.png'});
  report.files.push('desktop.png');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#formula-visual-qa').screenshot({path:root+'/mobile.png'});
  report.files.push('mobile.png');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+5);
  check('Mobile formula view fits viewport',!overflow,'document scrollWidth should fit mobile width');
  await page.setViewportSize({width:1365,height:850});
  if(await page.evaluate(()=>typeof window.showAddQuestionModal==='function')){
    await page.evaluate(()=>window.showAddQuestionModal());
    await page.locator('#new-q-content').waitFor({state:'visible',timeout:10000});
    const textarea=page.locator('#new-q-content');
    await textarea.fill('Cho $x^2+y^2=z^2$, hãy tính x.');
    await sleep(600);
    const preview=await page.locator('#new-q-content + .scientific-editor-preview .katex').count();
    const other=await page.locator('#modal-content .scientific-editor-preview').count();
    check('Authoring form live math preview',preview>0,'katex='+preview+' previews='+other);
    check('Authoring input remains unchanged',await textarea.inputValue()==='Cho $x^2+y^2=z^2$, hãy tính x.');
    await page.locator('#modal-content').screenshot({path:root+'/authoring.png'});
    report.files.push('authoring.png');
    if(await page.locator('#new-q-type').count()){
      await page.locator('#new-q-type').selectOption('4-1');
      await sleep(250);
      check('Options A-D have authoring previews',await page.locator('#modal-content .scientific-editor-preview').count()>=6);
    }
  }else check('Authoring form availability',false,'window.showAddQuestionModal unavailable');

  // Exercise real in-browser DOCX/PDF/XLSX generators with fake exam data.
  const files = await page.evaluate(async () => {
    const header={soGiaoDuc:'KIEM THU NOI BO',truongHoc:'DE MO PHONG',deThiTitle:'DE NGHIEM THU CONG THUC',namHoc:'2026',monHoc:'Da mon',thoiGian:15,maDe:'9001'};
    const questions=[
      {id:1,type:'4-1',content:'Tính $\\frac{\\sqrt{x}}{2}$',answer:'A',options:{A:{text:'$\\frac{1}{2}$'},B:{text:'$x^2$'},C:{text:'$\\sqrt{2}$'},D:{text:'$\\pi$'}}},
      {id:2,type:'TF4',content:'Chất $\\ce{H2SO4}$ có chứa nguyên tố H và S.',answer:'AB',options:{A:{text:'$\\ce{H2O}$'},B:{text:'$\\ce{CO2}$'},C:{text:'$\\ce{SO4^{2-}}$'},D:{text:'$\\ce{NH4+}$'}}},
      {id:3,type:'SQ',content:'Tính $E=mc^2$',answer:'$E=mc^2$'},
      {id:4,type:'TL',content:'Giải hệ $\\begin{cases}x+y=3\\\\x-y=1\\end{cases}$',answer:'$x=2,y=1$'}
    ];
    const [word,pdf,excel]=await Promise.all([import('/src/exam-docx-generator.ts'),import('/src/exam-pdf-generator.ts'),import('/src/exam-excel-generator.ts')]);
    const produced=[];
    window.__qaExports = {};
    for(const [name,fn] of [
      ['docx',()=>word.generateExamDocx(header,questions)],
      ['xlsx',()=>excel.generateExamAnswerExcel(header,[{maDe:'9001',questions}])],
      ['pdf',()=>pdf.generateExamPdfBlob(header,questions)]
    ]){
      try{
        const value=await fn();
        const mime=name==='pdf'?'application/pdf':name==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const blob=value instanceof Blob ? value : new Blob([value],{type:mime});
        window.__qaExports[name]=blob;
        produced.push({name,size:blob.size});
      }catch(err){produced.push({name,error:String(err?.stack||err)})}
    }
    return produced;
  });
  for(const item of files){
    check('Actual browser export '+item.name,!item.error && item.size>500,'size='+item.size+' '+(item.error||''));
    if(!item.error){
      const pending=page.waitForEvent('download',{timeout:30000});
      await page.evaluate(name=>{
        const link=document.createElement('a');
        link.href=URL.createObjectURL(window.__qaExports[name]);
        link.download='sample.'+name;
        document.body.appendChild(link);
        link.click();
        link.remove();
      },item.name);
      const download=await pending;
      await download.saveAs(root+'/sample.'+item.name);
      report.files.push('sample.'+item.name);
    }
  }
  // Real browser parity: read-only "Chi tiết bài thi" must render exactly as
  // the student question view, including all four options and MathJax fallback.
  await page.evaluate(async () => {
    const { renderExamDetailQuestion, renderExamDetailOptions } =
      await import('/src/exam-detail-formula-renderer.js');
    const examples = [
      {type:'4-1',content:'Tính $\\frac{\\sqrt{x}}{2}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
,options:{
        A:{text:'$\\frac{1}{2}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
},B:{text:'$\\pi
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
},C:{text:'$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
},D:{text:'$E=mc^2
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
}
      },userAnswer:'B',correctAnswer:'A'},
      {type:'TF4',content:'Xét phản ứng $\\ce{2H2 + O2 -> 2H2O}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
,options:{
        A:{text:'Ion $\\ce{SO4^{2-}}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
},B:{text:'Ion $\\ce{NH4+}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
},
        C:{text:'$p^2+2pq+q^2=1
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
},D:{text:'$\\forall x\\in\\mathbb{R}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
}
      },userAnswer:{A:true,B:false},correctAnswer:'A&C'},
      {type:'SQ',content:'Tính $\\int_0^1 x^2\\,dx
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
,userAnswer:'$\\frac{1}{3}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
,correctAnswer:'$\\frac{1}{3}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
},
      {type:'TL',content:'Giải hệ $\\begin{cases}x+y=3\\\\x-y=1\\end{cases}
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
,
        userAnswer:'$x=2
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
,correctAnswer:'$x=2
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
}
    ];
    const old=document.getElementById('exam-detail-visual-qa');if(old)old.remove();
    const el=document.createElement('section');
    el.id='exam-detail-visual-qa';
    el.style.cssText='position:relative;z-index:2147483000;width:min(94%,1040px);margin:20px auto;padding:24px;background:white;color:#111827;border-radius:12px;';
    el.innerHTML='<h2 style="font-size:22px;font-weight:700;margin-bottom:16px;">Chi tiết bài thi — kiểm thử công thức</h2>'+
      examples.map((q,i)=>'<article class="detail-qa-row" data-qa-type="'+q.type+'" style="margin-bottom:16px;padding:12px;border:1px solid #cbd5e1;border-radius:10px;">'+
        renderExamDetailQuestion(q,i,24)+
        renderExamDetailOptions(q,q.userAnswer,q.correctAnswer,20)+
        '<div class="exam-detail-answer">'+window.formatContent(q.userAnswer && typeof q.userAnswer==='string'?q.userAnswer:'')+'</div>'+
      '</article>').join('');
    document.body.append(el);
    window.queueMathJax(el);
  });
  await page.waitForFunction(() =>
    document.getElementById('exam-detail-visual-qa') &&
    !document.querySelector('#exam-detail-visual-qa .scientific-mathjax-pending'),{timeout:30000});
  const detailQA=await page.evaluate(()=>{
    const root=document.getElementById('exam-detail-visual-qa');
    return {questions:root.querySelectorAll('.exam-detail-question').length,
      options:root.querySelectorAll('.exam-detail-option').length,
      math:root.querySelectorAll('.katex, mjx-container[jax="CHTML"]').length,
      errors:root.querySelectorAll('.scientific-math-unresolved,merror,.mjx-merror').length,
      types:[...root.querySelectorAll('.detail-qa-row')].map(row=>({
        type:row.dataset.qaType, hasMath:!!row.querySelector('.katex,mjx-container[jax="CHTML"]')
      }))};
  });
  check('Exam detail has all 4 question types',detailQA.questions===4 && detailQA.types.length===4,JSON.stringify(detailQA));
  check('Exam detail renders 8 answer options',detailQA.options===8,JSON.stringify(detailQA));
  check('Exam detail renders math in each question and answer',detailQA.math>=12 && detailQA.types.every(x=>x.hasMath),JSON.stringify(detailQA));
  check('Exam detail has no unresolved math',detailQA.errors===0,JSON.stringify(detailQA));
  await page.locator('#exam-detail-visual-qa').screenshot({path:root+'/detail-desktop.png'});
  report.files.push('detail-desktop.png');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#exam-detail-visual-qa').screenshot({path:root+'/detail-mobile.png'});
  report.files.push('detail-mobile.png');
  const detailMobile=await page.evaluate(()=>{
    const el=document.getElementById('exam-detail-visual-qa');
    return {contentWidth:el.clientWidth,scrollWidth:el.scrollWidth,
      viewportWidth:innerWidth,docWidth:document.documentElement.scrollWidth};
  });
  check('Exam detail fits mobile viewport',detailMobile.scrollWidth<=detailMobile.contentWidth+4,JSON.stringify(detailMobile));
  await page.setViewportSize({width:1365,height:850});
  await page.close();
}catch(error){
  report.errors.push({label:'Browser acceptance failed',detail:String(error.stack||error)});
}finally{
  if(browser)await browser.close();
  vite.kill('SIGTERM');
  report.passed=report.checks.filter(x=>x.passed).length;
  report.failed=report.checks.filter(x=>!x.passed).length+report.errors.filter(x=>x.label==='Browser acceptance failed'||x.label==='pageerror').length;
  writeFileSync(root+'/results.json',JSON.stringify(report,null,2));
  console.log('SCIENTIFIC_VISUAL_ACCEPTANCE '+JSON.stringify({passed:report.passed,failed:report.failed,files:report.files,errors:report.errors.slice(0,10),measured:report.measured}));
  if(report.failed || report.errors.length)process.exitCode=1;
}
