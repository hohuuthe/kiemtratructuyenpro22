/**
 * Browser preview renderer for MathType OLE export.
 *
 * Performance strategy:
 * - cache identical formula previews across an export/session
 * - typeset multiple formulas in one MathJax pass
 * - capture one small off-screen batch with html2canvas, then crop per formula
 * - cooperatively yield between batches so the UI stays responsive
 *
 * Equation export never imports this module.
 */
import html2canvas from 'html2canvas-pro';
import {astToMathml} from './omml-ast.js';
import {fail,aborted} from './errors.js';

const pxToPt=px=>px*72/96;
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

let mathJaxReadyPromise=null;
async function waitForMathJax(){
  if(mathJaxReadyPromise)return mathJaxReadyPromise;
  mathJaxReadyPromise=(async()=>{
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
  })();
  try{return await mathJaxReadyPromise;}
  catch(e){mathJaxReadyPromise=null;throw e;}
}

function rasterScale(){
  const narrow=typeof window!=='undefined'&&window.innerWidth<900;
  const mem=Number(globalThis.navigator?.deviceMemory||0);
  if(narrow||mem&&mem<=4)return 1.5;
  return 2;
}
function batchLimit(){
  const narrow=typeof window!=='undefined'&&window.innerWidth<900;
  const mem=Number(globalThis.navigator?.deviceMemory||0);
  if(narrow||mem&&mem<=4)return 6;
  if(mem&&mem<=8)return 10;
  return 16;
}

const CACHE_MAX_ITEMS=256;
const CACHE_MAX_BYTES=24*1024*1024;
const previewCache=new Map();
let previewCacheBytes=0;
function cacheKey(item,scale){
  const size=Number(item.fontSizePt||13);
  return scale+'|'+size+'|'+(item.display?1:0)+'|'+JSON.stringify(item.ast);
}
function cacheGet(key){
  const value=previewCache.get(key);
  if(!value)return null;
  previewCache.delete(key);previewCache.set(key,value);
  return value;
}
function cachePut(key,value){
  const bytes=value.png?.byteLength||0;
  if(bytes>CACHE_MAX_BYTES/2)return;
  const old=previewCache.get(key);
  if(old){previewCacheBytes-=old.png?.byteLength||0;previewCache.delete(key);}
  previewCache.set(key,value);previewCacheBytes+=bytes;
  while(previewCache.size>CACHE_MAX_ITEMS||previewCacheBytes>CACHE_MAX_BYTES){
    const first=previewCache.keys().next().value;
    if(first===undefined)break;
    const evicted=previewCache.get(first);
    previewCacheBytes-=evicted?.png?.byteLength||0;
    previewCache.delete(first);
  }
}
function validSize(size){
  if(!Number.isFinite(size)||size<6||size>96)fail('INVALID_SIZE','Cỡ chữ công thức MathType không hợp lệ.');
}
async function canvasToPng(canvas){
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)fail('PREVIEW_FAILED','Không tạo được PNG xem trước MathType.');
  return new Uint8Array(await blob.arrayBuffer());
}
async function cropPng(source,sx,sy,sw,sh){
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,sw);canvas.height=Math.max(1,sh);
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx)fail('PREVIEW_FAILED','Canvas không khả dụng.');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(source,sx,sy,sw,sh,0,0,sw,sh);
  return canvasToPng(canvas);
}

async function renderChunk(items,scale,signal){
  aborted(signal);
  if(!items.length)return [];
  if(typeof document==='undefined'||typeof window==='undefined')
    fail('PREVIEW_FAILED','MathType chỉ có thể tạo ảnh xem trước trong trình duyệt.');

  await cooperativeYield(signal);
  const mathJax=await waitForMathJax();

  const host=document.createElement('div');
  host.setAttribute('data-kttt-mathtype-preview-batch','true');
  host.className='tex2jax_process';
  host.style.cssText=[
    'position:fixed','left:-20000px','top:0','z-index:-1','visibility:visible',
    'display:flex','flex-direction:column','align-items:flex-start','gap:4px',
    'width:max-content','height:auto','padding:2px','margin:0',
    'background:transparent','color:#000','pointer-events:none'
  ].join(';');

  const rows=items.map(item=>{
    const size=Number(item.fontSizePt||13);validSize(size);
    const row=document.createElement('div');
    row.style.cssText=[
      'display:block','width:max-content','height:auto','white-space:nowrap',
      'font-size:'+size+'pt','line-height:1.2','padding:0','margin:0',
      'background:transparent','color:#000'
    ].join(';');
    row.innerHTML=astToMathml(item.ast,false);
    const baseline=document.createElement('span');
    baseline.setAttribute('aria-hidden','true');
    baseline.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline;';
    row.appendChild(baseline);host.appendChild(row);
    return {row,baseline,size};
  });
  document.body.appendChild(host);

  try{
    await mathJax.typesetPromise([host]);
    aborted(signal);
    await cooperativeYield(signal);

    const hostRect=host.getBoundingClientRect();
    const measured=rows.map(({row,baseline,size})=>{
      const math=row.querySelector('mjx-container');
      if(!math)fail('PREVIEW_FAILED','MathJax CHTML không tạo được công thức xem trước.');
      const rect=math.getBoundingClientRect(),baseRect=baseline.getBoundingClientRect();
      if(!rect.width||!rect.height||rect.width>5000||rect.height>5000)
        fail('PREVIEW_FAILED','Kích thước công thức xem trước không hợp lệ.');
      const widthPt=pxToPt(rect.width),heightPt=pxToPt(rect.height);
      const rawBaseline=pxToPt(baseRect.top-rect.top);
      const baselinePt=Number.isFinite(rawBaseline)&&rawBaseline>=0&&rawBaseline<=heightPt
        ? rawBaseline:Math.min(heightPt,heightPt*0.82);
      return {math,rect,size,widthPt,heightPt,baselinePt};
    });

    const estimatedWidth=Math.ceil(hostRect.width*scale);
    const estimatedHeight=Math.ceil(hostRect.height*scale);
    const tooLarge=estimatedWidth>8192||estimatedHeight>8192||estimatedWidth*estimatedHeight>16_000_000;
    if(tooLarge&&items.length>1){
      const mid=Math.ceil(items.length/2);
      try{mathJax.typesetClear?.([host]);}catch{}
      host.remove();
      const left=await renderChunk(items.slice(0,mid),scale,signal);
      const right=await renderChunk(items.slice(mid),scale,signal);
      return [...left,...right];
    }
    if(tooLarge)fail('RESOURCE_LIMIT','Equation preview batch exceeds browser pixel limits.');

    const sheet=await html2canvas(host,{
      backgroundColor:null,
      scale,
      logging:false,
      useCORS:false,
      allowTaint:false,
      removeContainer:true,
      imageTimeout:4000,
      foreignObjectRendering:false,
      width:Math.ceil(hostRect.width),
      height:Math.ceil(hostRect.height)
    });
    aborted(signal);
    await cooperativeYield(signal);

    if(sheet.width>8192||sheet.height>8192||sheet.width*sheet.height>16_000_000)
      fail('RESOURCE_LIMIT','Equation preview batch exceeds browser pixel limits.');

    const scaleX=sheet.width/hostRect.width,scaleY=sheet.height/hostRect.height;
    const out=[];
    for(const item of measured){
      aborted(signal);
      const x1=Math.max(0,Math.floor((item.rect.left-hostRect.left)*scaleX));
      const y1=Math.max(0,Math.floor((item.rect.top-hostRect.top)*scaleY));
      const x2=Math.min(sheet.width,Math.ceil((item.rect.right-hostRect.left)*scaleX));
      const y2=Math.min(sheet.height,Math.ceil((item.rect.bottom-hostRect.top)*scaleY));
      const sw=Math.max(1,x2-x1),sh=Math.max(1,y2-y1);
      if(sw*sh>8_000_000||sw>8192||sh>8192)fail('RESOURCE_LIMIT','Equation preview pixel limit exceeded.');
      out.push({
        png:await cropPng(sheet,x1,y1,sw,sh),
        widthPt:item.widthPt,
        heightPt:item.heightPt,
        baselinePt:item.baselinePt,
        pixelWidth:sw,
        pixelHeight:sh
      });
    }
    return out;
  }finally{
    try{mathJax.typesetClear?.([host]);}catch{}
    host.remove();
    await cooperativeYield(signal).catch(()=>{});
  }
}

export function createBrowserMathTypePreviewBatchRenderer(){
  return async function renderMathTypePreviewBatch(items,{signal,onProgress}={}){
    if(!Array.isArray(items)||items.length>2000)fail('RESOURCE_LIMIT','Số lượng công thức MathType không hợp lệ.');
    const scale=rasterScale(),out=new Array(items.length),misses=[];
    let completed=0,cached=0;
    for(let i=0;i<items.length;i++){
      const key=cacheKey(items[i],scale),hit=cacheGet(key);
      if(hit){out[i]=hit;completed++;cached++;}
      else misses.push({index:i,key,item:items[i]});
    }
    onProgress?.({completed,total:items.length,cached});

    const limit=batchLimit();
    for(let start=0;start<misses.length;start+=limit){
      aborted(signal);
      const chunk=misses.slice(start,start+limit);
      const rendered=await renderChunk(chunk.map(x=>x.item),scale,signal);
      if(rendered.length!==chunk.length)fail('PREVIEW_FAILED','Số ảnh xem trước MathType không khớp số công thức.');
      for(let i=0;i<chunk.length;i++){
        const target=chunk[i],preview=rendered[i];
        cachePut(target.key,preview);out[target.index]=preview;completed++;
      }
      onProgress?.({completed,total:items.length,cached});
      await cooperativeYield(signal);
    }
    return out;
  };
}

export function createBrowserMathTypePreviewRenderer(){
  const batch=createBrowserMathTypePreviewBatchRenderer();
  return async function renderMathTypePreview(ast,options={}){
    return (await batch([{ast,fontSizePt:options.fontSizePt,display:options.display}],options))[0];
  };
}
