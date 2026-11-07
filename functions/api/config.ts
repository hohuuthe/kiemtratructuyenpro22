interface Env {
  GEMINI_API_KEY: string;
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID: string;
  CLOUDFLARE_R2_BUCKET_NAME: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  
  const isConfigured = (val: string | undefined) => {
    return !!val && val.length > 5 && !val.includes("YOUR_") && !val.includes("CHƯA_");
  };

  const config = {
    isGeminiConfigured: isConfigured(env.GEMINI_API_KEY),
    isNeonConfigured: isConfigured(env.NEON_DATABASE_URL) || isConfigured(env.DATABASE_URL),
    isR2Configured: isConfigured(env.CLOUDFLARE_R2_ACCESS_KEY_ID) && isConfigured(env.CLOUDFLARE_R2_BUCKET_NAME)
  };

  return new Response(JSON.stringify(config), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
};
