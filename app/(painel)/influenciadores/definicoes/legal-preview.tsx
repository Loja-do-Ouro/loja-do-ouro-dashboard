import { parseLegalMarkdown, type LegalInline } from "@/lib/criadores-rules";

// Pré-visualização de um documento legal no backoffice, com o mesmo render seguro do site (parseLegalMarkdown):
// só títulos, parágrafos, listas, negrito, itálico e ligações https ou caminhos do site. Nada de HTML. As ligações
// internas mostram-se como texto (o caminho é do site dos criadores, não do dashboard).

function Inline({ items }: { items: LegalInline[] }) {
  return (
    <>
      {items.map((x, i) =>
        x.t === "text" ? (
          <span key={i}>{x.v}</span>
        ) : x.t === "strong" ? (
          <strong key={i}><Inline items={x.c} /></strong>
        ) : x.t === "em" ? (
          <em key={i}><Inline items={x.c} /></em>
        ) : x.internal ? (
          <span key={i} title={`Ligação do site: ${x.href}`} style={{ textDecoration: "underline dotted" }}><Inline items={x.c} /></span>
        ) : (
          <a key={i} href={x.href} target="_blank" rel="noopener noreferrer nofollow"><Inline items={x.c} /></a>
        ),
      )}
    </>
  );
}

export function LegalPreview({ body }: { body: string }) {
  const blocks = parseLegalMarkdown(body || "");
  if (!blocks.length) return <p className="muted">Documento vazio.</p>;
  return (
    <div style={{ maxWidth: 760, lineHeight: 1.7, fontSize: 13, maxHeight: 520, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 18px" }}>
      {blocks.map((b, i) => {
        if (b.t === "hr") return <hr key={i} />;
        if (b.t === "h") {
          const H = (`h${b.level + 1}` as "h3" | "h4" | "h5");
          return <H key={i} style={{ margin: "16px 0 6px" }}><Inline items={b.c} /></H>;
        }
        if (b.t === "p") return <p key={i} style={{ margin: "8px 0" }}><Inline items={b.c} /></p>;
        const L = b.t;
        return (
          <L key={i} style={{ paddingLeft: 20, margin: "8px 0" }}>
            {b.items.map((it, j) => (
              <li key={j}><Inline items={it} /></li>
            ))}
          </L>
        );
      })}
    </div>
  );
}
