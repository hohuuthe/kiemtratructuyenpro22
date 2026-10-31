/**
 * Preview-only MathType renderer.
 * Uses the application's already-loaded MathJax CHTML runtime.
 * Loaded only after the user explicitly chooses MathType.
 *
 * Performance rules:
 * - render ONE tiny formula host at a time
 * - yield before/after each heavy phase
 * - use lower raster scale on phones
 * - never capture the application page, only the MathJax container
 */
import html2canvas from 'html2canvas-pro';
import {astToMathml} from './omml-ast.js';
import {fail,aborted} from './errors.js';

const pxToPt = px => px * 72 / 96;
const nextPaint=()=>new Promise(resolve=>{
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>resolve());
  else setTimeout(resolve,0);
});
async function cooperativeYield(signal){
  aborted(signal);
  if(globalThis.scheduler?.yield)await globalThis.scheduler.yield();
  else{await nextPaint();await new Promise(resolve=>setTimeout(resolve,0));}
  aborted(signal);
}
async function waitForMathJax(){
  const started=Date.now();
  while(Date.now()-started<12000){
    const mj=globalThis.MathJax;
    if(mj?.typesetPromise){
      if(mj.startup?.promise)await mj.startup.promise;
      return mj;
    }
    await new Promise(resolve=>setTimeout(resolve,60));
  }
  fail('PREVIEW_FAILED','MathJax chưa sẵn sàng để tạo ảnh xem trước MathType.');
}
function rasterScale(){
  const narrow=typeof window!=='undefined'&&window.innerWidth<900;
  const mem=Number(globalThis.navigator?.deviceMemory||0);
  if(narrow||mem&&mem<=4)return 1.5;
  return 2;
}

export function createBrowserMathTypePreviewRenderer(){
  return async function renderMathTypePreview(ast,{fontSizePt=13,signal}={}){
    aborted(signal);
    if(typeof document==='undefined'||typeof window==='undefined')
      fail('PREVIEW_FAILED','MathType Preview chỉ chạy trong trình duyệt.');

    await cooperativeYield(signal);
    const mathJax=await waitForMathJax();
    const size=Number(fontSizePt||13);
    if(!Number.isFinite(size)||size<6||size>96)
      fail('INVALID_SIZE','Cỡ chữ công thức MathType không hợp lệ.');

    const host=document.createElement('div');
    host.setAttribute('data-kttt-mathtype-preview','true');
    host.className='tex2jax_process';
    host.style.cssText=[
      'position:fixed','left:-20000px','top:0','z-index:-1',
      'display:inline-block','width:auto','height:auto',
      'white-space:nowrap','background:transparent','color:#000',
      'font-size:'+size+'pt','line-height:1.2','padding:0','margin:0',
      'pointer-events:none','contain:layout style paint'
    ].join(';');
    host.innerHTML=astToMathml(ast,false);
    const baseline=document.createElement('span');
    baseline.setAttribute('aria-hidden','true');
    baseline.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline;';
    host.appendChild(baseline);
    document.body.appendChild(host);

    try{
      await mathJax.typesetPromise([host]);
      aborted(signal);
      await cooperativeYield(signal);

      const math=host.querySelector('mjx-container');
      if(!math)fail('PREVIEW_FAILED','MathJax CHTML không tạo được công thức xem trước.');

      const rect=math.getBoundingClientRect();
      const baseRect=baseline.getBoundingClientRect();
      if(!rect.width||!rect.height||rect.width>5000||rect.height>5000)
        fail('PREVIEW_FAILED','Kích thước công thức xem trước không hợp lệ.');

      const scale=rasterScale();
      const canvas=await html2canvas(math,{
        backgroundColor:null,
        scale,
        logging:false,
        useCORS:false,
        allowTaint:false,
        removeContainer:true,
        imageTimeout:4000,
        foreignObjectRendering:false,
        width:Math.ceil(rect.width),
        height:Math.ceil(rect.height)
      });
      aborted(signal);
      await cooperativeYield(signal);

      if(canvas.width*canvas.height>8_000_000||canvas.width>8192||canvas.height>8192)
        fail('RESOURCE_LIMIT','Equation preview pixel limit exceeded.');

      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)fail('PREVIEW_FAILED','Không tạo được PNG xem trước MathType.');

      const widthPt=pxToPt(rect.width),heightPt=pxToPt(rect.height);
      const measured=pxToPt(baseRect.top-rect.top);
      const baselinePt=Number.isFinite(measured)&&measured>=0&&measured<=heightPt
        ? measured : Math.min(heightPt,heightPt*0.82);

      return {
        png:new Uint8Array(await blob.arrayBuffer()),
        widthPt,
        heightPt,
        baselinePt,
        pixelWidth:canvas.width,
        pixelHeight:canvas.height
      };
    }finally{
      try{mathJax.typesetClear?.([host]);}catch{}
      host.remove();
      await cooperativeYield(signal).catch(()=>{});
    }
  };
}
