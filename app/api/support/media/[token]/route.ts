import { serverRpc } from "@/lib/support/db";
import { sniffType } from "@/lib/support/rules";

export const dynamic = "force-dynamic";

// Imagem de uma resposta Facebook/Instagram, pública só durante 1 hora e só por um token aleatório de
// 32 bytes: a Meta (através da Metricool) vai buscá-la para a entregar ao cliente. Sem sessão.
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!/^[0-9a-f]{64}$/.test(token)) return notFound();
  const m = await serverRpc<{ type: string; data: string } | null>("ldo_support_media_public", { p_public: token }).catch(() => null);
  if (!m) return notFound();
  const bytes = new Uint8Array(Buffer.from(m.data, "base64"));
  const real = sniffType(bytes);
  if (real !== "image/jpeg" && real !== "image/png") return notFound();
  return new Response(bytes.slice(), {
    headers: {
      "Content-Type": real,
      "Content-Disposition": `inline; filename="imagem.${real === "image/png" ? "png" : "jpg"}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
