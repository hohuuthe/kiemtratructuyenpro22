from pathlib import Path
p=Path('functions/api/teacher-classes.ts');s=p.read_text()
a='  if (isTeacher && !isAdmin && !teacherId) {'
assert a in s
s=s.replace(a,"  if (isTeacher && !isAdmin && teacherId && teacherId !== String(user.user_id || user.id)) return new Response(JSON.stringify({error:'Cannot access another teacher assignment'}),{status:403,headers:corsHeaders});\n"+a)
a='      await db.prepare("DELETE FROM teacher_classes WHERE id = ?").bind(id).run();'
assert a in s
s=s.replace(a,"      const removed=await db.prepare('DELETE FROM teacher_classes WHERE id=? AND (?=1 OR teacher_id=?) RETURNING id').bind(id,isAdmin?1:0,String(user.user_id || user.id)).all();\n      if(!removed.results.length)return new Response(JSON.stringify({error:'Assignment not found or access denied'}),{status:403,headers:corsHeaders});")
a=s.index('    if (Array.isArray(classes)) {');b=s.index('    if (!class_name',a)
s=s[:a]+'''    if (Array.isArray(classes)) {
      if(classes.length>10000)return new Response(JSON.stringify({error:'Too many assignments'}),{status:400,headers:corsHeaders});
      const normalized=classes.map((item:any)=>({name:String(item?.class_name || item?.className || item?.lop || '').trim(),role:String(item?.role || 'bo_mon'),subject:String(item?.subject || item?.mon_hoc || '')}));
      if(normalized.some((item:any)=>!item.name))return new Response(JSON.stringify({error:'Every assignment must have a class name'}),{status:400,headers:corsHeaders});
      const statements=[db.prepare('DELETE FROM teacher_classes WHERE teacher_id=?').bind(teacher_id)];
      for(const item of normalized)statements.push(db.prepare(`INSERT INTO teacher_classes(id,teacher_id,teacher_name,class_name,donvi,role,subject,created_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(teacher_id,class_name,donvi) DO UPDATE SET role=EXCLUDED.role,subject=EXCLUDED.subject,teacher_name=EXCLUDED.teacher_name`)
        .bind(crypto.randomUUID(),teacher_id,teacher_name || '',item.name,donvi || '',item.role,item.subject,now));
      await db.batch(statements);
      return new Response(JSON.stringify({success:true,count:new Set(normalized.map((item:any)=>item.name)).size,error:null}),{status:200,headers:corsHeaders});
    }

'''+s[b:];p.write_text(s)
p=Path('functions/api/questions.ts');s=p.read_text();a=s.index('export const onRequestPost:');b=s.index('// DELETE /api/questions',a)
s=s[:a]+'''export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db=getDatabase(context),{request,env}=context;
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  const user=token?await verifyAuthSession(token,await getDynamicSecret(db,env.JWT_SECRET),db):null;
  const isAdmin=user?.role==='admin';
  if(!user||(!isAdmin&&user.role!=='teacher'))return new Response(JSON.stringify({error:'Staff authorization required'}),{status:403,headers:corsHeaders});
  try {
    const body:any=await request.json();
    const questions:any[]=Array.isArray(body)?body:Array.isArray(body.questions)?body.questions:body.content!==undefined?[body]:[];
    const deletedIds:string[]=Array.isArray(body.deletedIds)?[...new Set(body.deletedIds.map(String))]:[];
    if(questions.length>10000||deletedIds.length>10000||questions.some(q=>!q||typeof q.content!=='string'||!q.content.trim()))return new Response(JSON.stringify({error:'Invalid question batch'}),{status:400,headers:corsHeaders});
    const ids=[...new Set([...questions.filter(q=>q.id).map(q=>String(q.id)),...deletedIds])];
    const existing=ids.length?(await db.prepare('SELECT id,creator_id FROM questions WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results:[];
    if(!isAdmin&&existing.some((q:any)=>String(q.creator_id)!==String(user.id)))return new Response(JSON.stringify({error:'Cannot modify another teacher question'}),{status:403,headers:corsHeaders});
    const statements:any[]=[];
    for(const id of deletedIds)statements.push(db.prepare('DELETE FROM questions WHERE id=? AND (?=1 OR creator_id=?)').bind(id,isAdmin?1:0,user.id));
    for(const q of questions) {
      const id=String(q.id || crypto.randomUUID());
      const previous=existing.find((row:any)=>String(row.id)===id);
      const creator=isAdmin?String(q.creatorId || q.creator_id || previous?.creator_id || user.id):String(user.id);
      const options=typeof q.options==='object'?JSON.stringify(q.options):q.options || '{}';
      statements.push(db.prepare(`INSERT INTO questions(id,type,level,lesson,content,options,answer,image,creator_id)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,level=excluded.level,lesson=excluded.lesson,
        content=excluded.content,options=excluded.options,answer=excluded.answer,image=excluded.image
        WHERE ?=1 OR questions.creator_id=?`).bind(id,q.type || '4-1',q.level || 'NB',q.lesson || '',q.content,options,String(q.answer ?? ''),q.image || null,creator,isAdmin?1:0,user.id));
    }
    const changes=statements.length?await db.batch(statements):[];
    const count=changes.slice(deletedIds.length).reduce((sum:any,result:any)=>sum+Number(result.meta?.changes || 0),0);
    return new Response(JSON.stringify({success:true,count,error:null}),{status:200,headers:corsHeaders});
  }catch{return new Response(JSON.stringify({success:false,error:'Question batch could not be saved'}),{status:500,headers:corsHeaders});}
};

'''+s[b:];p.write_text(s)
p=Path('tests/security-release-acceptance.test.ts');s=p.read_text();anchor="    await t.test('tenant fixtures remain physically distinct and transactions were used',";assert anchor in s
s=s.replace(anchor,'''    await t.test('a teacher cannot delete or inspect another teacher assignment by ID',async()=>{
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
'''+anchor);p.write_text(s)
