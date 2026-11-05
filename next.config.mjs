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
  // Em desenvolvimento, o Next escreve no terminal os argumentos das Server Functions (palavras-passe, tokens
  // do link de acesso). Desligado: nenhum segredo vai para registos.
  logging: { serverFunctions: false },
  // Site dos criadores: o logótipo passa pelo otimizador do próprio site (/_next/image), para o browser dos visitantes
  // nunca falar com a Shopify (a Política de Privacidade não a lista como destinatária). Só este ficheiro, com a query
  // exata; as fotografias da página inicial são ficheiros do próprio site (app/(criadores-site)/c/fotos).
  images: {
    qualities: [75],
    remotePatterns: [
      { protocol: "https", hostname: "www.lojadoouro.pt", pathname: "/cdn/shop/files/logo_horizontal_f74be36a-8ff7-48e9-8e46-9c150f0d3c69.png", search: "?v=1763540816&width=840" },
    ],
  },
  async headers() {
    // O host criadores.* recebe os seus cabeçalhos do proxy.ts (CSP com nonce, que já leva frame-ancestors 'none').
    const notCreatorsHost = [{ type: "host", value: "criadores\\..*" }];
    return [
      // Widget do chat do site (carregado pelo tema Shopify): cache curta, para as atualizações chegarem depressa.
      { source: "/site-chat/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=3600" }] },
      // O dashboard nunca pode ser posto num iframe de outro site [rev. S-M4]. Os cabeçalhos daqui ganham aos que uma
      // rota define (server/send-response.js só junta os que faltam), por isso ficam de fora:
      // - /api/support/attachments: pré-visualização de PDF dentro do próprio dashboard (X-Frame-Options SAMEORIGIN
      //   e frame-ancestors 'self', definidos na rota);
      // - a CSP em /api/*: as rotas de ficheiros definem a sua (default-src 'none', sandbox) e não a podem perder;
      // - a CSP em /c: as páginas do site dos criadores levam a CSP com nonce do proxy.ts.
      {
        source: "/:path((?!api/support/attachments$).*)",
        missing: notCreatorsHost,
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/:path((?!api/|c$|c/).*)",
        missing: notCreatorsHost,
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;
