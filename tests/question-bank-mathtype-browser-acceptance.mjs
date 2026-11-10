/**
 * Actual browser/MathJax/html2canvas/Question Bank export acceptance.
 * Synthetic questions only; no API, database, account or production changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import JSZip from 'jszip';

test('Question Bank MathType exports a nonblank real browser preview and editable native OLE', {timeout:150000}, async()=>{
  const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4188','--strictPort'],{stdio:['ignore','pipe','pipe']});
  let output='',browser;
  vite.stdout.on('data',chunk=>{output+=String(chunk);});
  vite.stderr.on('data',chunk=>{output+=String(chunk);});
  try {
    let ready=false;
    for(let i=0;i<60;i++){
      try {const res=await fetch('http://127.0.0.1:4188/');if(res.ok){ready=true;break;}} catch {}
      await sleep(400);
    }
    assert.ok(ready,'Vite did not start: '+output.slice(-1400));
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1280,height:850}});
    await page.goto('http://127.0.0.1:4188/',{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForFunction(()=>typeof window.MathJax?.typesetPromise==='function',null,{timeout:40000});
    const result=await page.evaluate(async()=>{
      const [{generateQuestionBankDocx},{finalizeWordExport}]=await Promise.all([
        import('/src/question-bank-docx-generator.ts'),import('/src/word-export-format.js')
      ]);
      const questions=[
        {id:'qa-1',creatorId:'test',lesson:'Test',level:'NB',type:'4-1',
          content:'Tính $\\frac{a}{b}$',options:{A:'$\\sqrt{2}$',B:'$x^2$',C:'3',D:'4'},answer:'A'},
        {id:'qa-2',creatorId:'test',lesson:'Test',level:'TH',type:'TF4',
          content:'Hóa học $\\ce{H2O}$',options:{A:'$\\ce{SO4^{2-}}$',B:'x',C:'y',D:'z'},answer:'A&C'},
        {id:'qa-3',creatorId:'test',lesson:'Test',level:'VD',type:'TL',
          content:'Tính $\\int_0^1 x^2\\,dx$',answer:'$\\frac{1}{3}$'}
      ];
      const plan={questions,ids:questions.map(q=>q.id),totalSelected:3,requestedCount:3,selectedLessons:1};
      const warnings=[];
      const source=await generateQuestionBankDocx(plan,{onFormulaWarning:w=>warnings.push(w)});
      if(warnings.length)throw new Error('Unsupported source math: '+JSON.stringify(warnings));
      const output=await finalizeWordExport(source,{equationFormat:'mathtype',
        hostname:location.hostname,
        previewTimeoutMs:15000,previewBatchTimeoutMs:90000});
      if(!(output instanceof Blob)||output.size<1000)throw new Error('Invalid browser output Blob');
      const bytes=new Uint8Array(await output.arrayBuffer());
      const result=[];
      for(let i=0;i<bytes.length;i+=32768)result.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
      return {sourceSize:source.size,finalSize:output.size,base64:btoa(result.join(''))};
    });
    const buffer=Buffer.from(result.base64,'base64');
    assert.equal(buffer.length,result.finalSize);
    const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
    const xml=await zip.file('word/document.xml').async('string');
    const native=(xml.match(/<o:OLEObject\b/g)||[]).length;
    assert.ok(native>=6,'Expected actual native MathType objects in question bank');
    assert.equal((xml.match(/<m:oMath\b/g)||[]).length,0,'Unconverted Equation in MathType mode');
    for(const label of ['Tính','Hóa học','Đáp án:'])assert.ok(xml.includes(label),'Missing text: '+label);
    const imageFiles=Object.keys(zip.files).filter(name=>/^word\/media\/kttt-mathtype-\d+\.png$/.test(name));
    assert.equal(imageFiles.length,native,'Missing formula previews');
    for(const name of imageFiles) {
      const bytes=await zip.file(name).async('uint8array');
      assert.ok(bytes.length>100,'MathType browser preview is suspiciously empty: '+name);
    }
  } finally {
    if(browser)await browser.close();
    vite.kill('SIGTERM');
  }
});
