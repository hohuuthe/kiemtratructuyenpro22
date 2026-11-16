import { getDatabase, getDynamicSecret, signJWT, hashToken } from './utils';
import { onRequestPost as gradeExam } from './grade';
import { INTERNAL_EXAM_FINALIZER } from '../../../src/exam-finalizer-marker';
import { EXAM_IDLE_TIMEOUT_MS, EXAM_FINALIZER_RETRY_MS, shouldFinalizeExamLiveness, normalizeExamStudentInfo } from '../../../src/exam-exit-policy.js';

export async function ensureExamLivenessSchema(db: any) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS _exam_attempt_liveness (
      session_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      contest_participant_id TEXT NOT NULL DEFAULT '',
      student_info_json TEXT NOT NULL DEFAULT '{}',
      last_seen_at TEXT NOT NULL,
      deadline_at TEXT NOT NULL,
      leave_requested_at TEXT,
      finalizing_at TEXT,
      finalized_at TEXT,
      last_error TEXT
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_exam_liveness_due ON _exam_attempt_liveness(last_seen_at) WHERE finalized_at IS NULL').run();
}

export async function initializeExamLiveness(db: any, args: {
  sessionId: string; examId: string; userId: string; contestParticipantId: string;
  deadlineAt: string; studentInfo: any;
}) {
  await ensureExamLivenessSchema(db);
  const info = normalizeExamStudentInfo(args.studentInfo || {});
  await db.prepare(`
    INSERT INTO _exam_attempt_liveness
      (session_id, exam_id, user_id, contest_participant_id, student_info_json, last_seen_at, deadline_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (session_id) DO NOTHING
  `).bind(args.sessionId, args.examId, args.userId || '', args.contestParticipantId || '',
    JSON.stringify(info), new Date().toISOString(), args.deadlineAt).run();
}

/**
 * Shared finalization path for heartbeat timeout, explicit leave and scheduled
 * worker. Never use a caller supplied grade, answers, identity or rubric.
 */
export async function finalizeExamLiveness(context: any, sessionId: string, nowMs = Date.now()) {
  const db = getDatabase(context);
  await ensureExamLivenessSchema(db);
  const row: any = await db.prepare(
    'SELECT * FROM _exam_attempt_liveness WHERE session_id = ?'
  ).bind(sessionId).first();
  if (!row || row.finalized_at) return {status:'no_pending_attempt'};
  if (!shouldFinalizeExamLiveness(row,nowMs)) return {status:'still_active'};

  const claimedAt = new Date(nowMs).toISOString();
  const staleCutoff = new Date(nowMs - EXAM_FINALIZER_RETRY_MS).toISOString();
  const idleCutoff = new Date(nowMs - EXAM_IDLE_TIMEOUT_MS).toISOString();
  const claim: any = await db.prepare(`
    UPDATE _exam_attempt_liveness
    SET finalizing_at = ?, last_error = NULL
    WHERE session_id = ? AND finalized_at IS NULL
      AND (finalizing_at IS NULL OR finalizing_at < ?)
      AND (leave_requested_at IS NOT NULL OR deadline_at <= ? OR last_seen_at <= ?)
  `).bind(claimedAt,sessionId,staleCutoff,claimedAt,idleCutoff).run();
  if (Number(claim?.meta?.changes || 0)!==1) return {status:'claimed_elsewhere'};

  try {
    const session:any=await db.prepare(
      'SELECT session_id, exam_id, teacher_id, question_ids, question_snapshot, exam_config, started_at, deadline_at, expires_at FROM _exam_grade_sessions WHERE session_id=?'
    ).bind(sessionId).first();
    if (!session || !session.started_at || String(session.exam_id)!==String(row.exam_id)) {
      throw new Error('Frozen started grading session unavailable');
    }
    const ids=JSON.parse(String(session.question_ids||'[]'));
    const questions=JSON.parse(String(session.question_snapshot||'[]'));
    const config=JSON.parse(String(session.exam_config||'{}'));
    if (!Array.isArray(ids) || !ids.length || !Array.isArray(questions) ||
      questions.length!==ids.length || questions.some((q:any,i:number)=>String(q?.id??q?.questionId??'')!==String(ids[i]))) {
      throw new Error('Frozen question order invalid');
    }
    const draft:any=await db.prepare(
      'SELECT answers_json FROM _exam_answer_drafts WHERE session_id=?'
    ).bind(sessionId).first();
    const answers=JSON.parse(String(draft?.answers_json||'null'));
    if (!Array.isArray(answers) || answers.length!==ids.length) throw new Error('No safe autosaved answers');
    const secret=await getDynamicSecret(db,context.env.JWT_SECRET);
    const start=Date.parse(String(session.started_at));
    const deadline=Date.parse(String(session.deadline_at));
    if (!Number.isFinite(start)||!Number.isFinite(deadline)||deadline<=start) throw new Error('Invalid frozen exam clock');
    const token=await signJWT({
      purpose:'exam_active', gradingSessionId:sessionId, questionIds:ids.map(String),
      teacherId:String(session.teacher_id||''),
      studentUserId:row.user_id||null, contestParticipantId:row.contest_participant_id||null,
      examConfig:{id:String(session.exam_id)}, startedAtMs:start, deadlineAtMs:deadline,
      timestamp:start, timeLimitSeconds:Math.max(1,Math.round((deadline-start)/1000)),
      exp:Math.floor(Date.now()/1000)+600
    },secret);
    const info=normalizeExamStudentInfo(JSON.parse(String(row.student_info_json||'{}')));
    info.examId=String(session.exam_id);
    info.examName=String(config.name||info.examName||'');
    info.teacherId=String(session.teacher_id||'');
    const gradeRequest = new Request(context.request.url, {
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({
        token,studentAnswers:answers,clientQuestions:questions,
        studentInfo:info,timeTaken:Math.max(0,Math.round((nowMs-start)/1000))
      })
    });
    const result:Response=await gradeExam({
      request:gradeRequest,env:context.env,[INTERNAL_EXAM_FINALIZER]:true
    } as any);
    const gradeData:any=await result.json().catch(()=>({}));
    if (!result.ok && !gradeData.alreadySubmitted) throw new Error('Grading '+result.status+': '+String(gradeData.code||'not_completed'));
    if (!gradeData.resultId) throw new Error('Finalizer returned no committed result');
    await db.prepare('UPDATE _exam_attempt_liveness SET finalized_at=?, last_error=NULL WHERE session_id=? AND finalizing_at=?')
      .bind(new Date().toISOString(),sessionId,claimedAt).run();
    return {status:'finalized',resultId:String(gradeData.resultId)};
  } catch (error:any) {
    // Keep the old lock and draft; never erase an ungraded attempt.
    await db.prepare('UPDATE _exam_attempt_liveness SET last_error=? WHERE session_id=? AND finalizing_at=?')
      .bind(String(error?.message||'finalization_failed').slice(0,300),sessionId,claimedAt).run().catch(()=>{});
    return {status:'retry_required'};
  }
}

export async function finalizeDueExamLiveness(context:any, limit=20) {
  const db=getDatabase(context);
  await ensureExamLivenessSchema(db);
  const now=new Date().toISOString();
  const idle=new Date(Date.now()-EXAM_IDLE_TIMEOUT_MS).toISOString();
  const retry=new Date(Date.now()-EXAM_FINALIZER_RETRY_MS).toISOString();
  const {results}=await db.prepare(`
    SELECT session_id FROM _exam_attempt_liveness
    WHERE finalized_at IS NULL AND (finalizing_at IS NULL OR finalizing_at < ?)
      AND (leave_requested_at IS NOT NULL OR deadline_at <= ? OR last_seen_at <= ?)
    ORDER BY last_seen_at ASC LIMIT ?
  `).bind(retry,now,idle,Math.min(50,Math.max(1,limit))).all();
  const outcomes=[];
  for (const record of results||[]) outcomes.push(await finalizeExamLiveness(context,String(record.session_id)));
  return outcomes;
}
