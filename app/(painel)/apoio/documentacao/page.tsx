import { redirect } from "next/navigation";
import { canSupport, homePath } from "@/lib/permissions";
import { suggestedSearches, visibleSupportDocs } from "@/lib/support/docs";
import { searchRecords } from "@/lib/support/docs-search";
import { requireViewer } from "@/lib/viewer";
import { AppShell, PageHeading } from "@/components/shell";
import { DocsSearch } from "@/components/support/docs-search";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documentação do apoio · Loja do Ouro" };

// Documentação do Apoio ao Cliente (menu APOIO AO CLIENTE → Documentação): os artigos de docs/apoio e a pesquisa, que
// corre no browser sobre as secções dos artigos que esta pessoa pode ver (os "super-admin" nunca saem para os outros).
export default async function SupportDocsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canSupport(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const docs = visibleSupportDocs(viewer.isSuper);
  return (
    <AppShell viewer={viewer} current="apoio-docs" title="Documentação">
      <PageHeading
        eyebrow="APOIO AO CLIENTE"
        title="Documentação do apoio"
        text="Como funciona cada parte do Apoio ao Cliente e o enquadramento legal (RGPD e direitos do consumidor). Procure com as suas palavras ou escolha um artigo."
      />
      <DocsSearch
        records={searchRecords(docs)}
        articles={docs.map((d) => ({ slug: d.slug, title: d.title, resumo: d.resumo, category: d.category, superOnly: d.publico === "super-admin" }))}
        suggestions={suggestedSearches(viewer.isSuper)}
        initialQuery={typeof q.q === "string" ? q.q.slice(0, 200) : ""}
      />
    </AppShell>
  );
}
