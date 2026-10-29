// One bounded page for management tables. Filters are applied before LIMIT/OFFSET.
// Do not accept caller-provided tenant IDs or role-based SQL clauses.
export function parseManagementPage(url) {
  const p = new URL(url, 'https://local.invalid').searchParams;
  const integer = (name, fallback, max) => {
    const raw = p.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw new Error('Invalid '+name);
    return Math.min(max, Math.max(1, Number(raw)));
  };
  return {page:integer('page',1,100000),limit:integer('limit',50,100),
    search:(p.get('search')||'').trim().slice(0,120),
    audience:(p.get('audience')||'').trim().slice(0,100),
    unit:(p.get('unit')||'').trim().slice(0,160),
    className:(p.get('class')||'').trim().slice(0,80),
    exam:(p.get('exam')||'').trim().slice(0,180),
    teacher:(p.get('teacher')||'').trim().slice(0,100),
    sort:(p.get('sort')||'rank').trim().slice(0,32),
    direction:p.get('direction')==='desc'?'DESC':'ASC'};
}
export function accountsPageQuery(page) {
  const conditions=[],args=[];
  const eq=(column,value)=>{if(value){conditions.push('LOWER(TRIM('+column+')) = LOWER(TRIM(?))');args.push(value);}};
  eq('u.target_audience',page.audience);eq('u.donvi',page.unit);eq('u.lop',page.className);
  if(page.search){
    const cols=['a.id','a.user_id','a.username','u.full_name','u.phone_number','u.donvi','u.lop','u.target_audience'];
    conditions.push('('+cols.map(c=>'COALESCE('+c+",'') ILIKE ?").join(' OR ')+')');
    args.push(...cols.map(()=>'%'+page.search.replace(/[\\%_]/g,c=>'\\'+c)+'%'));
  }
  const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
  const from=' FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)';
  const projection='a.id,a.user_id,a.username,a.role,a.is_active,a.expiry_date,a.created_at,u.full_name,u.phone_number,u.donvi,u.lop,u.target_audience,u.occupation';
  return {countSQL:'SELECT COUNT(*) AS total'+from+where,countArgs:args,
    rowsSQL:'SELECT '+projection+from+where+' ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?',
    rowsArgs:[...args,page.limit,(page.page-1)*page.limit]};
}
export function resultsPageQuery(page, actor) {
  if(!actor?.id) throw new Error('Login required');
  const isAdmin=String(actor.role||'').toLowerCase()==='admin';
  const predicates=[],args=[];
  if(!isAdmin){
    // Teacher is scoped to the same exams whose creator matches account/profile.
    predicates.push('EXISTS (SELECT 1 FROM exam_configs ec WHERE ec.id=r.exam_id AND ec.creator_id IN (?,?))');
    args.push(String(actor.id),String(actor.user_id||actor.id));
  }
  if(page.exam){predicates.push('r.exam_name=?');args.push(page.exam);}
  if(page.unit){predicates.push('LOWER(TRIM(COALESCE(NULLIF(r.don_vi,\'\'),r.student_class,\'\')))=LOWER(TRIM(?))');args.push(page.unit);}
  if(page.className){predicates.push('LOWER(TRIM(COALESCE(NULLIF(r.lop,\'\'),r.student_class,\'\')))=LOWER(TRIM(?))');args.push(page.className);}
  if(page.teacher && isAdmin){predicates.push('EXISTS (SELECT 1 FROM exam_configs ec WHERE ec.id=r.exam_id AND ec.creator_id=?)');args.push(page.teacher);}
  if(page.search){const cols=['r.student_name','r.student_class','r.exam_name','r.don_vi','r.lop','r.loai_thi_sinh'];
    predicates.push('('+cols.map(c=>'COALESCE('+c+",'') ILIKE ?").join(' OR ')+')');
    args.push(...cols.map(()=>'%'+page.search.replace(/[\\%_]/g,c=>'\\'+c)+'%'));}
  const where=predicates.length?' WHERE '+predicates.join(' AND '):'';
  const from=' FROM results r';
  const projection='r.id,r.user_id,r.student_name,r.student_class,r.score,r.correct_count,r.total_questions,r.time_taken,r.exam_name,r.exam_id,r.created_at,r.loai_thi_sinh,r.cheat_warning_count,r.ai_grading_summary,r.lop,r.don_vi,(SELECT ec.creator_id FROM exam_configs ec WHERE ec.id=r.exam_id LIMIT 1) AS exam_creator_id';
  const sortColumns={rank:'r.score DESC,r.time_taken ASC',score:'r.score',correctCount:'r.correct_count',
    timeTaken:'r.time_taken',studentName:'r.student_name',loaiThiSinh:'r.loai_thi_sinh',
    lop:'r.lop',donvi:'r.don_vi',aiGrading:'r.ai_grading_summary',examName:'r.exam_name'};
  const selected=Object.hasOwn(sortColumns,page.sort)?page.sort:'rank';
  const order=selected==='rank'?'r.score DESC,r.time_taken ASC':sortColumns[selected]+' '+page.direction;
  return {countSQL:'SELECT COUNT(*) AS total'+from+where,countArgs:args,
    rowsSQL:'SELECT '+projection+from+where+' ORDER BY '+order+',r.id DESC LIMIT ? OFFSET ?',
    rowsArgs:[...args,page.limit,(page.page-1)*page.limit]};
}
