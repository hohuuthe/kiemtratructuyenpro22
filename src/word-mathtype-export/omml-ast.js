/** New exporter only. Existing OMML importer / Equation generator are not modified. */
import { DOMParser } from '@xmldom/xmldom';
import { fail } from './errors.js';
export const NS = Object.freeze({
  m:'http://schemas.openxmlformats.org/officeDocument/2006/math',
  w:'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r:'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel:'http://schemas.openxmlformats.org/package/2006/relationships',
  ct:'http://schemas.openxmlformats.org/package/2006/content-types',
  v:'urn:schemas-microsoft-com:vml', o:'urn:schemas-microsoft-com:office:office'
});
export const elements = n => Array.from(n?.childNodes || []).filter(c => c.nodeType === 1);
export const local = n => n?.localName || n?.nodeName?.split(':').at(-1);
const unsupported = (n, why = '') => fail('UNSUPPORTED_OMML', 'Unsupported OMML structure: '+local(n)+(why?' ('+why+')':''));
export function parseXml(source) {
  if (typeof source !== 'string' || source.length > 32*1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(source))
    fail('INVALID_XML', 'Unsafe or oversized XML.');
  const errors=[];
  let doc;
  try { doc=new DOMParser({onError(level,message){if(level==='error'||level==='fatalError')errors.push(message);}})
    .parseFromString(source,'application/xml'); }
  catch { fail('INVALID_XML','Malformed XML.'); }
  if(errors.length||!doc?.documentElement||local(doc.documentElement)==='parsererror')fail('INVALID_XML','Malformed XML.');
  return doc;
}
const mchild=(n,k)=>elements(n).find(c=>c.namespaceURI===NS.m&&local(c)===k);
const val=(n,fallback)=>!n?fallback:n.hasAttributeNS(NS.m,'val')?n.getAttributeNS(NS.m,'val'):'';
function bool(n, fallback=false) {
  if(!n)return fallback;
  const v=val(n,''); if(['','1','true','on'].includes(v))return true;
  if(['0','false','off'].includes(v))return false;
  unsupported(n,'boolean');
}
const seq=items=>({k:'seq',items:items.flatMap(x=>x.k==='seq'?x.items:[x])});
const empty=()=>seq([]);
export const isEmpty=n=>n?.k==='seq'&&n.items.length===0;
export function ommlToAst(node) {
  if(node.namespaceURI!==NS.m||local(node)!=='oMath')unsupported(node,'expected oMath');
  let count=0;
  function validateChildren(n, allowed) {
    for(const c of elements(n)) if(c.namespaceURI!==NS.m||!allowed.includes(local(c)))unsupported(c);
  }
  function props(n, name, allowed=[]) {
    const pr=mchild(n,name);
    if(pr){
      validateChildren(pr,[...allowed,'ctrlPr']);
      if(new Set(elements(pr).map(local)).size!==elements(pr).length)unsupported(pr,'duplicate properties');
    }
    const ctrl=mchild(pr,'ctrlPr');
    if(ctrl)for(const c of elements(ctrl)){
      if(c.namespaceURI!==NS.w||local(c)!=='rPr')unsupported(c,'control properties');
      // No visual or semantic properties are silently erased in this prototype.
      for(const p of elements(c))if(!['rFonts','sz','szCs','lang','noProof'].includes(local(p)))unsupported(p,'control style');
    }
    return pr;
  }
  function arg(n,k,depth,required=true) {
    const matches=elements(n).filter(c=>c.namespaceURI===NS.m&&local(c)===k);
    if(matches.length>1||(!matches.length&&required))unsupported(n,'missing/duplicate '+k);
    return matches.length?children(matches[0],depth+1):empty();
  }
  function children(n,depth) { return seq(elements(n).map(c=>read(c,depth+1))); }
  function read(n,depth=0) {
    if(++count>8192||depth>32)fail('RESOURCE_LIMIT','Equation nesting or node limit exceeded.');
    if(n.namespaceURI!==NS.m)unsupported(n,'foreign namespace');
    const k=local(n);
    if(k==='r'){
      for(const c of elements(n))if(!((c.namespaceURI===NS.m&&['rPr','t'].includes(local(c)))||
        (c.namespaceURI===NS.w&&local(c)==='rPr')))unsupported(c);
      const texts=elements(n).filter(c=>c.namespaceURI===NS.m&&local(c)==='t');
      if(texts.length!==1||elements(texts[0]).length)unsupported(n,'text run');
      const rp=mchild(n,'rPr'); if(rp){
        validateChildren(rp,['sty','scr','nor','lit']);
        if(new Set(elements(rp).map(local)).size!==elements(rp).length)unsupported(rp,'duplicate run properties');
      }
      const scr=val(mchild(rp,'scr'),'roman'); if(scr!=='roman')unsupported(n,'math alphabet '+scr);
      let style=val(mchild(rp,'sty'),'auto');
      if(bool(mchild(rp,'nor'))||bool(mchild(rp,'lit')))style='p';
      if(!['auto','p','i','b','bi'].includes(style))unsupported(n,'style');
      const wr=elements(n).find(c=>c.namespaceURI===NS.w&&local(c)==='rPr');
      if(wr)for(const c of elements(wr)){
        if(!['rFonts','sz','szCs','lang','noProof','b','i','bCs','iCs','color'].includes(local(c)))unsupported(c,'run style');
        if(local(c)==='color'&&!['000000','auto',''].includes(c.getAttributeNS(NS.w,'val')))unsupported(c,'colored equation');
        // Explicit Word bold/italic must be reflected rather than discarded.
        if(['b','i'].includes(local(c))){
          const active=!['0','false','off'].includes(c.getAttributeNS(NS.w,'val'));
          if(local(c)==='b')style=active?(['auto','i','bi'].includes(style)?'bi':'b'):style==='bi'?'i':style==='b'?'p':style;
          else style=active?(['b','bi'].includes(style)?'bi':'i'):style==='bi'?'b':'p';
        }
      }
      const text=texts[0].textContent;
      if(text.length>9000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))unsupported(n,'text length/controls');
      for(const char of text)if(char.codePointAt(0)>0xffff||/[\ud800-\udfff\ue000-\uf8ff]/.test(char))unsupported(n,'unsupported MTCode');
      return {k:'text',text,style};
    }
    if(k==='f'){
      validateChildren(n,['fPr','num','den']); const pr=props(n,'fPr',['type']);
      const type=val(mchild(pr,'type'),'bar');
      if(type!=='bar')unsupported(n,'fraction '+type);
      return {k:'frac',num:arg(n,'num',depth),den:arg(n,'den',depth)};
    }
    if(['sSub','sSup','sSubSup','sPre'].includes(k)){
      validateChildren(n,[k+'Pr','e','sub','sup']); props(n,k+'Pr');
      return {k:'script',base:arg(n,'e',depth),sub:arg(n,'sub',depth,['sSub','sSubSup','sPre'].includes(k)),
        sup:arg(n,'sup',depth,['sSup','sSubSup','sPre'].includes(k)),pre:k==='sPre'};
    }
    if(k==='rad'){
      validateChildren(n,['radPr','deg','e']);const pr=props(n,'radPr',['degHide']);
      const deg=arg(n,'deg',depth,false),hide=bool(mchild(pr,'degHide'),false);
      if(hide&&!isEmpty(deg))unsupported(n,'hidden nonempty degree');
      return {k:'root',body:arg(n,'e',depth),degree:hide?empty():deg};
    }
    if(k==='d'){
      validateChildren(n,['dPr','e']);const pr=props(n,'dPr',['begChr','endChr','sepChr','grow','shp']);
      if(mchild(pr,'grow')&&!bool(mchild(pr,'grow')))unsupported(n,'fixed delimiter');
      if(val(mchild(pr,'shp'),'centered')!=='centered')unsupported(n,'delimiter alignment');
      const left=val(mchild(pr,'begChr'),'('),right=val(mchild(pr,'endChr'),')'),separator=val(mchild(pr,'sepChr'),'|');
      const slots=elements(n).filter(c=>local(c)==='e').map(c=>children(c,depth+1));
      if(!slots.length)unsupported(n,'empty delimiter');
      const body=seq(slots.flatMap((s,i)=>i?[{k:'text',text:separator,style:'p'},s]:[s]));
      return {k:'fence',left,right,body};
    }
    if(k==='nary'){
      validateChildren(n,['naryPr','e','sub','sup']);const pr=props(n,'naryPr',['chr','limLoc','subHide','supHide','grow']);
      const sub=arg(n,'sub',depth,false),sup=arg(n,'sup',depth,false);
      if(bool(mchild(pr,'subHide'))&&!isEmpty(sub)||bool(mchild(pr,'supHide'))&&!isEmpty(sup))unsupported(n,'hidden limit');
      const symbol=val(mchild(pr,'chr'),'\u222b'),position=val(mchild(pr,'limLoc'),'subSup');
      if(!['subSup','undOvr'].includes(position))unsupported(n,'limit position');
      return {k:'nary',symbol,position,body:arg(n,'e',depth),sub,sup};
    }
    if(k==='m'){
      validateChildren(n,['mPr','mr']);const pr=props(n,'mPr',['mcs','baseJc','plcHide']);
      if(val(mchild(pr,'baseJc'),'center')!=='center')unsupported(n,'matrix baseline');
      const rows=elements(n).filter(c=>local(c)==='mr').map(row=>{
        validateChildren(row,['e']);return elements(row).map(c=>children(c,depth+1));
      });
      const cols=rows[0]?.length;
      if(!rows.length||!cols||rows.length>64||cols>64||rows.length*cols>1024||rows.some(r=>r.length!==cols))unsupported(n,'matrix dimensions');
      let align='center';const mcs=mchild(pr,'mcs');
      if(mcs){const all=[];validateChildren(mcs,['mc']);for(const mc of elements(mcs)){
        validateChildren(mc,['mcPr']);const cp=mchild(mc,'mcPr');if(cp)validateChildren(cp,['count','mcJc']);
        const times=Number(val(mchild(cp,'count'),'1')),a=val(mchild(cp,'mcJc'),'center');
        if(!Number.isInteger(times)||times<1||times>64||!['left','center','right'].includes(a))unsupported(mc,'column style');
        all.push(...Array(times).fill(a));
      }if(all.length!==cols||new Set(all).size!==1)unsupported(n,'mixed/missing column alignments');align=all[0];}
      return {k:'matrix',rows,align};
    }
    if(k==='eqArr'){
      validateChildren(n,['eqArrPr','e']);const pr=props(n,'eqArrPr',['baseJc']);
      if(val(mchild(pr,'baseJc'),'center')!=='center')unsupported(n,'equation array baseline');
      return {k:'rows',rows:elements(n).filter(c=>local(c)==='e').map(c=>children(c,depth+1))};
    }
    if(k==='acc'||k==='bar'){
      validateChildren(n,[k+'Pr','e']);const pr=props(n,k+'Pr',k==='acc'?['chr']:['pos']);
      const mark=k==='acc'?val(mchild(pr,'chr'),'\u0302'):val(mchild(pr,'pos'),'top')==='top'?'overbar':'underbar';
      return {k:'accent',mark,body:arg(n,'e',depth)};
    }
    if(k==='limLow'||k==='limUpp'){
      validateChildren(n,[k+'Pr','e','lim']);props(n,k+'Pr');
      return {k:'limit',body:arg(n,'e',depth),sub:k==='limLow'?arg(n,'lim',depth):empty(),sup:k==='limUpp'?arg(n,'lim',depth):empty()};
    }
    if(k==='func'){
      validateChildren(n,['funcPr','fName','e']);props(n,'funcPr');
      return seq([arg(n,'fName',depth),arg(n,'e',depth)]);
    }
    if(k==='box'){
      validateChildren(n,['boxPr','e']);props(n,'boxPr',[]);return arg(n,'e',depth);
    }
    unsupported(n);
  }
  return children(node,0);
}
export const xmlEscape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
/** One AST is the input of BOTH the editable bytes and the visible preview. */
export function astToMathml(ast, display=false) {
  const x=xmlEscape;
  function out(n){
    switch(n.k){
      case 'seq':return '<mrow>'+n.items.map(out).join('')+'</mrow>';
      case 'text':{
        if(n.style==='p')return '<mtext>'+x(n.text)+'</mtext>';
        return '<mrow>'+Array.from(n.text,c=>{
          if(/^\s$/.test(c))return '<mspace width="0.25em"/>';
          const variant={p:'normal',i:'italic',b:'bold',bi:'bold-italic'}[n.style] ||
            (/[A-Za-z\u03b1-\u03c9]/.test(c)?'italic':'normal');
          const tag=/[0-9]/.test(c)?'mn':/[A-Za-z\u0370-\u03ff]/.test(c)?'mi':'mo';
          return '<'+tag+' mathvariant="'+variant+'">'+x(c)+'</'+tag+'>';
        }).join('')+'</mrow>';
      }
      case 'frac':return '<mfrac>'+out(n.num)+out(n.den)+'</mfrac>';
      case 'root':return isEmpty(n.degree)?'<msqrt>'+out(n.body)+'</msqrt>':'<mroot>'+out(n.body)+out(n.degree)+'</mroot>';
      case 'script':{
        if(n.pre)return '<mmultiscripts>'+out(n.base)+'<mprescripts/>'+(isEmpty(n.sub)?'<none/>':out(n.sub))+(isEmpty(n.sup)?'<none/>':out(n.sup))+'</mmultiscripts>';
        if(isEmpty(n.sub))return '<msup>'+out(n.base)+out(n.sup)+'</msup>';
        if(isEmpty(n.sup))return '<msub>'+out(n.base)+out(n.sub)+'</msub>';
        return '<msubsup>'+out(n.base)+out(n.sub)+out(n.sup)+'</msubsup>';
      }
      case 'fence':return '<mrow><mo fence="true" stretchy="true">'+x(n.left)+'</mo>'+out(n.body)+'<mo fence="true" stretchy="true">'+x(n.right)+'</mo></mrow>';
      case 'nary':{
        let sign='<mo largeop="true" movablelimits="false">'+x(n.symbol)+'</mo>';
        const under=n.position==='undOvr';
        if(!isEmpty(n.sub)&&!isEmpty(n.sup))sign='<'+(under?'munderover':'msubsup')+'>'+sign+out(n.sub)+out(n.sup)+'</'+(under?'munderover':'msubsup')+'>';
        else if(!isEmpty(n.sub))sign='<'+(under?'munder':'msub')+'>'+sign+out(n.sub)+'</'+(under?'munder':'msub')+'>';
        else if(!isEmpty(n.sup))sign='<'+(under?'mover':'msup')+'>'+sign+out(n.sup)+'</'+(under?'mover':'msup')+'>';
        return '<mrow>'+sign+out(n.body)+'</mrow>';
      }
      case 'matrix':return '<mtable columnalign="'+n.align+'">'+n.rows.map(r=>'<mtr>'+r.map(c=>'<mtd>'+out(c)+'</mtd>').join('')+'</mtr>').join('')+'</mtable>';
      case 'rows':return '<mtable columnalign="left">'+n.rows.map(r=>'<mtr><mtd>'+out(r)+'</mtd></mtr>').join('')+'</mtable>';
      case 'accent':{
        const under=n.mark==='underbar',mark=n.mark==='overbar'||under?'\u00af':n.mark;
        return '<'+(under?'munder':'mover')+' accent="true">'+out(n.body)+'<mo stretchy="true">'+x(mark)+'</mo></'+(under?'munder':'mover')+'>';
      }
      case 'limit':return !isEmpty(n.sub)?'<munder>'+out(n.body)+out(n.sub)+'</munder>':'<mover>'+out(n.body)+out(n.sup)+'</mover>';
      default:fail('UNSUPPORTED_AST','Unknown formula node.');
    }
  }
  return '<math xmlns="http://www.w3.org/1998/Math/MathML" display="'+(display?'block':'inline')+'">'+out(ast)+'</math>';
}
