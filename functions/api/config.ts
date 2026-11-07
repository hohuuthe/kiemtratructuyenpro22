interface Env {
  GEMINI_API_KEY?: string;
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const configured = (value: string | undefined) =>
    !!value && value.length > 5 && !value.includes('YOUR_') && !value.includes('CHƯA_');

  return new Response(JSON.stringify({
    isGeminiConfigured: configured(env.GEMINI_API_KEY),
    isNeonConfigured: configured(env.NEON_DATABASE_URL) || configured(env.DATABASE_URL),
    isR2Configured: configured(env.CLOUDFLARE_R2_ACCESS_KEY_ID) && configured(env.CLOUDFLARE_R2_BUCKET_NAME)
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};
