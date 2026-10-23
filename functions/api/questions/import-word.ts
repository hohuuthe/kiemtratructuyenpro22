/**
 * Verified Word question import: one Neon HTTP transaction per complete file.
 * Uses ONLY the existing questions table and does not modify database schema.
 * Invalid/ambiguous OMML is rejected before persistence.
 */
import { neon } from '@neondatabase/serverless';
import { verifyJWT, getDynamicSecret, getDatabase } from '../exam/utils';
import { checkWordImportBeforeSave, validateWordFormulaSourceForImport, normalizeWordImportAnswer } from '../../../src/word-import-verification.js';

interface Env { NEON_DATABASE_URL?: string; DATABASE_URL?: string; JWT_SECRET?: string; }
const headers = {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
    'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const reply = (value:any,status=200)=>new Response(JSON.stringify(value),{status,headers});
export const onRequestOptions:PagesFunction<Env> = async()=>new Response(null,{status:204,headers});
export const MAX_WORD_IMPORT_QUESTIONS=400;
const MAX_BODY=6*1024*1024;

export function validateBatchPayload(body:any) {
    const errors:string[]=[];
    const questions=body?.questions;
    if(!Array.isArray(questions)||!questions.length||questions.length>MAX_WORD_IMPORT_QUESTIONS) {
        errors.push('Một lượt Import phải chứa từ 1 đến '+MAX_WORD_IMPORT_QUESTIONS+' câu hỏi.');
        return errors;
    }
    if(typeof body.batchId!=='string'||!/^[0-9a-z-]{12,80}$/i.test(body.batchId)) errors.push('Mã phiên import không hợp lệ');
    if(typeof body.fileName!=='string'||!body.fileName.toLowerCase().endsWith('.docx')||body.fileName.length>260)errors.push('Tên file Word không hợp lệ');
    if(typeof body.sourceSha256!=='string'||!/^[0-9a-f]{64}$/i.test(body.sourceSha256))errors.push('SHA-256 file Word không hợp lệ');
    const ids=new Set<string>();
    for(let i=0;i<questions.length;i++) {
        const q=questions[i], label='Câu '+(i+1);
        if(!q||typeof q!=='object'){errors.push(label+': dữ liệu trống');continue;}
        if(typeof q.id!=='string'||q.id.length<8||q.id.length>100||ids.has(q.id))errors.push(label+': ID thiếu hoặc trùng');
        ids.add(String(q.id||''));
        if(!['4-1','TF4','SQ','TL'].includes(q.type)||!['NB','TH','VD','VDC'].includes(q.level))errors.push(label+': phân loại không hợp lệ');
        if(typeof q.content!=='string'||!q.content.trim()||q.content.length>40000)errors.push(label+': nội dung trống hoặc quá dài');
        if(typeof q.answer!=='string'||q.answer.length>30000)errors.push(label+': đáp án không hợp lệ hoặc quá dài');
        const answerVerdict=normalizeWordImportAnswer(q.type,q.answer);
        if(!answerVerdict.ok||answerVerdict.value!==q.answer)errors.push(label+': '+(answerVerdict.reason||'Đáp án không đúng chuẩn chấm điểm'));
        if(typeof q.lesson!=='string'||q.lesson.length>200)errors.push(label+': tên bài không hợp lệ');
        if(q.image && (typeof q.image!=='string'||q.image.length>1000000))errors.push(label+': ảnh không hợp lệ');
        const opts=q.options||{};
        if(typeof opts!=='object'||Array.isArray(opts))errors.push(label+': lựa chọn không hợp lệ');
        if(['4-1','TF4'].includes(q.type) && ['A','B','C','D'].some(letter=>{
            const val=opts[letter];
            return !val||!(typeof val==='string'?val:val.text||val.image);
        }))errors.push(label+': thiếu phương án A–D');
        const allContent=[q.content,q.answer,...['A','B','C','D'].map(letter=>{
            const val=opts[letter];
            return typeof val==='string'?val:(val?.text||'');
        })].join(' ');
        if(/__WMATH_\d{6}__/.test(allContent))errors.push(label+': vẫn còn công thức Word chưa xác minh');
        if(q.reviewPending || (Array.isArray(q.importIssues)&&q.importIssues.length))errors.push(label+': chưa hoàn tất kiểm duyệt');
        if(!Array.isArray(q.formulaSources)||q.formulaSources.length>200)errors.push(label+': metadata công thức không hợp lệ');
        const seenTokens=new Set<string>();
        for(const src of Array.isArray(q.formulaSources)?q.formulaSources:[]) {
            if(!src||!['verified','manual_verified'].includes(src.status)||
               typeof src.field!=='string'||!['content','answer','option.A','option.B','option.C','option.D'].includes(src.field)||
               typeof src.sourceOmml!=='string'||src.sourceOmml.length>150000||
               typeof src.latex!=='string'||!src.latex||src.latex.length>9000||
               typeof src.token!=='string'||!/^__WMATH_[0-9]{6}__$/.test(src.token)){
                errors.push(label+': metadata công thức chưa được xác minh');
                continue;
            }
            const location=src.field==='content'?q.content:
                src.field==='answer'?q.answer:
                (typeof opts[src.field.slice(-1)]==='string'
                    ?opts[src.field.slice(-1)]
                    :opts[src.field.slice(-1)]?.text)||'';
            if(seenTokens.has(src.token))errors.push(label+': mã công thức gốc bị lặp: '+src.token);
            seenTokens.add(src.token);
            if(!String(location).includes('$'+src.latex+'$')) {
                errors.push(label+': công thức đã xác minh không có trong trường '+src.field);
            }
        }
        if(errors.length>25)break;
    }
    // The server repeats the same verification as the preview. A status sent
    // by a client is not evidence that the final LaTeX or its provenance is valid.
    if (!errors.length) {
        const checked = checkWordImportBeforeSave(questions.map((q:any) => ({
            ...q,
            __wordFormulaSources:q.formulaSources,
            __wordImportIssues:q.importIssues || [],
            __wordReviewed:false
        })), []);
        errors.push(...checked.errors.slice(0,26));
        for (let i=0;i<questions.length && errors.length<26;i++) {
            for (const source of questions[i].formulaSources) {
                const verdict=validateWordFormulaSourceForImport(source);
                if (!verdict.ok) errors.push('Câu '+(i+1)+': '+verdict.reason);
                if (errors.length>=26) break;
            }
        }
    }
    return errors;
}
/**
 * Schema-neutral Word import. Source OMML is verified on the server BEFORE
 * persistence; only finalized content/answer/options are written to the
 * EXISTING questions table. This does not create any table, index or column.
 *
 * Stable per-teacher/per-file IDs make retry after an unknown commit outcome
 * idempotent even without a batch/audit table.
 */
export async function deriveWordImportIds(userId:string, sourceSha256:string, count:number) {
    if (!userId || !/^[0-9a-f]{64}$/i.test(sourceSha256) ||
        !Number.isInteger(count) || count<1 || count>MAX_WORD_IMPORT_QUESTIONS) {
        throw new Error('Không thể tạo ID nhập Word từ thông tin nguồn không hợp lệ');
    }
    const input='verified-word-import-v2\u0000'+userId+'\u0000'+sourceSha256.toLowerCase();
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)));
    const prefix=Array.from(hash).map(value=>value.toString(16).padStart(2,'0')).join('').slice(0,40);
    return Array.from({length:count},(_,i)=>'wi-'+prefix+'-'+String(i+1).padStart(4,'0'));
}
class WordImportConflict extends Error {
    code='WORD_IMPORT_CONFLICT';
}
function canonicalWordQuestions(body:any,userId:string,ids:string[]) {
    return body.questions.map((q:any,index:number)=>({
        id:ids[index],type:q.type,level:q.level,lesson:q.lesson,content:q.content,
        options:q.options||{},answer:q.answer,image:q.image||null,creator_id:userId
    }));
}
const readImportedQuestionsQuery = `
    WITH imported_ids AS (
        SELECT value AS id FROM jsonb_array_elements_text($1::jsonb) AS value
    )
    SELECT q.id,q.type,q.level,q.lesson,q.content,q.options,q.answer,q.image,q.creator_id
    FROM questions q JOIN imported_ids ids ON q.id=ids.id
    WHERE q.creator_id=$2
`;
const verifyWithinTransactionQuery = `
    WITH expected AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS e(
            id text,type text,level text,lesson text,content text,options jsonb,
            answer text,image text,creator_id text)
    ), actual AS (
        SELECT q.id,q.type,q.level,q.lesson,q.content,q.options::jsonb,
               q.answer,q.image,q.creator_id
        FROM questions q JOIN expected e ON q.id=e.id
        WHERE q.creator_id=$2
    ), differences AS (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
    )
    SELECT 1 / CASE WHEN
        NOT EXISTS (SELECT 1 FROM differences)
        AND (SELECT COUNT(*) FROM actual)=$3
    THEN 1 ELSE 0 END AS word_import_verified
`;
function questionRowsMatch(saved:any[], expected:any[]) {
    if (!Array.isArray(saved) || saved.length!==expected.length) return false;
    const expectedById=new Map(expected.map(q=>[q.id,q]));
    if(expectedById.size!==expected.length)return false;
    for (const row of saved) {
        const original=expectedById.get(String(row.id));
        if (!original || row.type!==original.type || row.level!==original.level ||
            String(row.lesson)!==String(original.lesson) ||
            String(row.content)!==String(original.content) ||
            String(row.answer)!==String(original.answer) ||
            String(row.image||'')!==String(original.image||'') ||
            String(row.creator_id)!==String(original.creator_id)) return false;
        let options;
        try {options=typeof row.options==='string'?JSON.parse(row.options):row.options;}catch{return false;}
        if(JSON.stringify(options||{})!==JSON.stringify(original.options||{}))return false;
    }
    return true;
}
export async function persistVerifiedWordImport(sql:any,userId:string,body:any) {
    const issues=validateBatchPayload(body);
    if (issues.length) throw new Error('Gói Word chưa đạt kiểm chứng: '+issues.slice(0,3).join('; '));

    const ids=await deriveWordImportIds(userId,body.sourceSha256,body.questions.length);
    const expected=canonicalWordQuestions(body,userId,ids);
    const existing=await sql.query(readImportedQuestionsQuery,[JSON.stringify(ids),userId]);
    const formulaCount=body.questions.reduce((sum:number,q:any)=>sum+q.formulaSources.length,0);
    const importKey=ids[0].slice(3,-5);
    const receipt=(duplicate:boolean)=>({
        success:true,duplicate,batchId:body.batchId,importKey,
        count:expected.length,expected:expected.length,formulaCount
    });
    if(existing.length) {
        if(questionRowsMatch(existing,expected))return receipt(true);
        throw new WordImportConflict('Tệp Word này đã được nhập hoặc một phần câu hỏi đã bị thay đổi. Không ghi đè dữ liệu cũ.');
    }
    const statements:any[]=[];
    for (const q of expected) {
        statements.push(sql.query(
            'INSERT INTO questions (id,type,level,lesson,content,options,answer,image,creator_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [q.id,q.type,q.level,q.lesson,q.content,JSON.stringify(q.options),q.answer,q.image,userId]
        ));
    }
    statements.push(sql.query(verifyWithinTransactionQuery,
        [JSON.stringify(expected),userId,expected.length]));
    await sql.transaction(statements,{isolationLevel:'Serializable'});

    // If the response was lost after commit, retrying the original file is safe
    // because ID generation is deterministic and exact readback is verified.
    const persisted=await sql.query(readImportedQuestionsQuery,[JSON.stringify(ids),userId]);
    if(!questionRowsMatch(persisted,expected)){
        throw new Error('Dữ liệu câu hỏi sau lưu không khớp nguồn đã kiểm chứng; cần đối chiếu lại ngân hàng trước khi thử nhập.');
    }
    return receipt(false);
}

export const onRequestPost:PagesFunction<Env> = async(context)=>{
    const auth=context.request.headers.get('Authorization')||'';
    if(!auth.startsWith('Bearer '))return reply({error:'Chưa đăng nhập'},401);
    const size=Number(context.request.headers.get('content-length')||0);
    if(size>MAX_BODY)return reply({error:'Gói dữ liệu Import quá lớn (giới hạn 6MB). Không lưu dữ liệu thiếu.'},413);
    let db:any,user:any;
    try {
        db=getDatabase(context);
        const secret=await getDynamicSecret(db,context.env.JWT_SECRET);
        user=await verifyJWT(auth.slice(7),secret);
    } catch(e) {return reply({error:'Không xác thực được phiên đăng nhập'},401);}
    if(!user || !(user.role==='admin'||user.target_audience==='Giáo viên'))return reply({error:'Không có quyền nhập ngân hàng câu hỏi'},403);
    try {
        const raw=await context.request.text();
        if(raw.length>MAX_BODY)return reply({error:'Gói nhập Word vượt giới hạn an toàn'},413);
        const body=JSON.parse(raw);
        const errors=validateBatchPayload(body);
        if(errors.length)return reply({success:false,error:'Dữ liệu nhập Word chưa đạt kiểm chứng',issues:errors},422);
        if(!db?.isNeon||!db?.connectionUrl)return reply({error:'CSDL không hỗ trợ giao dịch nhập Word an toàn'},503);
        const sql=neon(db.connectionUrl);
        const response=await persistVerifiedWordImport(sql,String(user.id),body);
        return reply(response,response.duplicate?200:201);
    } catch(e:any) {
        if(e?.code==='WORD_IMPORT_CONFLICT'||e?.code==='23505')return reply({success:false,error:'File Word đã tồn tại hoặc bị thay đổi. Không có dữ liệu nào bị ghi đè.'},409);
        console.error('[WordImport] atomic import failed:',String(e?.message||e).slice(0,200));
        return reply({success:false,error:'Không xác nhận được biên nhận Import. Nếu kết nối lỗi sau khi commit, dữ liệu có thể đã lưu; hãy kiểm tra ngân hàng câu hỏi trước khi thử lại chính file Word.'},500);
    }
};

