// Configuration readiness only; no credentials are logged.
if (process.env.VERCEL) console.info("[BI readiness]", JSON.stringify({
  url: Boolean(process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL),
  privateReader: Boolean(process.env.BI_SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY),
  directReader: Boolean(process.env.WINDSOR_API_KEY || process.env.WINDSORAI_API_KEY),
  login: Boolean((process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL) && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.BI_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)),
}));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
