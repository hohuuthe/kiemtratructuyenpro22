/**
 * Preview-only MathType renderer.
 * Uses its OWN MathJax SVG engine, lazy-loaded only after the user selects MathType.
 * The application's global MathJax CHTML instance is never touched.
 */
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {MathML} from 'mathjax-full/js/input/mathml.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {astToMathml} from './omml-ast.js';
import {fail,aborted} from './errors.js';

const pxPerPt=96/72;
const nextPaint=()=>new Promise(resolve=>{
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>resolve());
  else setTimeout(resolve,0);
});
async function cooperativeYield(signal){
  aborted(signal);
  if(globalThis.scheduler?.yield)await globalThis.scheduler.yield();
  else{await nextPaint();await new Promise(r=>setTimeout(r,0));}
  aborted(signal);
}

let engine=null;
function getEngine(){
  if(engine)return engine;
  const adaptor=liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const document=mathjax.document('',{
    InputJax:new MathML(),
    OutputJax:new SVG({fontCache:'none'})
  });
  engine={adaptor,document};
  return engine;
}
function safeSvg(adaptor,node){
  const xml=adaptor.outerHTML(node);
  if(!xml.startsWith('<svg')||/merror|mjx-merror|<text\b|<foreignObject\b|<image\b|<script\b/i.test(xml))
    fail('PREVIEW_FAILED','MathType SVG chứa glyph hoặc thành phần không được hỗ trợ.');
  if(/(?:href|xlink:href)=["'](?!#)/i.test(xml))
    fail('PREVIEW_FAILED','MathType SVG tham chiếu tài nguyên ngoài.');
  return xml;
}
async function svgToPng(svg,widthPx,heightPx,scale,signal){
  aborted(signal);await cooperativeYield(signal);
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();image.decoding='async';image.src=url;await image.decode();
    aborted(signal);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.ceil(widthPx*scale));
    canvas.height=Math.max(1,Math.ceil(heightPx*scale));
    if(canvas.width>8192||canvas.height>8192||canvas.width*canvas.height>8_000_000)
      fail('RESOURCE_LIMIT','Equation preview pixel limit exceeded.');
    const ctx=canvas.getContext('2d',{alpha:true});
    if(!ctx)fail('PREVIEW_FAILED','Canvas không khả dụng.');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)fail('PREVIEW_FAILED','Không tạo được PNG xem trước MathType.');
    return {png:new Uint8Array(await blob.arrayBuffer()),pixelWidth:canvas.width,pixelHeight:canvas.height};
  }finally{URL.revokeObjectURL(url);}
}

export function createBrowserMathTypePreviewRenderer(){
  const {adaptor,document:mathDocument}=getEngine();
  return async function renderMathTypePreview(ast,{fontSizePt=13,display=false,signal}={}){
    aborted(signal);await cooperativeYield(signal);
    const size=Number(fontSizePt);
    if(!Number.isFinite(size)||size<6||size>96)fail('INVALID_SIZE','Cỡ chữ công thức MathType không hợp lệ.');
    const mathml=astToMathml(ast,display);
    const node=mathDocument.convert(mathml,{
      display,
      em:size*pxPerPt,
      ex:size*pxPerPt/2,
      containerWidth:1000
    });
    const root=adaptor.firstChild(node);
    if(!root)fail('PREVIEW_FAILED','MathJax SVG không tạo được công thức.');
    const viewBox=(adaptor.getAttribute(root,'viewBox')||'').trim().split(/\s+/).map(Number);
    if(viewBox.length!==4||!viewBox.every(Number.isFinite)||viewBox[2]<=0||viewBox[3]<=0)
      fail('PREVIEW_FAILED','MathJax SVG có kích thước không hợp lệ.');
    const [left,top,width,height]=viewBox;
    void left;
    const widthPt=width*size/1000;
    const heightPt=height*size/1000;
    const baselinePt=Math.max(0,Math.min(heightPt,(height+top)*size/1000));
    if(widthPt<=0||heightPt<=0||widthPt>3000||heightPt>3000)
      fail('RESOURCE_LIMIT','Công thức xem trước vượt giới hạn.');
    adaptor.setAttribute(root,'width',String(widthPt*pxPerPt));
    adaptor.setAttribute(root,'height',String(heightPt*pxPerPt));
    adaptor.setAttribute(root,'xmlns','http://www.w3.org/2000/svg');
    const svg=safeSvg(adaptor,root);
    const raster=await svgToPng(svg,widthPt*pxPerPt,heightPt*pxPerPt,3,signal);
    return {...raster,widthPt,heightPt,baselinePt};
  };
}
