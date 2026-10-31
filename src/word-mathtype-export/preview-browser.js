/** Browser-only rasterization; never used by Equation export or at startup. */
import {fail,aborted} from './errors.js';
export function createBrowserPngRenderer(renderFormulaSvg) {
if(typeof renderFormulaSvg!=='function')fail('PREVIEW_REQUIRED','A qualified SVG renderer is required.');
return async function renderFormulaPng(ast,options={}) {
  aborted(options.signal);const rendered=renderFormulaSvg(ast,options);
  const pixelsPerPoint=4; // 288 dpi, independent of phone devicePixelRatio.
  const w=Math.max(1,Math.ceil(rendered.widthPt*pixelsPerPoint)),h=Math.max(1,Math.ceil(rendered.heightPt*pixelsPerPoint));
  if(w*h>8_000_000||w>8192||h>8192)fail('RESOURCE_LIMIT','Equation preview pixel limit exceeded.');
  const url=URL.createObjectURL(new Blob([rendered.svg],{type:'image/svg+xml'}));
  try{
    const image=new Image();image.src=url;await image.decode();aborted(options.signal);
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');if(!ctx)fail('PREVIEW_FAILED','Canvas is unavailable.');
    ctx.drawImage(image,0,0,w,h);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)fail('PREVIEW_FAILED','PNG generation failed.');
    return {...rendered,png:new Uint8Array(await blob.arrayBuffer()),pixelWidth:w,pixelHeight:h};
  }finally{URL.revokeObjectURL(url);}
};
}
