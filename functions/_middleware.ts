/** Never serve database backups, server bundles, or environment files as web assets. */
export async function onRequest(context: any): Promise<Response> {
  let path: string;
  try { path=decodeURIComponent(new URL(context.request.url).pathname); } catch { return new Response(null,{status:400}); }
  if (/(?:\.(?:sql|db|sqlite|sqlite3|map|cjs)|\/\.env(?:\.[^/]*)?|\/server\.ts)$/i.test(path)) return new Response(null,{status:404});
  return context.next();
}
