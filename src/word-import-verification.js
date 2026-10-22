/**
 * Verification gate for Word -> question bank.
 * Never mutate the original source or silently "repair" an ambiguous formula.
 * All selected questions must be verified BEFORE the DB transaction begins.
 */
import katex from 'katex';
import 'katex/dist/contrib/mhchem.js';
import { Math as WordMath } from 'docx/math';
import { makeWordMathRun } from './exam-docx-generator.ts';
import { splitScientificContent } from './scientific-formula-tokenizer.js';
import { findIncompleteWordFractions } from './question-bank-docx-generator.ts';
import { WORD_FORMULA_TOKEN, WORD_IMPORT_ENGINE_VERSION } from './word-omml-reader.js';

const FIELD_NAMES = ['content', 'answer'];
const optionText = option => typeof option === 'string' ? option : String(option?.text ?? '');
const allowedTypes = new Set(['4-1','TF4','SQ','TL']);
const allowedLevels = new Set(['NB','TH','VD','VDC']);
const markedTokens = s => [...String(s || '').matchAll(new RegExp(WORD_FORMULA_TOKEN.source,'g'))].map(x=>x[0]);
export function validateScientificLatexForImport(latex) {
    const value=String(latex ?? '').trim();
    if(!value) return {ok:false, reason:'Công thức LaTeX rỗng'};
    if(value.length > 9000) return {ok:false,reason:'Công thức dài bất thường'};
    if(findIncompleteWordFractions(value).length) return {ok:false,reason:'Thiếu tử số hoặc mẫu số'};
    if(/\\(?:begin|end)\{[^}]+\}/.test(value)) {
        const opens=[...value.matchAll(/\\begin\{([^}]+)\}/g)].map(x=>x[1]);
        const closes=[...value.matchAll(/\\end\{([^}]+)\}/g)].map(x=>x[1]);
        if(JSON.stringify(opens.slice().reverse()) !== JSON.stringify(closes)) {
            return {ok:false,reason:'Môi trường LaTeX mở/đóng không tương ứng'};
        }
    }
    try {
        katex.renderToString(value,{throwOnError:true,strict:'warn',trust:false,output:'html'});
    } catch(e) { return {ok:false,reason:'KaTeX không nhận dạng: '+String(e?.message||e).slice(0,200)}; }
    // A formula that renders on-screen but cannot round-trip to native
    // Office Math is held for explicit review rather than approved by guess.
    try {
        if(!(makeWordMathRun(value) instanceof WordMath)) {
            return {ok:false,reason:'Bộ xuất Word chưa tạo được Equation chỉnh sửa cho công thức này'};
        }
    } catch(e) {
        return {ok:false,reason:'Kiểm chứng Equation Word thất bại: '+String(e?.message||e).slice(0,180)};
    }
    return {ok:true};
}
function forEachField(q, fn) {
    for(const field of FIELD_NAMES) fn(field, String(q[field]||''), next => {q[field]=next;});
    if(q.options && typeof q.options==='object') {
        for(const key of ['A','B','C','D']) {
            const old=q.options[key];
            if(old === undefined) continue;
            const current=optionText(old);
            fn('option.'+key,current,next => {
                if(typeof old==='string') q.options[key]=next;
                else q.options[key]={...old,text:next};
            });
        }
    }
}
/**
 * Accepts parser's original equations and existing question-parser output.
 * Any unsupported/unmatched formula leaves question.__wordImportIssues and
 * blocks saving until teacher explicitly changes/approves the source.
 */
export function verifyImportedWordQuestions(rawQuestions, documentReport) {
    if(!Array.isArray(rawQuestions)) throw new Error('Không có danh sách câu hỏi hợp lệ');
    const originalRecords=new Map((documentReport?.formulas||[]).map(f=>[f.token,f]));
    const usedTokens=new Set();
    const questions=rawQuestions.map((original,index)=>{
        const q={...original,options:original.options && typeof original.options==='object'
            ? JSON.parse(JSON.stringify(original.options)) : {}};
        const issues=[],sources=[];
        if(!allowedTypes.has(q.type)) issues.push({field:'type',reason:'Loại câu hỏi không hợp lệ: '+q.type});
        if(!allowedLevels.has(q.level)) issues.push({field:'level',reason:'Mức độ không hợp lệ: '+q.level});
        forEachField(q,(field,text,write)=>{
            let normalized=text.replace(new RegExp(WORD_FORMULA_TOKEN.source,'g'), token=>{
                const record=originalRecords.get(token);
                usedTokens.add(token);
                if(!record) {
                    issues.push({field,reason:'Không tìm thấy công thức trong dữ liệu Word gốc',token});
                    return token;
                }
                const verdict=record.status==='parsed' ? validateScientificLatexForImport(record.latex)
                    : {ok:false,reason:record.reason||'Nguồn Equation chưa hỗ trợ'};
                sources.push({
                    token,field,sourceType:record.sourceType||'omml',
                    sourceOmml:record.originalOmml||'',latex:record.latex||'',
                    status:verdict.ok?'verified':'review',
                    reason:verdict.ok?'':verdict.reason,
                    engineVersion:WORD_IMPORT_ENGINE_VERSION
                });
                if(!verdict.ok) {
                    issues.push({field,token,reason:verdict.reason,original:record.originalOmml});
                    return token;
                }
                return '$'+record.latex+'$';
            });
            for(const expr of findIncompleteWordFractions(normalized)) {
                issues.push({field,reason:'Công thức LaTeX thiếu đối số; không tự điền',original:expr});
            }
            for(const token of splitScientificContent(normalized)) {
                if(token.type!=='math') continue;
                const verdict=validateScientificLatexForImport(token.value);
                if(!verdict.ok && !issues.some(x=>x.field===field && x.reason===verdict.reason)) {
                    issues.push({field,reason:verdict.reason,original:token.value});
                }
            }
            write(normalized);
        });
        // Each formula token may appear only once. Duplicates indicate a
        // damaged question segmentation and need manual review.
        const fieldTokens=sources.map(s=>s.token);
        if(new Set(fieldTokens).size!==fieldTokens.length) issues.push({field:'structure',reason:'Công thức Word bị gán lặp giữa các trường'});
        q.__wordFormulaSources=sources;
        q.__wordImportIssues=issues;
        q.__wordReviewed=false;
        q.__wordSourceIndex=index+1;
        return q;
    });
    const unmatched=[...originalRecords.keys()].filter(token=>!usedTokens.has(token));
    const documentIssues=[...(documentReport?.issues||[])];
    if(unmatched.length)documentIssues.push({kind:'formula',reason:'Công thức Word không được gắn vào câu hỏi: '+unmatched.join(', ')});
    return {
        questions, documentIssues,
        stats:{
            totalQuestions:questions.length,
            totalFormulaObjects:originalRecords.size,
            verifiedFormulaObjects:questions.flatMap(q=>q.__wordFormulaSources).filter(x=>x.status==='verified').length,
            pendingQuestions:questions.filter(q=>q.__wordImportIssues.length).length,
            documentIssues:documentIssues.length
        }
    };
}
/** Validate manual edits and require explicit acknowledgement of exceptions. */
export function checkWordImportBeforeSave(questions, documentIssues = []) {
    const errors=[];
    if(!Array.isArray(questions)||!questions.length)errors.push('Không có câu hỏi để lưu');
    if(documentIssues.length)errors.push('Tài liệu còn '+documentIssues.length+' vấn đề về cấu trúc, hình ảnh hoặc công thức chưa được xử lý.');
    const ids=new Set();
    (questions||[]).forEach((q,i)=>{
        const where='Câu '+(i+1);
        if(!q.id || ids.has(String(q.id)))errors.push(where+': thiếu hoặc trùng ID câu hỏi');
        ids.add(String(q.id));
        if(!q.content?.trim())errors.push(where+': thiếu nội dung câu hỏi');
        if(!allowedTypes.has(q.type)||!allowedLevels.has(q.level))errors.push(where+': phân loại không hợp lệ');
        if(!q.answer?.trim())errors.push(where+': thiếu đáp án');
        if(q.type==='4-1'||q.type==='TF4') {
            for(const key of ['A','B','C','D']) if(!optionText(q.options?.[key]).trim()) errors.push(where+': thiếu phương án '+key);
        }
        const text=[String(q.content||''),String(q.answer||''),...['A','B','C','D'].map(k=>optionText(q.options?.[k]))].join('\n');
        if(markedTokens(text).length)errors.push(where+': vẫn còn công thức Word chưa chuyển đổi');
        for(const expr of findIncompleteWordFractions(text)) errors.push(where+': LaTeX thiếu tử/mẫu '+expr.slice(0,60));
        for(const token of splitScientificContent(text)){
            if(token.type!=='math')continue;
            const v=validateScientificLatexForImport(token.value);
            if(!v.ok)errors.push(where+': '+v.reason);
        }
        if(q.__wordImportIssues?.length && !q.__wordReviewed)errors.push(where+': cần xác nhận sau khi chỉnh sửa '+q.__wordImportIssues.length+' lỗi');
        if(q.__wordFormulaSources?.some(x=>x.status==='review') && !q.__wordReviewed)errors.push(where+': có công thức gốc chưa được duyệt');
        // A reviewed exception must still be replaced by a valid editable
        // equation. Never allow a teacher to approve an unresolved token.
    });
    return {ok:!errors.length,errors,questionCount:questions?.length||0};
}
