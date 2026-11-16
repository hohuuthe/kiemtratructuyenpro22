import { finalizeDueExamLiveness } from '../functions/api/exam/finalize-service';

/**
 * Dedicated Cloudflare Cron Worker. Configure exact same database tenant
 * bindings as Pages; never forward tenant data to another tenant.
 */
export default {
  async scheduled(_event: ScheduledEvent, env: any, ctx: ExecutionContext) {
    const slugs = String(env.EXAM_FINALIZER_TENANTS || '')
      .split(',').map(x=>x.trim()).filter(Boolean);
    // Default tenant is always checked; slug-based tenants require explicit
    // registration AND a database binding with exactly the slug's name.
    const tenants = ['', ...new Set(slugs.filter(x=>/^[A-Za-z0-9_-]{1,80}$/.test(x)))];
    for (const slug of tenants) {
      const path = slug ? '/'+slug+'/api/exam/finalize' : '/api/exam/finalize';
      const request = new Request('https://exam-finalizer.internal'+path);
      try {
        await finalizeDueExamLiveness({ request, env }, 40);
      } catch (error) {
        // Never allow a failure for one tenant to silently process another DB.
        console.error('Exam-finalizer tenant sweep failed:', slug||'default', error);
      }
    }
  }
};
