import { searchCatalog, shopifyConfigured } from "@/lib/bi/shopify";
import { handle, json, supportViewer } from "@/lib/support/http";

export const dynamic = "force-dynamic";

// Produtos, coleções e páginas publicadas na loja online, para inserir numa resposta.
export async function GET(request: Request) {
  return handle(async () => {
    await supportViewer(request);
    if (!shopifyConfigured()) return json({ items: [], pages: false, error: "Ligação Shopify por configurar." });
    const q = (new URL(request.url).searchParams.get("q") || "").slice(0, 80);
    try {
      return json(await searchCatalog(q));
    } catch (e) {
      return json({ items: [], pages: false, error: e instanceof Error ? e.message : "Shopify indisponível." });
    }
  });
}
