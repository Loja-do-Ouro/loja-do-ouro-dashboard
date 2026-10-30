import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createElement } from "react";
import { canSupport, homePath } from "@/lib/permissions";
import { visibleSupportDocs } from "@/lib/support/docs";
import { CATEGORY_LABEL, type DocSection } from "@/lib/support/docs-format";
import { renderBlocks } from "@/lib/support/docs-render";
import { relatedDocs } from "@/lib/support/docs-search";
import { loadViewer, requireViewer } from "@/lib/viewer";
import { AppShell } from "@/components/shell";
import { DocsCopyLink, DocsSlashFocus } from "@/components/support/docs-client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// O título no separador só para quem pode ver o artigo (um artigo do Super Admin não se revela pelo título).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const viewer = await loadViewer();
  const { slug } = await params;
  const doc = viewer && canSupport(viewer) ? visibleSupportDocs(viewer.isSuper).find((d) => d.slug === slug) : null;
  return { title: `${doc ? doc.title : "Documentação do apoio"} · Loja do Ouro` };
}

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

function Toc({ sections }: { sections: DocSection[] }) {
  return (
    <ol>
      {sections.map((s) => (
        <li key={s.id}>
          <a href={`#${s.id}`}>{s.heading}</a>
        </li>
      ))}
    </ol>
  );
}

// Um artigo da documentação do apoio (docs/apoio/NN-slug.md). Mesmo acesso que /apoio; um artigo "super-admin" dá 404 a
// quem não é Super Admin.
export default async function SupportDocPage({ params }: Props) {
  const viewer = await requireViewer();
  if (!canSupport(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const { slug } = await params;
  const docs = visibleSupportDocs(viewer.isSuper);
  const at = docs.findIndex((d) => d.slug === slug);
  if (at < 0) notFound();
  const doc = docs[at];
  const prev = docs[at - 1];
  const next = docs[at + 1];
  const visible = new Set(docs.map((d) => d.slug));
  const toc = doc.sections.filter((s) => s.level === 2);
  const related = relatedDocs(doc, docs);
  const body = renderBlocks(doc.blocks, {
    h: createElement,
    Link,
    visible: (s) => visible.has(s),
    headingAction: (id, text) => <DocsCopyLink id={id} label={text} />,
  });

  return (
    <AppShell viewer={viewer} current="apoio-docs" title="Documentação">
      <DocsSlashFocus target="docs-procurar" />
      <nav className="docs-crumbs" aria-label="Caminho">
        <Link href="/apoio/documentacao">Documentação</Link>
        <span aria-hidden="true">›</span>
        <span>{CATEGORY_LABEL[doc.category]}</span>
      </nav>
      <div className="docs-layout">
        <article className="docs-article" aria-labelledby="docs-titulo">
          <header className="docs-article-head">
            <span className="eyebrow">{CATEGORY_LABEL[doc.category]}</span>
            <h1 id="docs-titulo">{doc.title}</h1>
            <p className="docs-resumo">{doc.resumo}</p>
            {(doc.atualizado || doc.publico === "super-admin") && (
              <p className="docs-meta">
                {doc.atualizado && (
                  <span>
                    Atualizado em <time dateTime={doc.atualizado}>{longDate(doc.atualizado)}</time>
                  </span>
                )}
                {doc.publico === "super-admin" && <span className="pill">Só o Super Admin vê este artigo</span>}
              </p>
            )}
          </header>
          {toc.length > 1 && (
            <details className="docs-toc-mobile">
              <summary>Nesta página ({toc.length} secções)</summary>
              <Toc sections={toc} />
            </details>
          )}
          <div className="docs-body">{body}</div>
          {(prev || next) && (
            <nav className="docs-pager" aria-label="Artigo anterior e seguinte">
              {prev ? (
                <Link href={`/apoio/documentacao/${prev.slug}`} rel="prev" className="docs-pager-prev">
                  <small>← Anterior</small>
                  <strong>{prev.title}</strong>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={`/apoio/documentacao/${next.slug}`} rel="next" className="docs-pager-next">
                  <small>Seguinte →</small>
                  <strong>{next.title}</strong>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </article>
        <aside className="docs-aside" aria-label="Neste artigo">
          <form action="/apoio/documentacao" method="get" role="search" className="docs-mini-search">
            <label htmlFor="docs-procurar" className="sr-only">
              Procurar na documentação
            </label>
            <input id="docs-procurar" name="q" type="search" maxLength={200} placeholder="Procurar na documentação ( / )" autoComplete="off" />
          </form>
          {toc.length > 0 && (
            <nav className="docs-toc" aria-label="Nesta página">
              <p className="eyebrow">Nesta página</p>
              <Toc sections={toc} />
            </nav>
          )}
          {related.length > 0 && (
            <section className="docs-related" aria-labelledby="docs-relacionados">
              <p className="eyebrow" id="docs-relacionados">
                Artigos relacionados
              </p>
              <ul>
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/apoio/documentacao/${r.slug}`}>{r.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
