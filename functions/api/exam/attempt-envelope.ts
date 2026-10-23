/** Immutable grading snapshot: public questions are authenticated, answers are AES-GCM sealed. */
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function projection(q: any): any {
  let opts=q.options || {};
  if(typeof opts==='string') { try{opts=JSON.parse(opts);}catch{opts={};} }
  const options:any={};
  for(const key of ['A','B','C','D']) if(Object.hasOwn(opts,key)) options[key]=opts[key];
  return {id:String(q.id),type:q.type,level:q.level || '',lesson:q.lesson || '',content:q.content || '',options,image:q.image || ''};
}
const encode=(data:Uint8Array)=>{
  let value='';for(let i=0;i<data.length;i+=8192)value+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(value).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
};
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function encryptionKey(secret:string) {
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('kttt-attempt-answers-v1:'+secret));
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
async function proof(q:any,secret:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(canonical(projection(q)))))));
}
export async function createAttemptEnvelope(questions:any[],secret:string,revealAnswers=false) {
  const answers=questions.map(q=>({id:String(q.id),answer:q.answer || '',answerImage:q.options?.answerImage || ''}));
  const plain=new TextEncoder().encode(JSON.stringify(answers));
  if(plain.byteLength>3000000)throw new Error('Answer snapshot exceeds safe size');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),plain);
  return {
    questions:questions.map(q=>revealAnswers?{...projection(q),answer:q.answer}:projection(q)),
    answerEnvelope:encode(iv)+'.'+encode(new Uint8Array(encrypted)),
    questionProofs:await Promise.all(questions.map(q=>proof(q,secret)))
  };
}
export async function restoreAttemptQuestions(claims:any,questions:any[],secret:string):Promise<any[]> {
  if(!Array.isArray(questions)||!Array.isArray(claims.questionIds)||!Array.isArray(claims.questionProofs)||questions.length!==claims.questionIds.length)throw new Error('QUESTION_MISMATCH');
  const [iv,data]=String(claims.answerEnvelope || '').split('.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await encryptionKey(secret),decode(data));
  const answers=JSON.parse(new TextDecoder().decode(plain));
  if(!Array.isArray(answers)||answers.length!==questions.length)throw new Error('QUESTION_MISMATCH');
  return Promise.all(questions.map(async(q,i)=>{
    if(String(q.id)!==String(claims.questionIds[i])||String(answers[i].id)!==String(q.id)||await proof(q,secret)!==claims.questionProofs[i])throw new Error('QUESTION_MISMATCH');
    const original=projection(q);
    return {...original,answer:answers[i].answer,options:{...original.options,...(answers[i].answerImage?{answerImage:answers[i].answerImage}:{})}};
  }));
}
