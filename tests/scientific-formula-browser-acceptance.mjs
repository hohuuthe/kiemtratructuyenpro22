import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const root = 'artifacts/formula-visual-qa';
mkdirSync(root, { recursive: true });
// Some local test runners use an HTTPS inspection proxy whose CA is not in
// Chromium's trust store. Keep TLS verification enabled unless explicitly set.
const ignoreHTTPSErrors = process.env.SCIENTIFIC_IGNORE_HTTPS_ERRORS === '1';
const report = { timestamp: new Date().toISOString(), ignoreHTTPSErrors, checks: [], errors: [], files: [] };
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
  const page = await browser.newPage({ viewport: {width: 1365,height: 850}, deviceScaleFactor: 1, ignoreHTTPSErrors });
  page.on('pageerror', e => report.errors.push({ label:'pageerror', detail: e.message }));
  await page.goto(url, {waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(() => typeof window.renderScientificContent === 'function' && typeof window.queueMathJax === 'function', null, { timeout: 40000 });
  await page.waitForFunction(() => typeof window.MathJax?.typesetPromise === 'function', null, { timeout: 30000 });
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
  await page.waitForFunction(expectedCount =>
    document.querySelectorAll('#formula-visual-qa .scientific-qa-row').length === expectedCount &&
    document.querySelectorAll('#formula-visual-qa .scientific-mathjax-pending').length === 0,
  examples.length, {timeout:30000});
  await sleep(300);
  const measured=await page.evaluate(() => [...document.querySelectorAll('.scientific-qa-row')].map(el=>({
    id:el.dataset.formulaId,
    hasMath:!!el.querySelector('.katex, mjx-container[jax="CHTML"]'),
    pending:el.querySelectorAll('.scientific-mathjax-pending').length,
    unresolved:el.querySelectorAll('.scientific-math-unresolved, merror, .mjx-merror').length,
    source:el.querySelector('.scientific-qa-formula')?.textContent?.slice(0,100),
    nestedScrollbars:[...el.querySelectorAll('mjx-container:not([display])')].filter(n=>getComputedStyle(n).overflowX==='auto').length
  })));
  assert.equal(measured.length, examples.length, 'The full formula fixture must still exist after rendering');
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
  // The application can perform an initialization navigation while opening its editor.
  // Retry the browser export acceptance only for navigation-destroyed contexts;
  // actual document generation failures are still asserted below.
  let files;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      files = await page.evaluate(async () => {
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
      break;
    } catch (error) {
      if (!/Execution context was destroyed|most likely because of a navigation/i.test(String(error)) || attempt === 2) throw error;
      await page.waitForLoadState('domcontentloaded', {timeout: 30000});
      await page.waitForFunction(() => typeof window.renderScientificContent === 'function', null, {timeout: 30000});
    }
  }
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
  // Inspect the ACTUAL downloaded browser DOCX, rather than trusting size.
  // Office Math elements are editable in Word; literal \ce remains a failure.
  const browserDocxZip=await JSZip.loadAsync(readFileSync(root+'/sample.docx'));
  const browserWordXml=await browserDocxZip.file('word/document.xml').async('string');
  check('Actual downloaded DOCX contains native Office Math',
    browserWordXml.includes('<m:oMath') && browserWordXml.includes('<m:sSub>') &&
    browserWordXml.includes('<m:sSup>') && !browserWordXml.includes('\\ce{'),
    'Office Math=' + (browserWordXml.match(/<m:oMath\b/g)||[]).length +
    ' subs=' + (browserWordXml.match(/<m:sSub>/g)||[]).length +
    ' supers=' + (browserWordXml.match(/<m:sSup>/g)||[]).length +
    ' raw mhchem=' + browserWordXml.includes('\\ce{'));
  // Review dialog: exercise its exact shared read-only renderer in real Chromium.
  await page.evaluate(async () => {
    const {renderExamDetailQuestion,renderExamDetailOptions} = await import('/src/exam-detail-formula-renderer.js');
    const samples = [
      {type:'4-1',content:'Tính $\\frac{\\sqrt{x}}{2}$',options:{
        A:{text:'$\\frac{1}{2}$'},B:{text:'$\\pi$'},
        C:{text:'$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$'},D:{text:'$E=mc^2$'}},userAnswer:'B',correctAnswer:'A'},
      {type:'TF4',content:'$\\ce{2H2 + O2 -> 2H2O}$',options:{
        A:{text:'$\\ce{SO4^{2-}}$'},B:{text:'$\\ce{NH4+}$'},
        C:{text:'$p^2+2pq+q^2=1$'},D:{text:'$\\forall x\\in\\mathbb{R}$'}},userAnswer:{A:true,B:false},correctAnswer:'A&C'},
      {type:'SQ',content:'$\\int_0^1 x^2\\,dx$',userAnswer:'$\\frac{1}{3}$'},
      {type:'TL',content:'$\\begin{cases}x+y=3\\\\x-y=1\\end{cases}$',userAnswer:'$x=2$'}
    ];
    const section=document.createElement('section');section.id='exam-detail-visual-qa';
    section.style.cssText='position:relative;z-index:2147483000;width:min(94%,1000px);margin:20px auto;padding:18px;background:white;color:#111827;border-radius:12px';
    section.innerHTML='<h2 style="font-size:22px;font-weight:bold">Chi tiết bài thi (kiểm thử)</h2>'+
      samples.map((q,i)=>'<article class="detail-qa-row" style="border:1px solid #ddd;padding:12px;margin:8px 0;">'+
        renderExamDetailQuestion(q,i)+renderExamDetailOptions(q,q.userAnswer,q.correctAnswer)+
        (typeof q.userAnswer==='string'?'<div class="exam-detail-answer">'+window.formatContent(q.userAnswer)+'</div>':'')+'</article>').join('');
    document.body.append(section);window.queueMathJax(section);
  });
  await page.waitForFunction(() => !!document.getElementById('exam-detail-visual-qa') &&
    document.querySelectorAll('#exam-detail-visual-qa .scientific-mathjax-pending').length===0);
  const review=await page.evaluate(()=>{
    const el=document.getElementById('exam-detail-visual-qa');
    return {questions:el.querySelectorAll('.exam-detail-question').length,
      options:el.querySelectorAll('.exam-detail-option').length,
      math:el.querySelectorAll('.katex,mjx-container[jax="CHTML"]').length,
      unresolved:el.querySelectorAll('.scientific-math-unresolved,merror,.mjx-merror').length,
      types:[...el.querySelectorAll('.detail-qa-row')].every(row=>!!row.querySelector('.katex,mjx-container[jax="CHTML"]'))};
  });
  check('Exam detail has four question types',review.questions===4,JSON.stringify(review));
  check('Exam detail renders all eight A-D choices',review.options===8,JSON.stringify(review));
  check('Exam detail uses rendered math in questions and options',review.types && review.math>=12,JSON.stringify(review));
  check('Exam detail has no unresolved math',review.unresolved===0,JSON.stringify(review));
  await page.locator('#exam-detail-visual-qa').screenshot({path:root+'/detail-desktop.png'});
  report.files.push('detail-desktop.png');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#exam-detail-visual-qa').screenshot({path:root+'/detail-mobile.png'});
  report.files.push('detail-mobile.png');
  const widths=await page.evaluate(()=>{
    const el=document.getElementById('exam-detail-visual-qa');
    return {client:el.clientWidth,scroll:el.scrollWidth};
  });
  check('Exam detail fits mobile viewport',widths.scroll<=widths.client+4,JSON.stringify(widths));
  await page.setViewportSize({width:1365,height:850});

  // Real Chi tiết bài thi modal, not an isolated HTML fragment.
  const realDetailFixture = await page.evaluate(async () => {
    if (typeof window.__openExamDetailScientificFixture !== 'function')
      throw new Error('DEV-only modal fixture not available');
    const cases = [
      {question:JSON.stringify({id:1,type:'4-1',
        content:JSON.stringify({text:'Tính $\\frac{\\sqrt{x}}{2}$ và $E=mc^2$'}),
        options:JSON.stringify({A:{text:'$\\frac{1}{2}$'},B:{text:'$\\ce{H2O}$'},
          C:{text:'$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$'},D:{text:'$\\pi$'}}),
        answer:'A'}),userAnswer:'B',correctAnswer:'A',score:0,isCorrect:false},
      {question:{id:2,type:'tf4',content:{text:'$\\ce{2H2 + O2 -> 2H2O}$ và $\\ce{SO4^{2-}}$'},
        options:{A:{text:'$\\ce{NH4+}$'},B:{text:'$\\forall x\\in\\mathbb{R}$'},
          C:{text:'$p^2+2pq+q^2=1$'},D:{text:'$\\sqrt{a^2+b^2}$'}},answer:'A&C'},
        userAnswer:'{"A":true,"C":false}',correctAnswer:'A&C',score:0.5,isCorrect:false},
      {question:{id:3,type:'SQ',content:'$\\int_0^1 x^2\\,dx$ và $\\sum_{i=1}^{n}i$'},
        userAnswer:'$\\frac{1}{3}$',correctAnswer:'$\\frac{1}{3}$',score:1,isCorrect:true},
      {question:{id:4,type:'TL',content:'$\\begin{cases}x+y=3\\\\x-y=1\\end{cases}$'},
        userAnswer:{text:'$x=2$',image:''},correctAnswer:'$x=2,\\;y=1$',score:0,isCorrect:false}
    ];
    return window.__openExamDetailScientificFixture(JSON.stringify(cases));
  });
  check('Real modal leaves persisted result details unchanged',
    realDetailFixture?.detailsUntouched===true,JSON.stringify(realDetailFixture));
  await page.locator('#modal-content .exam-detail-review').waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(() => !!document.querySelector('#modal-content .exam-detail-review') &&
    !document.querySelector('#modal-content .exam-detail-review .scientific-mathjax-pending'),null,{timeout:30000});
  const actualExamDetail = await page.evaluate(() => {
    const root=document.querySelector('#modal-content .exam-detail-review');
    const questions=[...root.querySelectorAll('.exam-detail-question')];
    const options=[...root.querySelectorAll('.exam-detail-option')];
    const baseline=document.createElement('div');baseline.className='responsive-q-text';
    baseline.style.setProperty('--base-q-size',questions[0].style.getPropertyValue('--base-q-size'));
    document.body.append(baseline);
    const expectedFont=getComputedStyle(baseline).fontSize;baseline.remove();
    return {questions:questions.length,options:options.length,
      math:root.querySelectorAll('.katex,mjx-container[jax="CHTML"]').length,
      chemical:root.querySelectorAll('mjx-container[jax="CHTML"]').length,
      unresolved:root.querySelectorAll('.scientific-math-unresolved,merror,.mjx-merror').length,
      legacyJson:questions.some(q=>q.textContent.includes('"text"')),
      matchingFont:getComputedStyle(questions[0]).fontSize===expectedFont};
  });
  check('Actual Chi tiết bài thi shows four questions and eight options',
    actualExamDetail.questions===4 && actualExamDetail.options===8,JSON.stringify(actualExamDetail));
  check('Actual Chi tiết bài thi formulas render without errors',
    actualExamDetail.math>=12 && actualExamDetail.chemical>0 &&
    actualExamDetail.unresolved===0 && !actualExamDetail.legacyJson,
    JSON.stringify(actualExamDetail));
  check('Actual modal matches the student question font',actualExamDetail.matchingFont);
  await page.locator('#modal-content').screenshot({path:root+'/real-exam-detail-desktop.png'});
  report.files.push('real-exam-detail-desktop.png');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#modal-content').screenshot({path:root+'/real-exam-detail-mobile.png'});
  report.files.push('real-exam-detail-mobile.png');
  const realMobile = await page.evaluate(()=>{
    const el=document.querySelector('#modal-content .exam-detail-review');
    return {width:el.clientWidth,scrollWidth:el.scrollWidth,
      clipped:[...el.querySelectorAll('.exam-detail-question')].filter(x=>x.scrollWidth>x.clientWidth+5).length};
  });
  check('Actual Chi tiết bài thi fits the mobile viewport',
    realMobile.scrollWidth<=realMobile.width+5 && !realMobile.clipped,JSON.stringify(realMobile));
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

