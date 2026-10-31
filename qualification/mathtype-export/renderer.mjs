/** Qualification runtime; not imported by the current production app. */
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {MathML} from 'mathjax-full/js/input/mathml.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {createSvgRenderer} from '../../src/word-mathtype-export/preview-svg.js';
export const renderFormulaSvg=createSvgRenderer({mathjax,MathML,SVG,liteAdaptor,RegisterHTMLHandler});
export async function renderFormulaPng(ast,options={}){
  const {default:sharp}=await import('sharp');
  const v=renderFormulaSvg(ast,options),width=Math.max(1,Math.ceil(v.widthPt*4)),height=Math.max(1,Math.ceil(v.heightPt*4));
  if(width*height>8_000_000||width>8192||height>8192)throw new Error('Preview bounds exceed the qualification limit.');
  return {...v,png:new Uint8Array(await sharp(Buffer.from(v.svg)).resize(width,height).png().toBuffer())};
}
