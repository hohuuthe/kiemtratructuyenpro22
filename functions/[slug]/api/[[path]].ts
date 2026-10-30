// Pages catch-all for /:slug/api/*, retaining the original URL for authoritative
// tenant routing. Never honor a user-provided X-Tenant-Slug as database authority.
import { resolveTenantRoutingFromRequest } from '../../../src/tenant-host-map';
import * as r0 from '../../api/accounts-page';
import * as r1 from '../../api/accounts';
import * as r2 from '../../api/accounts/clean-schema';
import * as r3 from '../../api/ai/generate';
import * as r4 from '../../api/auth/change-password';
import * as r5 from '../../api/auth/login';
import * as r6 from '../../api/auth/register';
import * as r7 from '../../api/bootstrap';
import * as r8 from '../../api/config';
import * as r9 from '../../api/db';
import * as r10 from '../../api/documents';
import * as r11 from '../../api/exam-teachers';
import * as r12 from '../../api/exam/export-docx';
import * as r13 from '../../api/exam/generate';
import * as r14 from '../../api/exam/grade';
import * as r15 from '../../api/exams';
import * as r16 from '../../api/health';
import * as r17 from '../../api/proxy-image';
import * as r18 from '../../api/questions';
import * as r19 from '../../api/questions/delete-by-lesson';
import * as r20 from '../../api/questions/import-word';
import * as r21 from '../../api/results-page';
import * as r22 from '../../api/results';
import * as r23 from '../../api/results/delete-by-exam';
import * as r24 from '../../api/results/deletion-targets';
import * as r25 from '../../api/results/me';
import * as r26 from '../../api/settings';
import * as r27 from '../../api/teacher-classes';
import * as r28 from '../../api/upload-image';
import * as r29 from '../../api/users';
import * as accountId from '../../api/accounts/[id]';
import * as userId from '../../api/users/[id]';

const handlers: Record<string, any> = {
  'accounts-page': r0,
  'accounts': r1,
  'accounts/clean-schema': r2,
  'ai/generate': r3,
  'auth/change-password': r4,
  'auth/login': r5,
  'auth/register': r6,
  'bootstrap': r7,
  'config': r8,
  'db': r9,
  'documents': r10,
  'exam-teachers': r11,
  'exam/export-docx': r12,
  'exam/generate': r13,
  'exam/grade': r14,
  'exams': r15,
  'health': r16,
  'proxy-image': r17,
  'questions': r18,
  'questions/delete-by-lesson': r19,
  'questions/import-word': r20,
  'results-page': r21,
  'results': r22,
  'results/delete-by-exam': r23,
  'results/deletion-targets': r24,
  'results/me': r25,
  'settings': r26,
  'teacher-classes': r27,
  'upload-image': r28,
  'users': r29,
};
const ALLOWED_METHODS = new Set(['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']);

export const onRequest: PagesFunction = async (context: any) => {
  const url = new URL(context.request.url);
  const route = resolveTenantRoutingFromRequest(context.request, context.env);
  if (route.source !== 'path' || !route.prefix) return new Response('Unknown tenant path', {status:404});
  const prefix = route.prefix + '/api/';
  if (!url.pathname.startsWith(prefix)) return new Response('Invalid tenant API route', {status:404});
  const name = url.pathname.slice(prefix.length).replace(/\/$/,'');
  if (!name || name.includes('..') || name.includes('//')) return new Response('Invalid API path', {status:404});
  const method = context.request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return new Response('Method not allowed', {status:405});
  let module: any = handlers[name];
  let params = context.params || {};
  if (!module) {
    const found = name.match(/^(accounts|users)\/([^/]+)$/);
    if (!found) return new Response('Unknown API route', {status:404});
    module = found[1] === 'accounts' ? accountId : userId;
    params = {...params,id: decodeURIComponent(found[2])};
  }
  const handler = module['onRequest' + method.slice(0,1) + method.slice(1).toLowerCase().replace(/^./, (v: string) => v.toUpperCase())]
    || module.onRequest;
  if (typeof handler !== 'function') return new Response('Method not allowed', {status:405});
  // Do not rewrite the trusted request URL: its /slug path is the database identity.
  return handler({...context, params});
};
