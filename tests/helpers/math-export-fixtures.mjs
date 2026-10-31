import JSZip from 'jszip';
const M='http://schemas.openxmlformats.org/officeDocument/2006/math';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const escape=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export const run=(text,style)=>'<m:r>'+(style?'<m:rPr><m:sty m:val="'+style+'"/></m:rPr>':'')+'<m:t>'+escape(text)+'</m:t></m:r>';
export const arg=(key,body)=>'<m:'+key+'>'+body+'</m:'+key+'>';
export const fraction=(a,b)=>'<m:f>'+arg('num',a)+arg('den',b)+'</m:f>';
export const script=(base,sub='',sup='',pre=false)=>{const tag=pre?'sPre':sub&&sup?'sSubSup':sub?'sSub':'sSup';return '<m:'+tag+'>'+arg('e',base)+(sub||pre?arg('sub',sub):'')+(sup||pre?arg('sup',sup):'')+'</m:'+tag+'>';};
export const radical=(base,deg='')=>'<m:rad>'+arg('deg',deg)+arg('e',base)+'</m:rad>';
export const delimiter=(body,left='(',right=')')=>'<m:d><m:dPr><m:begChr m:val="'+escape(left)+'"/><m:endChr m:val="'+escape(right)+'"/></m:dPr>'+arg('e',body)+'</m:d>';
export const nary=(symbol,body,lower='',upper='',position='undOvr')=>'<m:nary><m:naryPr><m:chr m:val="'+symbol+'"/><m:limLoc m:val="'+position+'"/></m:naryPr>'+arg('e',body)+arg('sub',lower)+arg('sup',upper)+'</m:nary>';
export const matrix=rows=>'<m:m>'+rows.map(row=>'<m:mr>'+row.map(c=>arg('e',c)).join('')+'</m:mr>').join('')+'</m:m>';
export const math=body=>'<m:oMath xmlns:m="'+M+'" xmlns:w="'+W+'">'+body+'</m:oMath>';
export const corpus=[
  ['fraction',fraction(run('a+b'),run('c-d'))],
  ['nested-fraction',fraction(run('1'),run('1+')+fraction(run('1'),run('x')))],
  ['superscript',script(run('x'),'',run('2'))],
  ['subscript',script(run('a'),run('n+1'))],
  ['subsup',script(run('x'),run('n+1'),run('2'))],
  ['prescript',script(run('U'),run('92'),run('235'),true)],
  ['square-root',radical(run('x+1'))],
  ['cube-root',radical(run('x+1'),run('3'))],
  ['nested-root',radical(run('1+')+radical(run('2+')+radical(run('3'))))],
  ['sum',nary('\u2211',script(run('i'),'',run('2')),run('i=1'),run('n'))],
  ['product',nary('\u220f',run('i'),run('i=1'),run('n'))],
  ['integral',nary('\u222b',script(run('x'),'',run('2')),run('0'),run('1'),'subSup')],
  ['double-integral',nary('\u222c',run('xy'),run('D'),'','subSup')],
  ['triple-integral',nary('\u222d',run('1'),run('V'),'','subSup')],
  ['contour-integral',nary('\u222e',run('f'),run('C'),'','subSup')],
  ['derivative',fraction(run('dy'),run('dx'))+run('=')+script(run('3x'),'',run('2'))],
  ['limit','<m:limLow>'+arg('e',run('lim','p'))+arg('lim',run('x\u21920'))+'</m:limLow>'+fraction(run('sinx','p'),run('x'))],
  ['greek',script(run('\u03b1'),'',run('2'))+run('+')+script(run('\u03b2'),'',run('2'))+run('=')+script(run('\u03b3'),'',run('2'))],
  ['set-symbols',run('\u2207f=\u2202f/\u2202x;A\u2229B\u2286A\u222aB')],
  ['chemistry',script(run('H','p'),run('2'))+run('SO','p')+script(run('','p'),run('4'))],
  ['ion',script(run('Ca','p'),'',run('2+'))+run('+')+script(run('Cl','p'),'',run('-'))],
  ['vector','<m:acc><m:accPr><m:chr m:val="\u20d7"/></m:accPr>'+arg('e',run('AB'))+'</m:acc>'],
  ['overbar','<m:bar>'+arg('e',run('x'))+'</m:bar>'],
  ['underline','<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>'+arg('e',run('AB'))+'</m:bar>'],
  ['widehat','<m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr>'+arg('e',run('ABC'))+'</m:acc>'],
  ['matrix',matrix([[run('1'),run('2')],[run('3'),run('4')]])],
  ['pmatrix',delimiter(matrix([[run('1'),run('0'),run('2')],[run('0'),run('1'),run('3')],[run('4'),run('5'),run('6')]]))],
  ['determinant',delimiter(matrix([[run('a'),run('b')],[run('c'),run('d')]]),'|','|')],
  ['cases',delimiter('<m:eqArr>'+arg('e',run('2x+y=5'))+arg('e',run('x-y=1'))+'</m:eqArr>','{','')],
  ['bold-vector',run('v','bi')+run('=')+delimiter(run('1,2'))],
  ['literal-braces',run('{x|0\u2264x\u22641}')],
  ['energy',run('E=m')+script(run('c'),'',run('2'))]
];
export async function makeDocx(items=corpus,{header=false,display=false,contentTypes=true}={}){
  const z=new JSZip();
  if(contentTypes)z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  const paragraphs=items.map(([id,body],i)=>display?
    '<w:p><m:oMathPara>'+math(body)+'</m:oMathPara></w:p>':
    '<w:p><w:r><w:t>Question '+(i+1)+' '+escape(id)+': </w:t></w:r>'+math(body)+'<w:r><w:t> Answer A.</w:t></w:r></w:p>').join('');
  z.file('word/document.xml','<w:document xmlns:w="'+W+'" xmlns:m="'+M+'"><w:body>'+paragraphs+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:bottom="1134" w:left="1134" w:right="1134"/></w:sectPr></w:body></w:document>');
  z.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  if(header)z.file('word/header1.xml','<w:hdr xmlns:w="'+W+'" xmlns:m="'+M+'"><w:p>'+math(run('h'))+'</w:p></w:hdr>');
  return new Blob([await z.generateAsync({type:'uint8array'})],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
