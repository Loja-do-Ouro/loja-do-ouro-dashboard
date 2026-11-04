import Link from "next/link";
import type { ReactNode } from "react";
import { lisbonDate, parseLegalMarkdown, type LegalBlock, type LegalInline } from "@/lib/criadores-rules";
import { crLegalPublic, type CrCompany, type CrLegalDoc } from "@/lib/criadores/db";

// Documentos legais do site (§4.3 c/legal.tsx): o Markdown publicado no backoffice é desenhado com React a partir de
// parseLegalMarkdown (lib/criadores-rules.ts), sem dangerouslySetInnerHTML. Só parágrafos, títulos, listas, negrito,
// itálico e ligações https (externas, com rel="noopener noreferrer nofollow") ou caminhos do site («/dados-meta»,
// prefixados com /c no endereço do dashboard). Qualquer outra coisa fica como texto.

type PublicKind = "terms" | "privacy" | "cookies" | "meta_data";
export type LegalPage = { company: CrCompany | null; registrationsOpen: boolean; document: CrLegalDoc | null };

// Documento publicado (ou null) e a identificação legal. Uma falha da BD não deita a página abaixo: mostra «em
// preparação» e a identificação que houver.
export async function loadLegal(kind: PublicKind): Promise<LegalPage> {
  try {
    const r = await crLegalPublic(kind);
    return { company: r.company, registrationsOpen: r.registrations_open, document: r.document };
  } catch {
    return { company: null, registrationsOpen: false, document: null };
  }
}

function Inline({ nodes, base }: { nodes: LegalInline[]; base: string }): ReactNode {
  return nodes.map((n, i) => {
    if (n.t === "text") return n.v;
    if (n.t === "strong") return <strong key={i}><Inline nodes={n.c} base={base} /></strong>;
    if (n.t === "em") return <em key={i}><Inline nodes={n.c} base={base} /></em>;
    if (n.internal) return <Link key={i} href={`${base}${n.href}`}><Inline nodes={n.c} base={base} /></Link>;
    return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow"><Inline nodes={n.c} base={base} /></a>;
  });
}

function Block({ b, base }: { b: LegalBlock; base: string }) {
  if (b.t === "h") {
    const H = (`h${b.level}` as "h2" | "h3" | "h4");
    return <H><Inline nodes={b.c} base={base} /></H>;
  }
  if (b.t === "p") return <p><Inline nodes={b.c} base={base} /></p>;
  if (b.t === "hr") return <hr />;
  const L = b.t;
  return <L>{b.items.map((item, i) => <li key={i}><Inline nodes={item} base={base} /></li>)}</L>;
}

// O título do documento («# Cookies», «# Termos de participação…») já está no h1 de LegalHead: um título «#» único
// (h2) entre os dois primeiros blocos (depois do aviso «Em revisão jurídica», por exemplo) não se repete.
function withoutDocTitle(blocks: LegalBlock[]): LegalBlock[] {
  const top = blocks.filter((b) => b.t === "h" && b.level === 2);
  if (top.length !== 1) return blocks;
  const i = blocks.indexOf(top[0]);
  return i <= 1 && blocks.slice(0, i).every((b) => b.t === "p") ? blocks.filter((_, j) => j !== i) : blocks;
}

export function LegalMarkdown({ body, base }: { body: string; base: string }) {
  return <div className="cr-prosa">{withoutDocTitle(parseLegalMarkdown(body)).map((b, i) => <Block key={i} b={b} base={base} />)}</div>;
}

// Cabeçalho de um documento: título, versão e data de publicação (dados em Archivo).
export function LegalHead({ title, doc, children }: { title: string; doc: CrLegalDoc | null; children?: ReactNode }) {
  return (
    <header className="cr-abre">
      <p className="cr-chapeu">Loja do Ouro Criadores</p>
      <h1 className="cr-d-l">{title}</h1>
      {doc ? (
        <p className="cr-meta cr-num">Versão {doc.version} · publicada a {lisbonDate(doc.published_at)}</p>
      ) : (
        <p className="cr-meta">Documento em preparação.</p>
      )}
      {children}
    </header>
  );
}

const or = (v: string | null | undefined, fallback: string) => (v && String(v).trim() ? String(v) : fallback);

// Identificação legal (editável em Influenciadores → Definições).
export function Identity({ company }: { company: CrCompany | null }) {
  const c = company;
  return (
    <dl className="cr-ficha">
      <dt>Empresa</dt><dd>{or(c?.company_name, "[denominação social a indicar]")}</dd>
      <dt>NIF</dt><dd className="cr-num">{or(c?.company_nif, "[a indicar]")}</dd>
      <dt>Sede</dt><dd>{or(c?.company_address, "[morada a indicar]")}</dd>
      <dt>Registo</dt><dd>{or(c?.company_registry, "[conservatória e número a indicar]")}</dd>
      <dt>Contacto</dt><dd>{or(c?.contact_email, "criadores@lojadoouro.pt")}</dd>
      <dt>Privacidade</dt><dd>{or(c?.privacy_email, "privacidade@lojadoouro.pt")}</dd>
    </dl>
  );
}

// Corpo de uma página legal: o documento publicado ou, sem ele, o texto de recurso da própria página.
export function LegalBody({ page, base, fallback }: { page: LegalPage; base: string; fallback?: ReactNode }) {
  if (page.document) {
    return (
      <>
        {page.document.changes_summary && (
          <div className="cr-aviso">
            <strong>O que mudou nesta versão</strong>
            <p>{page.document.changes_summary}</p>
          </div>
        )}
        <LegalMarkdown body={page.document.body} base={base} />
      </>
    );
  }
  return (
    <>
      <div className="cr-aviso">
        <strong>Em revisão jurídica</strong>
        <p>A versão final deste documento é publicada antes de abrirem as inscrições.</p>
      </div>
      {fallback}
    </>
  );
}
