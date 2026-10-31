/**
 * Preview-only browser rasterizer for the experimental MathType export route.
 * Loaded lazily only after the user explicitly chooses MathType.
 * Equation export never imports this module.
 */
import html2canvas from 'html2canvas-pro';
import {astToMathml} from './omml-ast.js';
import {fail,aborted} from './errors.js';

const pxToPt = px => px * 72 / 96;

export function isMathTypePreviewHost(hostname = globalThis.location?.hostname || '') {
  return hostname === 'localhost' || hostname === '127.0.0.1' ||
    /^[^.]+\.kiemtratructuyenpro\.pages\.dev$/i.test(hostname);
}

async function waitForMathJax() {
  const started = Date.now();
  while (Date.now() - started < 12000) {
    const mj = globalThis.MathJax;
    if (mj?.typesetPromise) {
      if (mj.startup?.promise) await mj.startup.promise;
      return mj;
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  fail('PREVIEW_FAILED','MathJax chưa sẵn sàng để tạo ảnh xem trước MathType.');
}

export function createBrowserMathTypePreviewRenderer() {
  return async function renderMathTypePreview(ast,options={}) {
    aborted(options.signal);
    if (typeof document === 'undefined' || typeof window === 'undefined')
      fail('PREVIEW_FAILED','MathType Preview chỉ chạy trong trình duyệt.');
    const mathJax=await waitForMathJax();
    aborted(options.signal);

    const fontSizePt=Number(options.fontSizePt || 13);
    if (!Number.isFinite(fontSizePt) || fontSizePt < 6 || fontSizePt > 96)
      fail('INVALID_SIZE','Cỡ chữ công thức MathType không hợp lệ.');

    const host=document.createElement('div');
    host.setAttribute('data-kttt-mathtype-preview','true');
    host.style.cssText=[
      'position:fixed','left:-20000px','top:0','z-index:-1','visibility:visible',
      'display:inline-block','white-space:nowrap','background:transparent',
      'color:#000','font-size:'+fontSizePt+'pt','line-height:normal','padding:0','margin:0'
    ].join(';');
    // Render as inline MathML for stable baseline measurement. The DOCX converter
    // preserves the original Word paragraph alignment separately.
    host.innerHTML=astToMathml(ast,false);
    const baseline=document.createElement('span');
    baseline.setAttribute('aria-hidden','true');
    baseline.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline;';
    host.appendChild(baseline);
    document.body.appendChild(host);

    try {
      await mathJax.typesetPromise([host]);
      aborted(options.signal);
      if (document.fonts?.ready) await document.fonts.ready;
      const math=host.querySelector('mjx-container');
      if (!math) fail('PREVIEW_FAILED','MathJax không tạo được công thức xem trước.');

      const rect=math.getBoundingClientRect();
      const baseRect=baseline.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.width > 5000 || rect.height > 5000)
        fail('PREVIEW_FAILED','Kích thước công thức xem trước không hợp lệ.');

      const scale=3;
      const canvas=await html2canvas(math,{
        backgroundColor:null,
        scale,
        logging:false,
        useCORS:false,
        allowTaint:false,
        removeContainer:true
      });
      aborted(options.signal);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if (!blob) fail('PREVIEW_FAILED','Không tạo được PNG xem trước MathType.');

      const widthPt=pxToPt(rect.width);
      const heightPt=pxToPt(rect.height);
      const measured=pxToPt(baseRect.top-rect.top);
      const baselinePt=Number.isFinite(measured) && measured >= 0 && measured <= heightPt
        ? measured : Math.min(heightPt,heightPt*0.82);
      return {
        png:new Uint8Array(await blob.arrayBuffer()),
        widthPt,
        heightPt,
        baselinePt,
        pixelWidth:canvas.width,
        pixelHeight:canvas.height
      };
    } finally {
      try { mathJax.typesetClear?.([host]); } catch {}
      host.remove();
    }
  };
}
