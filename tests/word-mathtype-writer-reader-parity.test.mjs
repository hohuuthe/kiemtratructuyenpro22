import test from 'node:test';
import assert from 'node:assert/strict';
import {astToMtef} from '../src/word-mathtype-export/mtef-writer.js';
import {convertMtefV5ToLatex} from '../src/word-mtef-v5-reader.js';

const seq=(...items)=>({k:'seq',items});
const word=text=>({k:'text',text,style:'auto'});
const cases=[
    ['left subscripts and superscripts',
        {k:'script',pre:true,base:word('U'),sub:word('92'),sup:word('235')},
        '{}_{92}^{235}U'],
    ['left superscript',
        {k:'script',pre:true,base:word('A'),sub:seq(),sup:word('2')},
        '{}^{2}A'],
    ['left subscript',
        {k:'script',pre:true,base:word('A'),sub:word('3'),sup:seq()},
        '{}_{3}A'],
    ['fraction without bar',{k:'frac',style:'noBar',num:word('a'),den:word('b')},
        '\\begin{array}{c}a\\\\b\\end{array}'],
    ['boxed expression',{k:'borderBox',body:word('x+1'),
        hideTop:false,hideBottom:false,hideLeft:false,hideRight:false,
        strikeH:false,strikeV:false,strikeBLTR:false,strikeTLBR:false},
        '\\boxed{x+1}'],
    ['top brace',{k:'groupChar',chr:'\u23de',pos:'top',body:word('x+y')},
        '\\overbrace{x+y}'],
    ['bottom brace',{k:'groupChar',chr:'\u23df',pos:'bot',body:word('x+y')},
        '\\underbrace{x+y}'],
    ['top bracket',{k:'groupChar',chr:'\u23b4',pos:'top',body:word('x+y')},
        '\\overbracket{x+y}'],
    ['bottom bracket',{k:'groupChar',chr:'\u23b5',pos:'bot',body:word('x+y')},
        '\\underbracket{x+y}'],
    ['lower limit',{k:'limit',body:word('x'),sub:word('0'),sup:seq()},
        '\\underset{0}{x}'],
    ['upper limit',{k:'limit',body:word('x'),sub:seq(),sup:word('1')},
        '\\overset{1}{x}'],
    ['both limits',{k:'limit',body:word('x'),sub:word('0'),sup:word('1')},
        '\\overset{1}{\\underset{0}{x}}'],
];
for(const [name,ast,expected] of cases){
    test('MathType writer-reader parity: '+name,()=>{
        const encoded=astToMtef(ast);
        assert.equal(convertMtefV5ToLatex(encoded),expected);
    });
}
test('A box with selectively hidden borders remains unsupported rather than silently gaining edges',()=>{
    const box={...cases[0][1],hideTop:true};
    const encoded=astToMtef(box);
    assert.throws(()=>convertMtefV5ToLatex(encoded),/unsupported template/);
});
test('A damaged group-ornament glyph is rejected instead of guessed',()=>{
    const encoded=astToMtef(cases[1][1]);
    const altered=Uint8Array.from(encoded);
    const location=altered.findIndex((v,i)=>i>35 && v===0x37 && altered[i+1]===0xfe);
    assert.ok(location>0,'Expected fixed horizontal-brace ornament glyph');
    altered[location]=0x38;
    assert.throws(()=>convertMtefV5ToLatex(altered),/glyph mismatch/);
});
