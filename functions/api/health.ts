import { getEffectiveDb } from './neon-adapter';

export const onRequestGet: PagesFunction = async (context) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  try {
    const db = getEffectiveDb(context);
    await db.prepare('SELECT 1 AS ok').first();
    return new Response(JSON.stringify({ status: 'OK' }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ status: 'ERROR' }), { status: 503, headers });
  }
};
