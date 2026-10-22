/**
 * Verified Word question import: one Neon HTTP transaction per complete file.
 * Separate from general question upsert to guarantee no false successes,
 * no accidental overwrite and no partial file commits.
 */
import { neon } from '@neondatabase/serverless';
import { verifyJWT, getDynamicSecret, getDatabase } from '../exam/utils';

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
        if(typeof q.answer!=='string'||!q.answer.trim()||q.answer.length>30000)errors.push(label+': đáp án trống hoặc quá dài');
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
    return errors;
}
/** Parameterized queries, atomic transaction and count verification. */
export async function persistVerifiedWordImport(sql:any,userId:string,body:any) {
    const fileName=String(body.fileName).replace(/[\\/]/g,'_');
    const batchId=body.batchId;
    // Schema DDL outside the data transaction is idempotent.
    await sql.query('CREATE TABLE IF NOT EXISTS word_import_batches (id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, file_name TEXT NOT NULL, source_sha256 TEXT NOT NULL, expected_count INTEGER NOT NULL, imported_count INTEGER NOT NULL, engine_version TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)',[]);
    await sql.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_word_import_file_once ON word_import_batches(creator_id,source_sha256)',[]);
    await sql.query('CREATE TABLE IF NOT EXISTS word_import_items (batch_id TEXT NOT NULL REFERENCES word_import_batches(id), question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, PRIMARY KEY(batch_id,question_id))',[]);
    await sql.query('CREATE TABLE IF NOT EXISTS question_formula_sources (question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, source_token TEXT NOT NULL, field_name TEXT NOT NULL, source_type TEXT NOT NULL, source_omml TEXT NOT NULL, normalized_latex TEXT NOT NULL, review_status TEXT NOT NULL, engine_version TEXT NOT NULL, batch_id TEXT NOT NULL, PRIMARY KEY(question_id,source_token,field_name))',[]);
    const queries:any[]=[];
    queries.push(sql.query(
        'INSERT INTO word_import_batches (id,creator_id,file_name,source_sha256,expected_count,imported_count,engine_version) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [batchId,userId,fileName,String(body.sourceSha256||''),body.questions.length,body.questions.length,String(body.engineVersion||'unknown')]
    ));
    for(const q of body.questions) {
        queries.push(sql.query(
            'INSERT INTO questions (id,type,level,lesson,content,options,answer,image,creator_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [q.id,q.type,q.level,q.lesson,q.content,JSON.stringify(q.options||{}),q.answer,q.image||null,userId]
        ));
        queries.push(sql.query('INSERT INTO word_import_items(batch_id,question_id) VALUES ($1,$2)',[batchId,q.id]));
        for(const f of q.formulaSources) {
            queries.push(sql.query(
                'INSERT INTO question_formula_sources (question_id,source_token,field_name,source_type,source_omml,normalized_latex,review_status,engine_version,batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
                [q.id,f.token||'',f.field,f.sourceType||'omml',f.sourceOmml,f.latex,f.status,f.engineVersion||'unknown',batchId]
            ));
        }
    }
    await sql.transaction(queries,{isolationMode:'Serializable'});
    const result=await sql.query(
        'SELECT COUNT(*)::integer AS n FROM word_import_items i JOIN questions q ON q.id=i.question_id WHERE i.batch_id=$1 AND q.creator_id=$2',
        [batchId,userId]
    );
    const count=Number(result[0]?.n??-1);
    if(count!==body.questions.length)throw new Error('Lỗi đối soát sau ghi: '+count+'/'+body.questions.length);
    const persisted=await sql.query(
        'SELECT q.id,q.type,q.level,q.lesson,q.content,q.options,q.answer,q.image FROM questions q JOIN word_import_items i ON q.id=i.question_id WHERE i.batch_id=$1 AND q.creator_id=$2',
        [batchId,userId]
    );
    if(!Array.isArray(persisted)||persisted.length!==body.questions.length) {
        throw new Error('CSDL không trả về toàn bộ nội dung câu hỏi vừa nhập');
    }
    const expected=new Map(body.questions.map((q:any)=>[String(q.id),q]));
    for(const saved of persisted){
        const original:any=expected.get(String(saved.id));
        const storedOptions=typeof saved.options==='string'?JSON.parse(saved.options||'{}'):saved.options;
        if(!original||saved.type!==original.type||saved.level!==original.level||
            String(saved.lesson)!==String(original.lesson)||
            String(saved.content)!==String(original.content)||
            String(saved.answer)!==String(original.answer)||
            String(saved.image||'')!==String(original.image||'')||
            JSON.stringify(storedOptions)!==JSON.stringify(original.options||{})){
            throw new Error('Dữ liệu câu hỏi sau lưu sai lệch với nguồn đã duyệt: '+String(saved.id));
        }
    }
    const formulaCount=body.questions.reduce((sum:number,q:any)=>sum+q.formulaSources.length,0);
    const sourceRecords=await sql.query(
        'SELECT COUNT(*)::integer AS n FROM question_formula_sources WHERE batch_id=$1',
        [batchId]
    );
    if(Number(sourceRecords[0]?.n??-1)!==formulaCount){
        throw new Error('Số lượng công thức gốc sau lưu không đúng: '+formulaCount);
    }
    return {success:true,batchId,count,expected:body.questions.length,formulaCount};
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
        // Distinguish a deliberate duplicate import from a partial write.
        // Schema may not yet exist on a first import; check only if present.
        try {
            const existing=await sql.query('SELECT id,imported_count FROM word_import_batches WHERE creator_id=$1 AND source_sha256=$2 LIMIT 1',[String(user.id),body.sourceSha256]);
            if(existing.length)return reply({success:false,error:'File Word này đã được nhập trước đó. Mã phiên: '+existing[0].id,count:existing[0].imported_count},409);
        }catch(e:any){if(!/does not exist/i.test(String(e?.message||e)))throw e;}
        const response=await persistVerifiedWordImport(sql,String(user.id),body);
        return reply(response,201);
    } catch(e:any) {
        console.error('[WordImport] atomic import failed:',String(e?.message||e).slice(0,200));
        return reply({success:false,error:'Không xác nhận được biên nhận Import. Nếu kết nối lỗi sau khi commit, dữ liệu có thể đã lưu; hãy kiểm tra ngân hàng và lịch sử nhập trước khi thử lại.'},500);
    }
};
