import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {neonConfig} from '@neondatabase/serverless';
import {dispatchPagesApi} from '../src/pages-api-dispatch.ts';
import {createNeonD1Shim,normalizeDatabaseUrl} from '../functions/api/neon-adapter.ts';
import {ensureD1SchemaAndIndexes,getDynamicSecret,hashPasswordPBKDF2,signJWT} from '../functions/api/exam/utils.ts';
import {createAttemptEnvelope} from '../functions/api/exam/attempt-envelope.ts';
import {onRequest as staticGuard} from '../functions/_middleware.ts';

// TWO isolated PostgreSQL engines and the real Neon driver, with HTTP substituted.
// These are NOT two provisioned Neon cloud databases. No production access is allowed.
test('Security release: real API handlers on two isolated PostgreSQL engines (offline transport)',async t=>{
  const engines={a:new PGlite(),b:new PGlite()};
  const urls={a:normalizeDatabaseUrl('postgresql://fixture:fixture@tenant-a.invalid/testa'),b:normalizeDatabaseUrl('postgresql://fixture:fixture@tenant-b.invalid/testb')};
  const hosts={a:'a.security-test.invalid',b:'b.security-test.invalid'};
  const env:any={JWT_SECRET:'offline-security-suite-secret-not-used-in-production-2026',TENANT_HOST_MAP:JSON.stringify({[hosts.a]:'a',[hosts.b]:'b'}),NEON_DATABASE_URL_A:urls.a,NEON_DATABASE_URL_B:urls.b,CF_PAGES_COMMIT_SHA:'f'.repeat(40)};
  const oldFetch=neonConfig.fetchFunction,oldEndpoint=neonConfig.fetchEndpoint;
  const endpoint='https://isolated-security-driver.invalid/sql';let unavailable=false;const calls:any[]=[];
  neonConfig.fetchEndpoint=endpoint;
  neonConfig.fetchFunction=async(url:any,options:any)=>{
    assert.equal(url,endpoint,'Unexpected network destination');
    const headers=new Headers(options.headers),connection=headers.get('Neon-Connection-String');
    const parsed=new URL(connection || '');
    assert.equal(parsed.username,'fixture');assert.equal(parsed.password,'fixture');
    const which=parsed.hostname==='tenant-a.invalid'&&parsed.pathname==='/testa'?'a':parsed.hostname==='tenant-b.invalid'&&parsed.pathname==='/testb'?'b':null;
    assert.ok(which,'Only two explicit test databases are allowed');
    if(unavailable)return new Response(JSON.stringify({message:'simulated database unavailable',code:'08006'}),{status:503});
    const payload=JSON.parse(options.body),db=engines[which!];calls.push({which,payload});
    const execute=async(c:any,item:any)=>{
      const r=await c.query(item.query,item.params);
      return {fields:r.fields.map((f:any)=>({name:f.name,dataTypeID:f.dataTypeID})),rows:r.rows.map((row:any)=>r.fields.map((f:any)=>row[f.name]==null?null:typeof row[f.name]==='object'?JSON.stringify(row[f.name]):String(row[f.name]))),rowCount:r.affectedRows ?? r.rows.length,command:item.query.trim().split(/\s+/)[0].toUpperCase()};
    };
    try {
      const result=Array.isArray(payload.queries)?{results:await db.transaction(async(tx:any)=>{const rows=[];for(const item of payload.queries)rows.push(await execute(tx,item));return rows;})}:await execute(db,payload);
      return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
    }catch(e:any){return new Response(JSON.stringify({message:e.message,code:e.code,detail:e.detail}),{status:400,headers:{'Content-Type':'application/json'}});}
  };
  const shims={a:createNeonD1Shim(urls.a),b:createNeonD1Shim(urls.b)};
  const request=async(which:'a'|'b',route:string,{method='GET',token='',body,headers={}}:any={})=>{
    const response=await dispatchPagesApi(new Request('https://'+hosts[which]+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
    const raw=await response.text();let json:any;try{json=JSON.parse(raw);}catch{json={raw};}return {status:response.status,body:json,headers:response.headers};
  };
  const login=async(id:string,which:'a'|'b'='a')=>{const r=await request(which,'/api/auth/login',{method:'POST',body:{username:id,password:'Fixture-password-2026'}});assert.equal(r.status,200,JSON.stringify(r.body));assert.ok(r.body.token);return r.body.token as string;};
  const sql=async(text:string,params:any[]=[],which:'a'|'b'='a')=>engines[which].query(text,params);
  let counter=0;
  const createExam=async(extra:any={},which:'a'|'b'='a')=>{
    const token=await login('teacher',which);
    const r=await request(which,'/api/exams',{method:'POST',token,body:{name:'Audit exam '+(++counter),time_limit:30,count_41:1,points_41:1,selected_lessons:['LESSON'],show_score:1,show_details:0,immediate_feedback:0,...extra}});
    assert.equal(r.status,200,JSON.stringify(r.body));return r.body.id as string;
  };
  const issue=async(examId:string,token='',extra:any={})=>{const r=await request('a','/api/exam/generate',{method:'POST',token,body:{teacherId:'teacher',examId,...extra}});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
  const submit=(issued:any,answers:any[],token='',extra:any={})=>request('a','/api/exam/grade',{method:'POST',token,body:{token:issued.token,studentAnswers:answers,clientQuestions:issued.questions,studentInfo:{name:'Guest',unit:'TEST',userId:'u-student'},...extra}});
  try {
    const password=await hashPasswordPBKDF2('Fixture-password-2026');
    for(const which of ['a','b'] as const){
      assert.equal((await shims[which].prepare('SELECT 1 AS driver_preflight').first()).driver_preflight,1);
      await ensureD1SchemaAndIndexes(shims[which]);
      await engines[which].exec('ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS keep_raw_score INTEGER DEFAULT 0; ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS target_donvi TEXT; ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS donvi TEXT;');
      for(const [id,role] of [['admin','admin'],['teacher','teacher'],['other','teacher'],['student','user'],['same-name','user']]){
        await sql('INSERT INTO users(id,full_name,target_audience,donvi,lop,is_active) VALUES($1,$2,$3,$4,$5,1)',['u-'+id,'SAME DISPLAY NAME',null,'School A','12A'],which);
        await sql('INSERT INTO accounts(id,user_id,username,password,role,is_active) VALUES($1,$2,$1,$3,$4,1)',[id,'u-'+id,password,role],which);
      }
      await sql("INSERT INTO questions(id,creator_id,type,level,lesson,content,options,answer) VALUES('q1','teacher','4-1','NB','LESSON','Original question','{\"A\":\"One\",\"B\":\"Two\",\"C\":\"Three\",\"D\":\"Four\"}','B')",[],which);
      for(const [id,owner] of [['exam-a','teacher'],['exam-b','other']])await sql("INSERT INTO exam_configs(id,name,creator_id,time_limit,count_41,points_41,selected_lessons,show_score,show_details,is_shared_results,updated_at) VALUES($1,'SAME EXAM NAME',$2,30,1,1,'[\"LESSON\"]',1,0,0,'2026-01-01T00:00:00.000Z')",[id,owner],which);
      for(const [id,exam,student] of [['result-a','exam-a','u-student'],['result-b','exam-b','u-same-name'],['legacy','exam-b',null]])await sql("INSERT INTO results(id,exam_id,exam_name,user_id,student_name,score,correct_count,total_questions,details) VALUES($1,$2,'SAME EXAM NAME',$3,'SAME DISPLAY NAME',0,0,1,'[]')",[id,exam,student],which);
    }
    await t.test('login works with NULL profile audience and never returns a password hash',async()=>{
      const r=await request('a','/api/auth/login',{method:'POST',body:{username:'teacher',password:'Fixture-password-2026'}});assert.equal(r.status,200);assert.equal(r.body.data.password,undefined);assert.equal((await request('a','/api/questions',{token:r.body.token})).status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
    });
    await t.test('malformed and expired tokens fail closed, never become guests',async()=>{
      assert.equal((await request('a','/api/results?examId=exam-a',{token:'bad.%bad.!'})).status,401);const key=await getDynamicSecret(shims.a,env.JWT_SECRET);assert.equal((await request('a','/api/exams',{token:await signJWT({id:'teacher',exp:1},key)})).status,401);
    });
    await t.test('copied tenant database and identical signing environment reject cross-tenant tokens',async()=>{
      const token=await login('teacher','a');assert.equal((await request('b','/api/questions',{token})).status,401);assert.equal((await request('b','/api/questions',{token:await login('teacher','b')})).status,200);
    });
    await t.test('header and query cannot redirect tenant A to database B',async()=>{
      assert.equal((await request('a','/api/health?tenant=b',{headers:{'X-Tenant-Slug':'b'}})).status,421);assert.equal((await request('a','/api/health?tenant=a',{headers:{'X-Tenant-Slug':'a'}})).status,200);
    });
    await t.test('lock then unlock does not resurrect a previous login token',async()=>{
      const old=await login('teacher');await sql("UPDATE accounts SET is_active=0 WHERE id='teacher'");assert.equal((await request('a','/api/questions',{token:old})).status,401);await sql("UPDATE accounts SET is_active=1 WHERE id='teacher'");assert.equal((await request('a','/api/questions',{token:old})).status,401);assert.equal((await request('a','/api/questions',{token:await login('teacher')})).status,200);
    });
    await t.test('restoring a role cannot resurrect old administrative permissions',async()=>{
      const old=await login('admin');await sql("UPDATE accounts SET role='user' WHERE id='admin'");assert.equal((await request('a','/api/accounts',{token:old})).status,401);await sql("UPDATE accounts SET role='admin' WHERE id='admin'");assert.equal((await request('a','/api/accounts',{token:old})).status,401);
    });
    await t.test('profile locking and password changes revoke existing sessions',async()=>{
      const old=await login('student');await sql("UPDATE users SET is_active=0 WHERE id='u-student'");assert.equal((await request('a','/api/results',{token:old})).status,401);await sql("UPDATE users SET is_active=1 WHERE id='u-student'");assert.equal((await request('a','/api/results',{token:old})).status,401);const before=await login('student');await sql("UPDATE accounts SET password=password WHERE id='student'");assert.equal((await request('a','/api/results',{token:before})).status,401);
    });
    await t.test('profile label cannot grant administrator access',async()=>{
      await sql("UPDATE users SET target_audience='admin' WHERE id='u-student'");assert.equal((await request('a','/api/settings',{method:'POST',token:await login('student'),body:{}})).status,403);await sql("UPDATE users SET target_audience=NULL WHERE id='u-student'");
    });
    await t.test('same-name students and legacy ownership do not share results',async()=>{
      const token=await login('student'),list=await request('a','/api/results',{token});assert.deepEqual(list.body.data.map((r:any)=>r.id),['result-a']);assert.equal((await request('a','/api/results?id=result-b',{token})).status,404);assert.equal((await request('a','/api/results?id=legacy',{token})).status,404);assert.equal((await request('a','/api/results?count=true',{token})).body.count,1);
    });
    await t.test('same-name exams never grant foreign teacher read or regrade permission',async()=>{
      const token=await login('teacher');assert.equal((await request('a','/api/results?examId=exam-b',{token})).body.data.length,0);assert.equal((await request('a','/api/results',{method:'PUT',token,body:{id:'result-b',score:10}})).status,403);assert.equal((await sql("SELECT score FROM results WHERE id='result-b'")).rows[0].score,0);
    });
    await t.test('mixed authorized and unauthorized bulk deletion is atomic',async()=>{
      const r=await request('a','/api/results',{method:'DELETE',token:await login('teacher'),body:{ids:['result-a','result-b']}});assert.equal(r.status,403);assert.equal((await sql("SELECT count(*)::int AS n FROM results WHERE id IN ('result-a','result-b')")).rows[0].n,2);
    });
    await t.test('shared summaries never include student answers or hidden grading keys',async()=>{
      await sql("UPDATE exam_configs SET is_shared_results=1 WHERE id='exam-b'");const r=await request('a','/api/results?examId=exam-b&includeDetails=true');assert.equal(r.status,200);assert.ok(r.body.data.length>0);for(const row of r.body.data){assert.equal(row.details,undefined);assert.equal(row.user_id,'');}await sql("UPDATE exam_configs SET is_shared_results=0 WHERE id='exam-b'");
    });
    await t.test('two handler requests with one revision yield one success and one 409',async()=>{
      const id=await createExam(),token=await login('teacher'),loaded=(await request('a','/api/exams?id='+id,{token})).body.data;const payload={...loaded,expected_updated_at:loaded.updated_at,name:'First edit'};const results=await Promise.all([request('a','/api/exams',{method:'POST',token,body:payload}),request('a','/api/exams',{method:'POST',token,body:{...payload,name:'Second edit'}})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results[0].status===200?'First edit':'Second edit';assert.equal((await sql('SELECT name FROM exam_configs WHERE id=$1',[id])).rows[0].name,winner);
    });
    await t.test('invalid counts fail while zero points and false string flags remain valid',async()=>{
      const token=await login('teacher');assert.equal((await request('a','/api/exams',{method:'POST',token,body:{name:'Invalid count',count_41:-1}})).status,400);const id=await createExam({points_41:0,show_details:'false',is_shared_results:'false',target_donvi:'School A',max_cheat_warnings:7});const row=(await sql('SELECT * FROM exam_configs WHERE id=$1',[id])).rows[0];assert.equal(row.points_41,0);assert.equal(row.show_details,0);assert.equal(row.is_shared_results,0);assert.equal(row.target_donvi,'School A');assert.equal(row.max_cheat_warnings,7);
    });
    await t.test('client cannot enable feedback and extract answers before submission',async()=>{
      const generated=await issue(await createExam(),'',{examConfig:{immediateFeedback:true,immediate_feedback:1}});assert.equal(generated.immediateFeedback,false);assert.equal(generated.questions[0].answer,undefined);const claims=JSON.parse(Buffer.from(generated.token.split('.')[1],'base64url').toString());assert.equal(claims.answers,undefined);assert.equal(claims.examConfig.ai_grading_key,undefined);assert.ok(claims.answerEnvelope);
    });
    await t.test('empty teacher bank never falls back to another teacher bank',async()=>{
      assert.equal((await request('a','/api/exam/generate',{method:'POST',body:{teacherId:'other',examId:'exam-b'}})).status,404);
    });
    await t.test('question edits after issue cannot change the grading answer for that attempt',async()=>{
      const generated=await issue(await createExam());await sql("UPDATE questions SET answer='C' WHERE id='q1'");const saved=await submit(generated,['B']);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.score,1);await sql("UPDATE questions SET answer='B' WHERE id='q1'");
    });
    await t.test('guest cannot impersonate a student by placing their ID in the request body',async()=>{
      const r=await submit(await issue(await createExam()),['B']);assert.equal(r.status,200);assert.equal((await sql('SELECT user_id FROM results WHERE id=$1',[r.body.resultId])).rows[0].user_id,null);assert.equal(r.body.detailedResults[0].correctAnswer,undefined);assert.equal(r.body.detailedResults[0].question.answer,undefined);
    });
    await t.test('tampered question payload is rejected before persistence',async()=>{
      const generated=await issue(await createExam());generated.questions[0].content='Tampered';assert.equal((await submit(generated,['B'])).status,400);
    });
    await t.test('completed attempt retries are idempotent, including simultaneous requests',async()=>{
      const generated=await issue(await createExam()),r=await Promise.all([submit(generated,['B']),submit(generated,['B'])]);assert.deepEqual(r.map(v=>v.status),[200,200]);assert.equal(r[0].body.resultId,r[1].body.resultId);assert.equal((await sql('SELECT count(*)::int AS n FROM results WHERE id=$1',[r[0].body.resultId])).rows[0].n,1);const again=await submit(generated,['C']);assert.equal(again.body.duplicate,true);assert.equal(again.body.score,1);
    });
    await t.test('failed result insert rolls back replay marker and never reports success',async()=>{
      const generated=await issue(await createExam());await engines.a.exec("CREATE FUNCTION fail_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated storage failure'; END $$; CREATE TRIGGER fail_result BEFORE INSERT ON results FOR EACH ROW EXECUTE FUNCTION fail_result();");const r=await submit(generated,['B']);assert.ok(r.status>=500);await engines.a.exec('DROP TRIGGER fail_result ON results; DROP FUNCTION fail_result();');const retry=await submit(generated,['B']);assert.equal(retry.status,200,JSON.stringify(retry.body));
    });
    await t.test('two outstanding attempts cannot bypass a one-attempt quota',async()=>{
      const id=await createExam({max_attempts:1}),token=await login('student'),first=await issue(id,token),second=await issue(id,token);const outcomes=await Promise.all([submit(first,['B'],token),submit(second,['B'],token)]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,403]);assert.equal((await sql('SELECT count(*)::int AS n FROM results WHERE exam_id=$1',[id])).rows[0].n,1);
    });
    await t.test('unanswered true/false earns no credit and short-answer alternatives survive normalization',async()=>{
      const key=await getDynamicSecret(shims.a,env.JWT_SECRET),questions=[{id:'tf',type:'TF4',content:'TF',options:{A:'a',B:'b',C:'c',D:'d'},answer:'A:S&B:S&C:S&D:S'},{id:'sq',type:'SQ',content:'SQ',options:{},answer:'alpha;beta'}],bundle=await createAttemptEnvelope(questions,key);const issued={questions:bundle.questions,token:await signJWT({tokenType:'exam',questionIds:['tf','sq'],answerEnvelope:bundle.answerEnvelope,questionProofs:bundle.questionProofs,examConfig:{id:'exam-a',name:'Test grading',pointsTF4:1,pointsSQ:1,show_details:1},teacherId:'teacher',subject:null,maxAttempts:0,timestamp:Date.now(),exp:Math.floor(Date.now()/1000)+120},key)};const r=await submit(issued,[null,'BETA']);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.detailedResults[0].score,0);assert.equal(r.body.detailedResults[1].score,1);
    });
    await t.test('hidden scores cannot be inferred from returned per-question grades',async()=>{
      const r=await submit(await issue(await createExam({show_score:0,show_details:1})),['B']);assert.equal(r.body.score,null);assert.equal(r.body.detailedResults[0].score,undefined);assert.equal(r.body.detailedResults[0].isCorrect,undefined);
    });
    await t.test('retired schema cleanup cannot mutate or drop tables',async()=>{
      assert.equal((await request('a','/api/accounts/clean-schema',{method:'POST',token:await login('admin'),body:{}})).status,410);assert.ok((await sql('SELECT count(*)::int AS n FROM accounts')).rows[0].n>=5);
    });
    await t.test('origins, untrusted image hosts and sensitive static files are denied',async()=>{
      assert.equal((await request('a','/api/config',{headers:{Origin:'https://evil.invalid'}})).status,403);assert.equal((await request('a','/api/proxy-image?url=http://127.0.0.1/admin')).status,403);for(const path of ['/neon_database_backup.sql','/server.cjs','/.env','/assets/server.cjs.map']){const r=await staticGuard({request:new Request('https://'+hosts.a+path),next:()=>new Response('unexpected')});assert.equal(r.status,404);}
    });
    await t.test('database failures never become fabricated health or successful submissions',async()=>{
      const generated=await issue(await createExam());unavailable=true;try{assert.ok((await request('a','/api/health')).status>=500);assert.ok((await submit(generated,['B'])).status>=500);}finally{unavailable=false;}
    });
    await t.test('short image upload capability cannot access grading or management APIs',async()=>{
      const generated=await issue(await createExam());assert.ok(generated.uploadToken.length<1500);
      const body={base64:'data:image/png;base64,iVBORw0KGgo='};
      assert.equal((await request('a','/api/upload-image',{method:'POST',token:generated.uploadToken,body})).status,200);
      assert.equal((await request('a','/api/exams',{method:'POST',token:generated.uploadToken,body:{name:'Forbidden'}})).status,401);
      assert.equal((await request('a','/api/upload-image',{method:'POST',token:generated.token,body})).status,401);
      assert.equal((await request('b','/api/upload-image',{method:'POST',token:generated.uploadToken,body})).status,401);
    });
    await t.test('answer images cannot persist active HTML or SVG payloads',async()=>{
      const generated=await issue(await createExam());
      for(const image of ['https://image.invalid/a" onerror="alert(1)','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=']) {
        assert.equal((await submit(generated,[{text:'essay',image}])).status,400);
      }
    });
    await t.test('a teacher cannot delete or inspect another teacher assignment by ID',async()=>{
      await sql("INSERT INTO teacher_classes(id,teacher_id,class_name,donvi) VALUES('foreign-class','u-other','12B','School A')");
      const token=await login('teacher');
      assert.equal((await request('a','/api/teacher-classes?id=foreign-class',{method:'DELETE',token})).status,403);
      assert.equal((await request('a','/api/teacher-classes?teacher_id=u-other',{token})).status,403);
      assert.equal((await sql("SELECT COUNT(*)::int AS n FROM teacher_classes WHERE id='foreign-class'")).rows[0].n,1);
    });
    await t.test('question-batch authorization is checked before deletion and storage failure rolls back all writes',async()=>{
      await sql("INSERT INTO questions(id,creator_id,content) VALUES('foreign-question','other','Foreign'),('delete-candidate','teacher','Keep')");
      const token=await login('teacher');
      assert.equal((await request('a','/api/questions',{method:'POST',token,body:{deletedIds:['delete-candidate'],questions:[{id:'foreign-question',content:'Unauthorized edit'}]}})).status,403);
      assert.equal((await sql("SELECT COUNT(*)::int AS n FROM questions WHERE id='delete-candidate'")).rows[0].n,1);
      await engines.a.exec("CREATE FUNCTION fail_question() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated question insert failure'; END $$; CREATE TRIGGER fail_question BEFORE INSERT ON questions FOR EACH ROW EXECUTE FUNCTION fail_question();");
      try {assert.ok((await request('a','/api/questions',{method:'POST',token,body:{deletedIds:['delete-candidate'],questions:[{content:'New'}]}})).status>=500);}
      finally {await engines.a.exec('DROP TRIGGER fail_question ON questions; DROP FUNCTION fail_question();');}
      assert.equal((await sql("SELECT COUNT(*)::int AS n FROM questions WHERE id='delete-candidate'")).rows[0].n,1);
    });
    await t.test('tenant fixtures remain physically distinct and transactions were used',async()=>{
      assert.equal((await sql('SELECT count(*)::int AS n FROM results',[],'b')).rows[0].n,3);assert.ok(calls.some(c=>Array.isArray(c.payload.queries)&&c.payload.queries.some((q:any)=>q.query.includes('_submitted_exam_tokens'))));
    });
  }finally{neonConfig.fetchFunction=oldFetch;neonConfig.fetchEndpoint=oldEndpoint;await Promise.all([engines.a.close(),engines.b.close()]);}
});
