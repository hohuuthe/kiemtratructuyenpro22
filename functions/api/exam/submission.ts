/** Single PostgreSQL statement: either save BOTH result and replay marker, or neither. */
export async function persistExamResult(db:any, record:any, tokenHash:string, accountId:string|null, maxAttempts:number) {
  const fields=['id','user_id','student_name','student_class','lop','don_vi','exam_name','exam_id','score','time_taken','correct_count','total_questions','details','loai_thi_sinh','cheat_warning_count','created_at'];
  const values=fields.map(k=>record[k] ?? null);
  const statement=db.prepare(`WITH accepted AS (
    INSERT INTO _submitted_exam_tokens(token_hash,exam_id,student_name,submitted_at)
    SELECT ?,?,?,? WHERE (?=0 OR (SELECT COUNT(*) FROM results WHERE exam_id=? AND user_id=?) < ?)
    ON CONFLICT(token_hash) DO NOTHING RETURNING token_hash
  ) INSERT INTO results (${fields.join(',')}) SELECT ${fields.map(()=>'?').join(',')} FROM accepted RETURNING id`)
    .bind(tokenHash,record.exam_id,record.student_name,record.created_at,maxAttempts,record.exam_id,record.user_id,maxAttempts,...values);
  const statements=accountId?[db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').bind(JSON.stringify([String(record.exam_id),String(record.user_id)])),statement]:[statement];
  const outcome=await db.batch(statements);
  const saved=outcome[outcome.length-1];
  if(saved.results?.length===1)return {inserted:true};
  const existing=await db.prepare('SELECT * FROM results WHERE id=?').bind(record.id).first();
  if(existing)return {inserted:false,existing};
  return {inserted:false,quotaExceeded:true};
}
