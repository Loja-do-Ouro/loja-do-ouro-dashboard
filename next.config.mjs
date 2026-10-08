// Configuration readiness only; no credentials are logged.
if (process.env.VERCEL) console.info("[BI readiness]", JSON.stringify({
  url: Boolean(process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL),
  privateReader: Boolean(process.env.BI_INGEST_TOKEN),
  directReader: Boolean(process.env.WINDSOR_API_KEY || process.env.WINDSORAI_API_KEY),
  login: Boolean((process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL) && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.BI_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)),
}));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Widget do chat do site (carregado pelo tema Shopify): cache curta, para as atualizações chegarem depressa.
  async headers() {
    return [{ source: "/site-chat/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=3600" }] }];
  },
};

export default nextConfig;
