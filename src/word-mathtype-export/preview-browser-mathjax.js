/**
 * Preview-only browser rasterizer for the experimental MathType export route.
 * Loaded lazily only after the user explicitly chooses MathType.
 * Equation export never imports this module.
 *
 * IMPORTANT: do not use html2canvas here. MathJax already gives us an SVG;
 * serializing that SVG and drawing it directly to Canvas is substantially lighter
 * on the browser main thread, especially on phones with 100+ equations.
 */
import {astToMathml} from './omml-ast.js';
import {fail,aborted} from './errors.js';

const pxToPt = px => px * 72 / 96;
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

async function cooperativeYield(signal) {
  aborted(signal);
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
  else {
    await nextFrame();
    await new Promise(resolve => setTimeout(resolve,0));
  }
  aborted(signal);
}

async function waitForMathJax() {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    const mj = globalThis.MathJax;
    if (mj?.typesetPromise) {
      if (mj.startup?.promise) await mj.startup.promise;
      return mj;
    }
    await new Promise(resolve => setTimeout(resolve,60));
  }
  fail('PREVIEW_FAILED','MathJax chưa sẵn sàng để tạo ảnh xem trước MathType.');
}

function serializedSafeSvg(svg,widthPx,heightPx) {
  const clone=svg.cloneNode(true);
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  clone.setAttribute('width',String(widthPx));
  clone.setAttribute('height',String(heightPx));
  for(const n of clone.querySelectorAll('image,script,foreignObject'))
    fail('PREVIEW_FAILED','MathJax SVG chứa thành phần không được phép.');
  for(const use of clone.querySelectorAll('use')) {
    const href=use.getAttribute('href')||use.getAttribute('xlink:href')||'';
    if(href && !href.startsWith('#')) fail('PREVIEW_FAILED','MathJax SVG tham chiếu tài nguyên ngoài.');
  }
  return new XMLSerializer().serializeToString(clone);
}

async function rasterizeSvg(svg,widthPx,heightPx,scale,signal) {
  await cooperativeYield(signal);
  const source=serializedSafeSvg(svg,widthPx,heightPx);
  const url=URL.createObjectURL(new Blob([source],{type:'image/svg+xml;charset=utf-8'}));
  try {
    const image=new Image();
    image.decoding='async';
    image.src=url;
    await image.decode();
    aborted(signal);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.ceil(widthPx*scale));
    canvas.height=Math.max(1,Math.ceil(heightPx*scale));
    if(canvas.width*canvas.height>8_000_000||canvas.width>8192||canvas.height>8192)
      fail('RESOURCE_LIMIT','Equation preview pixel limit exceeded.');
    const ctx=canvas.getContext('2d',{alpha:true});
    if(!ctx)fail('PREVIEW_FAILED','Canvas không khả dụng.');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)fail('PREVIEW_FAILED','Không tạo được PNG xem trước MathType.');
    return {png:new Uint8Array(await blob.arrayBuffer()),pixelWidth:canvas.width,pixelHeight:canvas.height};
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createBrowserMathTypePreviewRenderer() {
  return async function renderMathTypePreview(ast,options={}) {
    aborted(options.signal);
    if(typeof document==='undefined'||typeof window==='undefined')
      fail('PREVIEW_FAILED','MathType Preview chỉ chạy trong trình duyệt.');

    // Give the browser one paint opportunity before each formula. This keeps
    // scrolling, progress text, modal buttons and cancellation responsive.
    await cooperativeYield(options.signal);
    const mathJax=await waitForMathJax();
    aborted(options.signal);

    const fontSizePt=Number(options.fontSizePt||13);
    if(!Number.isFinite(fontSizePt)||fontSizePt<6||fontSizePt>96)
      fail('INVALID_SIZE','Cỡ chữ công thức MathType không hợp lệ.');

    const host=document.createElement('div');
    host.setAttribute('data-kttt-mathtype-preview','true');
    host.style.cssText=[
      'position:fixed','left:-20000px','top:0','z-index:-1','visibility:visible',
      'display:inline-block','white-space:nowrap','background:transparent',
      'color:#000','font-size:'+fontSizePt+'pt','line-height:normal','padding:0','margin:0',
      'pointer-events:none'
    ].join(';');
    host.innerHTML=astToMathml(ast,false);
    const baseline=document.createElement('span');
    baseline.setAttribute('aria-hidden','true');
    baseline.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline;';
    host.appendChild(baseline);
    document.body.appendChild(host);

    try {
      await mathJax.typesetPromise([host]);
      aborted(options.signal);
      if(document.fonts?.ready)await document.fonts.ready;
      const container=host.querySelector('mjx-container');
      const svg=container?.querySelector('svg');
      if(!container||!svg)fail('PREVIEW_FAILED','MathJax không tạo được SVG công thức.');

      const rect=container.getBoundingClientRect();
      const baseRect=baseline.getBoundingClientRect();
      if(!rect.width||!rect.height||rect.width>5000||rect.height>5000)
        fail('PREVIEW_FAILED','Kích thước công thức xem trước không hợp lệ.');

      const widthPt=pxToPt(rect.width),heightPt=pxToPt(rect.height);
      const measured=pxToPt(baseRect.top-rect.top);
      const baselinePt=Number.isFinite(measured)&&measured>=0&&measured<=heightPt
        ? measured : Math.min(heightPt,heightPt*0.82);

      // 3x is retained for print clarity. Direct SVG rasterization is much
      // cheaper than DOM screenshots while preserving the same output density.
      const raster=await rasterizeSvg(svg,rect.width,rect.height,3,options.signal);
      return {...raster,widthPt,heightPt,baselinePt};
    } finally {
      try{mathJax.typesetClear?.([host]);}catch{}
      host.remove();
    }
  };
}
