import * as sessionMe from '../functions/api/auth/me';
import * as h0 from '../functions/api/accounts';
import * as h1 from '../functions/api/accounts/clean-schema';
import * as h2 from '../functions/api/auth/change-password';
import * as h3 from '../functions/api/auth/login';
import * as h4 from '../functions/api/auth/register';
import * as h5 from '../functions/api/ai/generate';
import * as h6 from '../functions/api/config';
import * as h7 from '../functions/api/db';
import * as h8 from '../functions/api/exam/export-docx';
import * as h9 from '../functions/api/exam/generate';
import * as h10 from '../functions/api/exam/grade';
import * as h11 from '../functions/api/exams';
import * as h12 from '../functions/api/health';
import * as h13 from '../functions/api/proxy-image';
import * as h14 from '../functions/api/questions';
import * as h15 from '../functions/api/questions/import-word';
import * as h16 from '../functions/api/results';
import * as h17 from '../functions/api/settings';
import * as h18 from '../functions/api/teacher-classes';
import * as h19 from '../functions/api/upload-image';
import * as h20 from '../functions/api/users';
import * as accountById from '../functions/api/accounts/[id]';
import * as userById from '../functions/api/users/[id]';
import {onRequest as middleware} from '../functions/api/_middleware';
const routes: Record<string, any> = {
  '/api/accounts':h0,
  '/api/accounts/clean-schema':h1,
  '/api/auth/change-password':h2,
  '/api/auth/me':sessionMe,
  '/api/auth/login':h3,
  '/api/auth/register':h4,
  '/api/ai/generate':h5,
  '/api/config':h6,
  '/api/db':h7,
  '/api/exam/export-docx':h8,
  '/api/exam/generate':h9,
  '/api/exam/grade':h10,
  '/api/exams':h11,
  '/api/health':h12,
  '/api/proxy-image':h13,
  '/api/questions':h14,
  '/api/questions/import-word':h15,
  '/api/results':h16,
  '/api/settings':h17,
  '/api/teacher-classes':h18,
  '/api/upload-image':h19,
  '/api/users':h20
};
/** Express and Cloudflare execute the same handlers: no second authorization implementation. */
export async function dispatchPagesApi(request: Request, env: any): Promise<Response> {
  const path=new URL(request.url).pathname;
  let module=routes[path], params:any={};
  if (!module) {
    const match=path.match(/^\/api\/(accounts|users)\/([^/]+)$/);
    if(match) { module=match[1]==='accounts'?accountById:userById; params.id=decodeURIComponent(match[2]); }
  }
  const method=request.method[0]+request.method.slice(1).toLowerCase();
  const handler=module?.['onRequest'+method] || module?.onRequest;
  const context:any={request,env,params,data:{},waitUntil:(promise:Promise<any>)=>promise.catch(()=>{}),
    next:()=>handler?handler(context):Promise.resolve(new Response(JSON.stringify({error:module?'Method not allowed':'Not found'}),{status:module?405:404,headers:{'Content-Type':'application/json'}}))};
  return middleware(context);
}
