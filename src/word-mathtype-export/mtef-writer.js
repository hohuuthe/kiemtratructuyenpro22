/**
 * New bounded MTEF v5 writer. Source: WIRIS MTEF v5 records/template slot order.
 * No input executable objects, no arbitrary-tail trimming, no guessed source.
 */
import {fail} from './errors.js';
import {isEmpty} from './omml-ast.js';
const ascii=s=>Array.from(s,c=>c.charCodeAt(0));
const word=n=>[n&255,(n>>>8)&255];
const TYPES={text:1,variable:3,greek:4,upperGreek:5,symbol:6,vector:7,number:8};
const FENCES=[['\u27e8','\u27e9'],['(',')'],['{','}'],['[',']'],['|','|'],['\u2016','\u2016'],['\u230a','\u230b'],['\u2308','\u2309']];
const NARY={'\u2211':[16,0x2211],'\u220f':[17,0x220f],'\u2210':[18,0x2210],'\u22c3':[19,0x22c3],'\u22c2':[20,0x22c2],
  '\u222b':[21,0x222b],'\u222c':[21,0x222c],'\u222d':[21,0x222d],'\u222e':[21,0x222e]};
export function astToMtef(ast,{fontSizePt=13,display=false}={}) {
  if(!Number.isFinite(fontSizePt)||fontSizePt<6||fontSizePt>72)fail('INVALID_SIZE','Unsupported equation font size.');
  // A single positive MathType vector style can represent bold OR bold italic.
  // Mixing both would need explicit font styles not supported by our importer.
  const boldStyles=new Set();let nodeCount=0;
  function scan(n,depth=0){
    if(!n||typeof n!=='object'||depth>32||++nodeCount>8192)fail('RESOURCE_LIMIT','Invalid or too complex equation.');
    if(n.k==='text'&&['b','bi'].includes(n.style))boldStyles.add(n.style);
    for(const [key,v] of Object.entries(n))if(v&&typeof v==='object'){
      if(Array.isArray(v)){for(const x of v)if(Array.isArray(x)){for(const y of x)scan(y,depth+1);}else scan(x,depth+1);}
      else scan(v,depth+1);
    }
  }
  scan(ast);if(boldStyles.size>1)fail('UNSUPPORTED_STYLE','Mixed bold and bold-italic MathType styles require qualification.');
  const boldStyle=boldStyles.has('b')?1:3;
  // Use known face definitions. Unicode is carried in MTCode; never encode glyph
  // positions from a font that could refer to an unrelated mathematical symbol.
  const fontDefs=[17,1,...ascii('Times New Roman'),0,17,3,...ascii('Symbol'),0];
  const dims=[[2,String(fontSizePt)],[4,'70.7'],[4,'50'],[4,'150'],[4,'100']];
  const nibbles=dims.flatMap(([unit,value])=>[unit,...Array.from(value,c=>c==='.'?10:Number(c)),15]);
  if(nibbles.length%2)nibbles.push(0);
  const dimensions=nibbles.filter((_,i)=>i%2===0).map((v,i)=>(v<<4)|nibbles[i*2+1]);
  const prefs=[18,0,dims.length,...dimensions,0,8, 1,0, 1,0, 1,2, 2,2, 2,0, 2,0, 1,boldStyle, 1,0];
  const char=(cp,face)=>{if(cp>0xffff||cp<32||cp>=0xd800&&cp<=0xdfff||cp>=0xe000&&cp<=0xf8ff)fail('UNSUPPORTED_CODEPOINT','Unsupported MTCode.');return [2,0,face+128,...word(cp)];};
  const tmpl=(selector,v,children,flags=0)=>[3,0,selector,...(v<128?[v]:[(v&127)|128,v>>>8]),flags,...children.flat(),0];
  const line=(n,depth=0)=>isEmpty(n)?[1,1]:[1,0,10+Math.min(depth,2),...emit(n,depth),0];
  const empty=[1,1];
  function emit(n,depth=0){
    switch(n.k){
      case 'seq':return n.items.flatMap(c=>emit(c,depth));
      case 'text':return Array.from(n.text,c=>{
        const cp=c.codePointAt(0);let face;
        // Office Math may use U+00A0 (nonbreaking), U+2009 (thin), etc.
        // These are horizontal separator characters, NOT tab/newline. Keep
        // their exact Unicode MTCode; do not collapse spacing to U+0020.
        if(/^\p{Zs}$/u.test(c))return char(cp,TYPES.text);
        if(/^\s$/u.test(c))
          fail('UNSUPPORTED_WHITESPACE','Tabs/newlines inside a math run need structural rows.');
        if(n.style==='p')face=TYPES.text;
        else if(n.style==='b'||n.style==='bi')face=TYPES.vector;
        else if(/[0-9]/.test(c))face=n.style==='i'?TYPES.variable:TYPES.number;
        else if(/[A-Za-z]/.test(c))face=n.style==='p'?TYPES.text:TYPES.variable;
        else if(/[\u03b1-\u03c9\u03d1\u03d5\u03f5]/.test(c))face=n.style==='p'?TYPES.text:TYPES.greek;
        else if(/[\u0391-\u03a9]/.test(c))face=n.style==='i'?TYPES.greek:TYPES.upperGreek;
        else face=TYPES.symbol;
        return char(cp,face);
      }).flat();
      case 'frac':{
        if(n.style==='skewed')return tmpl(11,2,[line(n.num,depth),line(n.den,depth)]);
        if(n.style==='noBar'){
          // MTEF has no dedicated no-bar fraction variation. Preserve numerator /
          // denominator as two editable, centered lines without inventing a bar.
          return [4,0,2,1,...line(n.num,depth),...line(n.den,depth),0];
        }
        return tmpl(11,0,[line(n.num,depth),line(n.den,depth)]);
      }
      case 'root':return tmpl(10,isEmpty(n.degree)?0:1,[line(n.body,depth),line(n.degree,depth+1)]);
      case 'script':{
        if(isEmpty(n.sub)&&isEmpty(n.sup))fail('EMPTY_SCRIPT','An empty script cannot be exported.');
        const selector=isEmpty(n.sub)?28:isEmpty(n.sup)?27:29;
        const script=tmpl(selector,n.pre?1:0,[line(n.sub,depth+1),line(n.sup,depth+1)]);
        return n.pre?[...script,...emit(n.base,depth)]:[...emit(n.base,depth),...script,10+Math.min(depth,2)];
      }
      case 'fence':{
        if(!n.left&&!n.right)return emit(n.body,depth);
        const selector=FENCES.findIndex(([l,r])=>(!n.left||l===n.left)&&(!n.right||r===n.right));
        if(selector<0)fail('UNSUPPORTED_FENCE','This delimiter pair is not qualified for MathType export.');
        return tmpl(selector,(n.left?1:0)|(n.right?2:0),[line(n.body,depth),
          ...(n.left?[char(n.left.codePointAt(0),22)]:[]),...(n.right?[char(n.right.codePointAt(0),22)]:[])]);
      }
      case 'nary':{
        const def=NARY[n.symbol];if(!def)fail('UNSUPPORTED_OPERATOR','Unknown large operator.');
        const v=(isEmpty(n.sub)?0:1)|(isEmpty(n.sup)?0:2)|(n.position==='undOvr'?64:0);
        return tmpl(def[0],v,[line(n.body,depth),line(n.sup,depth+1),line(n.sub,depth+1),char(def[1],22)]);
      }
      case 'groupChar':{
        const selector=n.chr==='\u23b4'||n.chr==='\u23b5'?25:24;
        const top=n.pos==='top';
        const glyph=n.chr==='\u23b4'?0xfe47:n.chr==='\u23b5'?0xfe48:top?0xfe37:0xfe38;
        return tmpl(selector,top?1:0,[line(n.body,depth),[1,1],char(glyph,22)]);
      }
      case 'borderBox':{
        let variation=0;
        if(n.hideLeft)variation|=2;
        if(n.hideRight)variation|=4;
        if(n.hideTop)variation|=8;
        if(n.hideBottom)variation|=16;
        if(n.strikeV)fail('UNSUPPORTED_BORDER_STRIKE','Vertical strike has no qualified native MTEF template.');
        const framed=tmpl(37,variation,[line(n.body,depth)]);
        const strikes=(n.strikeH?1:0)|(n.strikeBLTR?2:0)|(n.strikeTLBR?4:0);
        if(!strikes)return framed;
        if((strikes&1)&&(strikes&6))fail('UNSUPPORTED_BORDER_STRIKE','Horizontal and diagonal strikes cannot be combined in MTEF.');
        // StrikeBoxClass contains exactly one LINE, itself containing the box.
        // Close the inner box, the line, and the outer strike independently.
        return [3,0,36,strikes,0,1,0,...framed,0,0];
      }
      case 'matrix':{
        const rows=n.rows.length,cols=n.rows[0]?.length;
        if(!rows||!cols||rows>64||cols>64||rows*cols>1024||n.rows.some(r=>r.length!==cols))fail('INVALID_MATRIX','Invalid matrix cells.');
        const align={left:1,center:2,right:3}[n.align];if(!align)fail('INVALID_MATRIX','Unknown matrix alignment.');
        return [5,0,3,align,1,rows,cols,...new Array(Math.ceil((rows+1)/4)+Math.ceil((cols+1)/4)).fill(0),
          ...n.rows.flatMap(r=>r.flatMap(c=>line(c,depth))),0];
      }
      case 'rows':{
        if(!n.rows.length||n.rows.length>128)fail('INVALID_ROWS','Invalid multiline equation.');
        return [4,0,1,3,...n.rows.flatMap(r=>line(r,depth)),0];
      }
      case 'accent':{
        const map={'overbar':[13,0],'underbar':[12,0],'\u0305':[13,0],'\u00af':[13,0],'\u0302':[33,0],'\u005e':[33,0],
          '\u0303':[32,0],'~':[32,0],'\u20d7':[31,2],'\u2192':[31,2],'\u20d6':[31,1],'\u2190':[31,1]};
        const def=map[n.mark];if(!def)fail('UNSUPPORTED_ACCENT','Accent is not qualified for MathType export.');
        return tmpl(def[0],def[1],[line(n.body,depth),...(def[0]===31?[char(def[1]===1?0x20d6:0x20d7,22)]:[])]);
      }
      case 'limit':return tmpl(23,(isEmpty(n.sub)?0:1)|(isEmpty(n.sup)?0:2),[line(n.body,depth),line(n.sub,depth+1),line(n.sup,depth+1)]);
      default:fail('UNSUPPORTED_AST','Unknown AST node: '+n.k);
    }
  }
  const body=line(ast);
  // Producer application key identifies our writer, not a claim to be WIRIS.
  const stream=Uint8Array.from([5,1,0,7,0,...ascii('KTTTMT1'),0,display?0:1,...fontDefs,...prefs,
    9,101,...word((-Math.round(fontSizePt*32))&65535),...body,0]);
  if(stream.length>96*1024)fail('RESOURCE_LIMIT','MathType MTEF exceeds 96 KiB.');
  return stream;
}
