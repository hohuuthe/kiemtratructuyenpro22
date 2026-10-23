/** Legacy destructive D1 migration is not supported on Neon. */
export const onRequest = async () => new Response(JSON.stringify({
  error: 'Schema maintenance is disabled in the public API.', code: 'MAINTENANCE_DISABLED'
}), {status:410, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
