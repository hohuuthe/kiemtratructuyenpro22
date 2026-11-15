import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync} from 'node:fs';

const branch = String(process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || '');
assert.ok(branch && branch !== 'main','Responsive smoke must use the isolated feature Preview');
const origin = process.env.CONTEST_PREVIEW_URL ||
  'https://feature-contest-mode-secure.kiemtratructuyenpro.pages.dev';
const sizes = [
  {name:'phone-360',width:360,height:800,mobile:true},
  {name:'phone-390',width:390,height:844,mobile:true},
  {name:'tablet-768',width:768,height:1024,mobile:true},
  {name:'desktop-1366',width:1366,height:768,mobile:false},
  {name:'fullhd-1920',width:1920,height:1080,mobile:false}
];
mkdirSync('test-artifacts/contest-responsive',{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  for(const item of sizes){
    const context=await browser.newContext({
      viewport:{width:item.width,height:item.height},
      isMobile:item.mobile,
      hasTouch:item.mobile,
      deviceScaleFactor:item.mobile?2:1
    });
    const page=await context.newPage();
    const browserErrors=[];
    page.on('pageerror',err=>browserErrors.push(String(err.message||err)));
    try {
      const response=await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
      assert.ok(response?.ok(),item.name+' Preview page is not HTTP 200');
      const registration=page.locator('#contest-registration');
      await registration.waitFor({state:'attached',timeout:25000});
      await page.evaluate(()=>{
        document.querySelector('#contest-registration')?.classList.remove('hidden');
        const school=document.querySelector('#exam-form');
        if(school)school.style.setProperty('display','none','important');
      });
      await registration.scrollIntoViewIfNeeded();
      const layout=await page.evaluate(()=>{
        const box=document.querySelector('#contest-registration')?.getBoundingClientRect();
        const elements=[...document.querySelectorAll('#contest-registration input,#contest-registration select,#contest-registration button')];
        const overflow=elements.map(el=>{
          const r=el.getBoundingClientRect();
          return {name:el.id||el.getAttribute('name')||el.tagName,
            left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)};
        }).filter(x=>x.left < -2 || x.right > window.innerWidth+2 || x.width<=0);
        return {
          viewport:window.innerWidth,
          sectionLeft:box?.left,sectionRight:box?.right,
          sectionWidth:box?.width,
          contentWidth:document.documentElement.scrollWidth,
          controls:elements.length,
          overflow
        };
      });
      assert.ok(layout.controls>=7,item.name+' missing form controls');
      assert.ok(layout.sectionLeft>=-2&&layout.sectionRight<=layout.viewport+2,item.name+' section overflow '+JSON.stringify(layout));
      assert.deepEqual(layout.overflow,[],item.name+' controls overflow');
      const file='test-artifacts/contest-responsive/'+item.name+'.png';
      await registration.screenshot({path:file,animations:'disabled'});
      console.log('PASS',item.name,JSON.stringify(layout),'pageErrors',browserErrors.length);
      if(browserErrors.length)console.warn('Non-fatal page errors',browserErrors.slice(0,5));
    }finally{await context.close()}
  }
}finally{await browser.close()}
