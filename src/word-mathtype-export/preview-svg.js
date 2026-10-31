/**
 * Lazy-loaded MathJax, MathML input only. Pure glyph paths: no remote fonts/images.
 * The document's immutable AST is shared with the MTEF writer.
 */
import {astToMathml} from './omml-ast.js';
import {fail} from './errors.js';
/** Renderer injection keeps MathJax out of the current Equation bundle. */
export function createSvgRenderer({mathjax,MathML,SVG,liteAdaptor,RegisterHTMLHandler}) {
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const document=mathjax.document('',{InputJax:new MathML(),OutputJax:new SVG({fontCache:'none'})});
return function renderFormulaSvg(ast,{fontSizePt=13,display=false}={}) {
  const mathml=astToMathml(ast,display);
  const result=document.convert(mathml,{display,em:fontSizePt*96/72,ex:fontSizePt*96/144,containerWidth:1000});
  const root=adaptor.firstChild(result);
  const serialized=adaptor.outerHTML(root);
  if(!serialized.startsWith('<svg')||/merror|mjx-merror|<text\b|<foreignObject\b|<image\b|<use\b|<script\b/i.test(serialized))
    fail('PREVIEW_FAILED','Preview contains an unsupported/missing glyph or external resource.');
  const viewBox=adaptor.getAttribute(root,'viewBox')?.split(/\s+/).map(Number);
  if(!viewBox||viewBox.length!==4||!viewBox.every(Number.isFinite)||viewBox[2]<=0||viewBox[3]<=0)
    fail('PREVIEW_FAILED','Invalid formula preview bounds.');
  const [,top,width,height]=viewBox;
  const widthPt=width*fontSizePt/1000,heightPt=height*fontSizePt/1000;
  const baselinePt=Math.max(0,(height+top)*fontSizePt/1000);
  if(widthPt>3000||heightPt>3000)fail('RESOURCE_LIMIT','Formula preview is too large.');
  adaptor.setAttribute(root,'width',String(widthPt*96/72));adaptor.setAttribute(root,'height',String(heightPt*96/72));
  adaptor.setAttribute(root,'xmlns','http://www.w3.org/2000/svg');
  return {svg:adaptor.outerHTML(root),mathml,widthPt,heightPt,baselinePt};
};
}
