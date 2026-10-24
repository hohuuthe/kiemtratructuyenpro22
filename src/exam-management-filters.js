/**
 * Pure, presentation-only exam management filtering. The backend owns
 * authorization. Creator identity is always the exact exam.creator_id,
 * never a display name or an exam name. No mutable exam fields are written.
 */
const txt = v => v == null ? '' : String(v).trim();
const norm = value => txt(value).normalize('NFC').toLocaleLowerCase('vi').replace(/\s+/g,' ');
const sorted = strings => [...strings].sort((a,b)=>a.localeCompare(b,'vi',{sensitivity:'base',numeric:true}));

export function examManagementCreatorId(exam) {
    return txt(exam?.creator_id ?? exam?.creatorId);
}

export function examManagementClassTokens(exam) {
    const raw = exam?.target_lop ?? exam?.targetLop ?? exam?.lop ?? '';
    let values;
    if (Array.isArray(raw)) values=raw;
    else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
        try { const parsed=JSON.parse(raw); values=Array.isArray(parsed)?parsed:[raw]; }
        catch { values=[raw]; }
    } else values=[raw];
    const tokens=new Map();
    for(const value of values) {
        // A comma/semicolon/newline separates classes. Do not use substring
        // matching: class 10A1 must not match 10A10.
        for(const token of txt(value).split(/[,;\n\r]+/)) {
            const label=txt(token).replace(/\s+/g,' ');
            if(label && !tokens.has(norm(label)))tokens.set(norm(label),label);
        }
    }
    return [...tokens.values()];
}

function ownerUnit(exam,accounts) {
    const creator=examManagementCreatorId(exam);
    const account=(Array.isArray(accounts)?accounts:[]).find(a=>
        txt(a?.id)===creator || (creator && txt(a?.user_id)===creator));
    return txt(exam?.teacher_donvi || account?.donvi || account?.address);
}

export function examManagementSchool(exam,accounts=[]) {
    const mode=txt(exam?.chedodethi);
    // Public exams have no restrictive target. Group these by their creator's
    // registered unit so the admin can still find them by school.
    if (!mode || mode === 'Đề công khai') return ownerUnit(exam,accounts);
    return txt(exam?.target_donvi ?? exam?.targetDonvi ?? exam?.donvi) ||
        ownerUnit(exam,accounts);
}

export function matchesExamManagement(exam, {creatorId='',school='',schoolAccounts=[],className='',query=''}={}) {
    if(creatorId && examManagementCreatorId(exam)!==String(creatorId))return false;
    if(school && norm(examManagementSchool(exam,schoolAccounts))!==norm(school))return false;
    if(className && !examManagementClassTokens(exam).some(l=>norm(l)===norm(className)))return false;
    if(query) {
        const q=norm(query);
        const text=[exam?.name,exam?.chedodethi,exam?.id,
            exam?.target_lop ?? exam?.targetLop ?? exam?.lop,
            exam?.target_donvi ?? exam?.targetDonvi ?? exam?.donvi,
            exam?.creator_name ?? exam?.creatorName].map(txt).join(' ');
        if(!norm(text).includes(q))return false;
    }
    return true;
}

export function examManagementFilterChoices(exams,accounts=[],{isAdmin=false,creatorId='',school=''}={}) {
    const rows=Array.isArray(exams)?exams:[];
    const owners=new Map();
    for(const account of Array.isArray(accounts)?accounts:[]) {
        const id=txt(account?.id);
        if(id) owners.set(id,account);
        const userId=txt(account?.user_id);
        if(userId && !owners.has(userId))owners.set(userId,account);
    }
    const creators=new Map();
    const units=new Map();
    const classes=new Map();
    for(const exam of rows) {
        const id=examManagementCreatorId(exam);
        if(isAdmin && id) {
            const account=owners.get(id);
            const name=txt(account?.full_name||account?.username||exam?.creator_name||exam?.creatorName);
            creators.set(id,{id,label:name||'Người tạo ('+id+')',username:txt(account?.username)});
        }
        if(creatorId && id!==creatorId)continue;
        const unit=examManagementSchool(exam,accounts);
        if(isAdmin && unit && !units.has(norm(unit)))units.set(norm(unit),unit);
        if(school && norm(unit)!==norm(school))continue;
        for(const cls of examManagementClassTokens(exam))if(!classes.has(norm(cls)))classes.set(norm(cls),cls);
    }
    const creatorOptions=[...creators.values()];
    const nameCounts=new Map();
    for(const x of creatorOptions)nameCounts.set(norm(x.label),(nameCounts.get(norm(x.label))||0)+1);
    for(const x of creatorOptions)if(nameCounts.get(norm(x.label))>1)
        x.label+=' ('+(x.username&&x.username!==x.label?x.username:x.id)+')';
    return {
        creators:isAdmin?creatorOptions.map(({id,label})=>({value:id,label}))
          .sort((a,b)=>a.label.localeCompare(b.label,'vi')||a.value.localeCompare(b.value)):[],
        schools:isAdmin?sorted(units.values()).map(label=>({value:label,label})):[],
        classes:sorted(classes.values()).map(label=>({value:label,label}))
    };
}
