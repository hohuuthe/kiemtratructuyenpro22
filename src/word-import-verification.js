/**
 * Verification gate for Word -> question bank.
 * Never mutate the original source or silently "repair" an ambiguous formula.
 * All selected questions must be verified BEFORE the DB transaction begins.
 */
import katex from 'katex';
import {verifyMathTypeSource} from './word-mathtype-reader.js';
import 'katex/dist/contrib/mhchem.js';
import { Math as WordMath } from 'docx/math';
import { DOMParser } from '@xmldom/xmldom';
import { makeWordMathRun } from './exam-docx-generator.ts';
import { expandMhchemForWordMath, standaloneMhchemCommand, parseChemicalMath } from './word-editable-chemistry.js';
import { splitScientificContent } from './scientific-formula-tokenizer.js';
import { findIncompleteWordFractions } from './question-bank-docx-generator.ts';
import { WORD_FORMULA_TOKEN, WORD_IMPORT_ENGINE_VERSION, convertOmmlToLatex } from './word-omml-reader.js';

const FIELD_NAMES = ['content', 'answer'];
const optionText = option => typeof option === 'string' ? option : String(option?.text ?? '');
const allowedTypes = new Set(['4-1','TF4','SQ','TL']);
const allowedLevels = new Set(['NB','TH','VD','VDC']);
export function collectWordImportAnswerContinuation(lines,startIndex,type,initialAnswer='') {
    const source=Array.isArray(lines)?lines:[];
    const at=Number.isInteger(startIndex)&&startIndex>=0?startIndex:0;
    let answer=String(initialAnswer??'').trim();
    let answerImage=source[at]?.image||'';
    let nextIndex=at+1;
    const multiline=type==='TL'||(type==='SQ'&&!answer);
    if(!multiline) {
        if(!answerImage && nextIndex<source.length && !String(source[nextIndex]?.text||'').trim() && source[nextIndex]?.image) {
            answerImage=source[nextIndex].image;
            nextIndex++;
        }
        return {answer,answerImage,nextIndex};
    }
    const parts=answer?[answer]:[];
    while(nextIndex<source.length) {
        const text=String(source[nextIndex]?.text||'').trim();
        const structural=text.replace(/\[\[\/?(?:U|B)\]\]/g,'').trim();
        if(/^Câu\s*\d+[:.]?/i.test(structural)) break;
        if(text) parts.push(text);
        if(!answerImage && source[nextIndex]?.image) answerImage=source[nextIndex].image;
        nextIndex++;
    }
    return {answer:parts.join('\n').trim(),answerImage,nextIndex};
}

/** Answer grammar used by student TF4 grading: correct statement letters joined by &. */
export function normalizeWordImportAnswer(type, answer) {
    const raw = String(answer ?? '').trim();
    if (type === '4-1') {
        return /^[A-D]$/i.test(raw) ? {ok:true, value:raw.toUpperCase()} :
            {ok:false, reason:'Đáp án trắc nghiệm phải đúng một ký tự A, B, C hoặc D'};
    }
    if (type === 'TF4') {
        const compact = raw.toUpperCase().replace(/\s+/g,'');
        let letters;
        if (/^[ĐS]{4}$/.test(compact)) {
            letters = [...compact].flatMap((v,i)=>v==='Đ' ? ['ABCD'[i]] : []);
        } else if (/^[ABCD](?:[&,;][ABCD])*$/.test(compact)) {
            letters = compact.split(/[&,;]/);
        } else if (/^(?:NONE|KHÔNGCÓÝĐÚNG|----)$/.test(compact)) {
            letters = [];
        } else {
            return {ok:false,reason:'Đáp án Đúng/Sai phải là bốn ký tự Đ/S hoặc danh sách các ý đúng A&B'};
        }
        if (new Set(letters).size !== letters.length) return {ok:false,reason:'Đáp án Đúng/Sai bị lặp ý'};
        return {ok:true,value:letters.length ? letters.sort().join('&') : 'NONE'};
    }
    if (type === 'SQ' || type === 'TL')
        return raw ? {ok:true,value:raw} : {ok:false,reason:'Thiếu đáp án'};
    return {ok:false,reason:'Loại câu hỏi không hợp lệ'};
}
const markedTokens = s => [...String(s || '').matchAll(new RegExp(WORD_FORMULA_TOKEN.source,'g'))].map(x=>x[0]);
function exactOccurrences(text, value) {
    const positions=[];
    if(!value)return positions;
    for(let from=0;from<text.length;) {
        const at=text.indexOf(value,from);
        if(at<0)break;
        positions.push(at);
        from=at+value.length;
    }
    return positions;
}
// A Word paragraph may contain OLE formulas inside literal $...$ math.
function delimitedWordMathSpans(text) {
    const spans=[],tick=String.fromCharCode(96);
    const escaped=at=>{let n=0;for(let p=at-1;p>=0&&text[p]==='\\';p--)n++;return n%2===1;};
    let opening=-1,delimiter='';
    for(let i=0;i<text.length;) {
        if(escaped(i)){i++;continue;}
        if(text[i]===tick) {
            const mark=text.startsWith(tick.repeat(3),i)?tick.repeat(3):tick;
            const end=text.indexOf(mark,i+mark.length);
            if(end>=0){i=end+mark.length;continue;}
        }
        if(text[i]!=='$'){i++;continue;}
        if(opening<0){
            delimiter=text.startsWith('$$',i)?'$$':'$';
            opening=i+delimiter.length;i=opening;
        }else if(text.startsWith(delimiter,i)){
            spans.push({start:opening,end:i,value:text.slice(opening,i),mark:delimiter});
            i+=delimiter.length;opening=-1;delimiter='';
        }else i++;
    }
    return spans;
}
function sourceFormulaSpans(text, latexValues) {
    const expected=[...new Set(latexValues.filter(value=>typeof value==='string'&&value.length))]
        .sort((a,b)=>b.length-a.length);
    const candidates=[];
    for(const span of delimitedWordMathSpans(text))for(const latex of expected) {
        for(const pos of exactOccurrences(span.value,latex)){
            if(/\\[A-Za-z]+$/.test(latex)&&/[A-Za-z]/.test(span.value[pos+latex.length]||''))continue;
            const ownsDelimiter=span.value===latex;
            candidates.push({
                value:latex,
                // A standalone math span is replaced WITH its original $...$
                // delimiters. Composite OLE fragments replace only the inner
                // source text and retain their shared enclosing delimiter.
                start:ownsDelimiter?span.start-span.mark.length:span.start+pos,
                end:ownsDelimiter?span.end+span.mark.length:span.start+pos+latex.length,
                mark:ownsDelimiter?span.mark:''
            });
        }
    }
    candidates.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
    const chosen=[];
    for(const candidate of candidates){
        if(!chosen.some(x=>candidate.start<x.end && candidate.end>x.start))chosen.push(candidate);
    }
    return chosen.sort((a,b)=>a.start-b.start);
}
export function validateScientificLatexForImport(latex) {
    const value=String(latex ?? '').trim();
    if(!value) return {ok:false, reason:'Công thức LaTeX rỗng'};
    if(value.length > 9000) return {ok:false,reason:'Công thức dài bất thường'};
    if(findIncompleteWordFractions(value).length) return {ok:false,reason:'Thiếu tử số hoặc mẫu số'};
    if(/\\(?:begin|end)\{[^}]+\}/.test(value)) {
        const stack=[];
        for (const match of value.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
            if (match[1]==='begin') stack.push(match[2]);
            else if (stack.pop()!==match[2]) return {ok:false,reason:'Môi trường LaTeX mở/đóng không tương ứng'};
        }
        if(stack.length) return {ok:false,reason:'Môi trường LaTeX mở/đóng không tương ứng'};
    }
    try {
        if(/\\(?:ce|pu)\s*\{/.test(value)) {
            // KaTeX's mhchem registration is not reliable across bundlers;
            // the student renderer uses MathJax for chemistry. Validate the
            // exact syntax against the Word chemistry parser and expand it
            // losslessly for Office Math instead of rejecting valid \ce.
            const standalone=standaloneMhchemCommand(value);
            if(standalone?.kind==='ce') parseChemicalMath(standalone.body);
            expandMhchemForWordMath(value);
        } else {
            katex.renderToString(value,{throwOnError:true,strict:'warn',trust:false,output:'html'});
        }
    } catch(e) { return {ok:false,reason:'Bộ kiểm chứng công thức không nhận dạng: '+String(e?.message||e).slice(0,200)}; }
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

/** Verify that automatic approval still agrees with the original Office Math. */
export function validateWordFormulaSourceForImport(source) {
    if (!source || !['verified','manual_verified'].includes(source.status)) {
        return {ok:false,reason:'Nguồn Equation chưa được xác minh'};
    }
    const verdict=validateScientificLatexForImport(source.latex);
    if (!verdict.ok) return verdict;
    if (!['omml','embedded','mathtype'].includes(source.sourceType) ||
        typeof source.sourceOmml!=='string' || !source.sourceOmml.trim() ||
        source.sourceOmml.length>150000 || /<!DOCTYPE|<!ENTITY/i.test(source.sourceOmml)) {
        return {ok:false,reason:'Nguồn Equation gốc bị thiếu hoặc không hợp lệ'};
    }
    if(source.sourceType==='mathtype') {
        try {verifyMathTypeSource(source.sourceOmml,source.latex,source.status);return {ok:true};}
        catch(error) {return {ok:false,reason:'Không xác minh được nguồn MathType: '+String(error?.message||error).slice(0,180)};}
    }
    try {
        const errors=[];
        const xml=new DOMParser({onError(level,message){
            if(level==='error'||level==='fatalError') errors.push(message);
        }}).parseFromString(source.sourceOmml,'application/xml');
        const root=xml.documentElement;
        if(errors.length || !root || root.localName==='parsererror') throw new Error('XML gốc không hợp lệ');
        if(source.sourceType==='omml' &&
            (root.namespaceURI!=='http://schemas.openxmlformats.org/officeDocument/2006/math' ||
             !['oMath','oMathPara'].includes(root.localName))) {
            throw new Error('Nguồn không phải Office Math');
        }
        // An explicitly reviewed correction may intentionally differ from an
        // unsupported original. Automatic approval must match the converter.
        if(source.status==='verified' &&
            (source.sourceType!=='omml' || convertOmmlToLatex(root)!==String(source.latex).trim())) {
            throw new Error('LaTeX không khớp với nguồn Office Math đã xác minh');
        }
    } catch(error) {
        return {ok:false,reason:'Không xác minh được nguồn Equation: '+String(error?.message||error).slice(0,180)};
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
    const tokenUseCounts=new Map();
    const questions=rawQuestions.map((original,index)=>{
        const q={...original,options:original.options && typeof original.options==='object'
            ? JSON.parse(JSON.stringify(original.options)) : {}};
        const issues=[],sources=[];
        if(!allowedTypes.has(q.type)) issues.push({field:'type',reason:'Loại câu hỏi không hợp lệ: '+q.type});
        if(!allowedLevels.has(q.level)) issues.push({field:'level',reason:'Mức độ không hợp lệ: '+q.level});
        forEachField(q,(field,text,write)=>{
            const existingMath=delimitedWordMathSpans(text);
            let normalized=text.replace(new RegExp(WORD_FORMULA_TOKEN.source,'g'), (token,at)=>{
                const record=originalRecords.get(token);
                usedTokens.add(token);
                tokenUseCounts.set(token,(tokenUseCounts.get(token)||0)+1);
                if(!record) {
                    issues.push({field,reason:'Không tìm thấy công thức trong dữ liệu Word gốc',token});
                    return token;
                }
                // Do the same provenance check used by the API at the time
                // of import, not only at Save. A pretty preview is not proof
                // that the editable Word source will pass server validation.
                const verdict=record.status==='parsed' ? validateWordFormulaSourceForImport({
                    status:'verified',sourceType:record.sourceType||'omml',
                    sourceOmml:record.originalOmml||'',latex:record.latex||''
                }) : {ok:false,reason:record.reason||'Nguồn Equation chưa hỗ trợ'};
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
                const inside=existingMath.some(span=>at>=span.start && at+token.length<=span.end);
                return inside ? record.latex : '$'+record.latex+'$';
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
    const repeated=[...tokenUseCounts.entries()].filter(([,n])=>n>1).map(([token])=>token);
    // Formula-specific diagnostics live on the actual question and can be
    // resolved there; document-wide blockers are only structural/media issues.
    const documentIssues=[...(documentReport?.issues||[]).filter(issue=>issue.kind!=='formula' && issue.kind!=='formula-notice')];
    if(unmatched.length)documentIssues.push({kind:'formula',reason:'Công thức Word không được gắn vào câu hỏi: '+unmatched.join(', ')});
    if(repeated.length)documentIssues.push({kind:'structure',reason:'Một Equation Word bị gán cho nhiều câu hỏi/đáp án: '+repeated.join(', ')});
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

/** Apply an explicit, teacher-entered conversion to one original OMML token. */
export function correctImportedWordEquation(q, sourceToken, editedLatex) {
    const matches=(q?.__wordFormulaSources||[]).filter(x=>x.token===sourceToken);
    if(matches.length!==1)throw new Error('Không xác định được duy nhất nguồn Equation Word cần sửa');
    const source=matches[0];
    const verdict=validateScientificLatexForImport(editedLatex);
    if(!verdict.ok)throw new Error(verdict.reason);
    let targetField=source.field,oldValue,set;
    if(targetField==='content'||targetField==='answer') {
        oldValue=String(q[targetField]||'');
        set=value=>{q[targetField]=value;};
    } else if(/^option\.[A-D]$/.test(targetField)) {
        const key=targetField.split('.')[1],choice=q.options?.[key];
        oldValue=optionText(choice);
        set=value=>{
            if(typeof choice==='string')q.options[key]=value;
            else q.options[key]={...choice,text:value};
        };
    } else throw new Error('Trường công thức Word không hợp lệ: '+targetField);
    const tokenPositions=exactOccurrences(oldValue,sourceToken);
    let original=sourceToken,position,delimiter='$';
    if(tokenPositions.length) {
        if(tokenPositions.length!==1)throw new Error('Mã Equation xuất hiện ở nhiều vị trí: '+sourceToken);
        position=tokenPositions[0];
    } else {
        if(!source.latex || !['verified','manual_verified'].includes(source.status)) {
            throw new Error('Không còn mã Equation ở vị trí gốc: '+sourceToken);
        }
        const spans=sourceFormulaSpans(oldValue,[source.latex]);
        const peers=(q.__wordFormulaSources||[]).filter(other=>other.field===targetField &&
            other.latex===source.latex && ['verified','manual_verified'].includes(other.status));
        // Equal equations retain the source order within their field. A
        // missing or additional occurrence makes the target ambiguous.
        if(spans.length!==peers.length) {
            throw new Error('Không xác định chắc vị trí Equation gốc cần sửa: '+sourceToken);
        }
        const span=spans[peers.indexOf(source)];
        if(!span)throw new Error('Không còn Equation ở vị trí gốc: '+sourceToken);
        position=span.start;
        original=oldValue.slice(span.start,span.end);
        delimiter=span.mark;
    }
    set(oldValue.slice(0,position)+delimiter+String(editedLatex).trim()+delimiter+oldValue.slice(position+original.length));
    source.latex=String(editedLatex).trim();
    source.status='manual_verified';
    source.reason='';
    q.__wordImportIssues=(q.__wordImportIssues||[]).filter(x=>x.token!==sourceToken);
    q.__wordReviewed=true;
    return q;
}

export function checkWordImportBeforeSave(questions, documentIssues = []) {
    const errors = [];
    if (!Array.isArray(questions) || questions.length === 0) {
        return {ok:false, errors:['Không có câu hỏi để lưu'], questionCount:0};
    }
    if (documentIssues?.length) {
        errors.push('Tài liệu còn '+documentIssues.length+' vấn đề cấu trúc hoặc hình ảnh chưa xử lý.');
    }
    const ids = new Set();
    const sourceTokens = new Set();
    questions.forEach((q, i) => {
        const where = 'Câu '+(i+1);
        if (!q || typeof q !== 'object') {errors.push(where+': bản ghi không hợp lệ'); return;}
        if (!q.id || ids.has(String(q.id))) errors.push(where+': thiếu hoặc trùng ID câu hỏi');
        ids.add(String(q.id));
        if (!String(q.content||'').trim()) errors.push(where+': thiếu nội dung');
        if (!allowedTypes.has(q.type) || !allowedLevels.has(q.level)) errors.push(where+': phân loại không hợp lệ');
        const answerVerdict = normalizeWordImportAnswer(q.type, q.answer);
        if (!answerVerdict.ok || answerVerdict.value !== String(q.answer??'').trim())
            errors.push(where+': '+(answerVerdict.reason || 'Đáp án chưa được chuẩn hóa đúng quy tắc chấm điểm'));
        if (q.type === '4-1' || q.type === 'TF4') {
            for (const letter of ['A','B','C','D']) {
                if (!optionText(q.options?.[letter]).trim() && !q.options?.[letter]?.image) errors.push(where+': thiếu phương án '+letter);
            }
        }
        const fieldTexts=[['content',String(q.content||'')],['answer',String(q.answer||'')],
            ...['A','B','C','D'].map(letter=>['option.'+letter,optionText(q.options?.[letter])])];
        const texts=fieldTexts.map(([,value])=>value);
        const text=texts.join('\n');
        if (markedTokens(text).length) errors.push(where+': vẫn còn công thức Word chưa chuyển đổi');
        for (const frac of findIncompleteWordFractions(text)) errors.push(where+': LaTeX thiếu tử/mẫu '+frac.slice(0,80));
        const formulaCounts=new Map();
        for (const [fieldName,fieldText] of fieldTexts) {
            const counts=new Map();
            formulaCounts.set(fieldName,counts);
            const sourceLatexes=(q.__wordFormulaSources||[]).filter(source=>source?.field===fieldName).map(source=>source.latex);
            for(const span of sourceFormulaSpans(fieldText,sourceLatexes)) {
                counts.set(span.value,(counts.get(span.value)||0)+1);
            }
            for (const fragment of splitScientificContent(fieldText)) {
                if (fragment.type !== 'math') continue;
                const verdict=validateScientificLatexForImport(fragment.value);
                if (!verdict.ok) errors.push(where+': '+verdict.reason);
            }
        }
        if (q.__wordImportIssues?.length && !q.__wordReviewed) {
            errors.push(where+': còn '+q.__wordImportIssues.length+' vấn đề chưa được người dùng duyệt');
        }
        for (const source of q.__wordFormulaSources || []) {
            if (!source?.token || sourceTokens.has(source.token)) {
                errors.push(where+': công thức Word gốc bị trùng hoặc thiếu mã'); continue;
            }
            sourceTokens.add(source.token);
            if (!['verified','manual_verified'].includes(source.status)) {
                errors.push(where+': Equation Word gốc chưa chuyển đổi: '+source.token); continue;
            }
            const location = source.field === 'content' ? String(q.content||'')
                : source.field === 'answer' ? String(q.answer||'')
                : /^option\.[A-D]$/.test(source.field) ? optionText(q.options?.[source.field.split('.')[1]]) : '';
            const counts=formulaCounts.get(source.field),remaining=counts?.get(source.latex)||0;
            if (!source.latex || remaining<1) {
                errors.push(where+': công thức Equation khác nội dung đã được kiểm chứng '+source.token);
            } else counts.set(source.latex,remaining-1);
            const valid=validateWordFormulaSourceForImport(source);
            if (!valid.ok) errors.push(where+': công thức '+source.token+
                ' ('+source.field+') không đạt kiểm tra nguồn Word: '+valid.reason);
        }
    });
    return {ok:errors.length===0,errors,questionCount:questions.length};
}

