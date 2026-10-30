// Artigos da documentação do apoio em elementos React, só com a sintaxe do formato (lib/support/docs-format.ts). Nunca
// HTML em bruto: o texto vai sempre como texto (o React escapa-o) e cada ligação volta a passar por safeHref — uma
// ligação recusada fica só texto. Recebe o createElement e o componente das ligações internas (next/link), para os
// testes poderem desenhar o mesmo resultado sem o Next.
import type { ReactNode } from "react";
import { inlineText, internalTarget, isExternalHref, safeHref, type Block, type Inline, type ListBlock } from "./docs-format";

export type RenderContext = {
  h: (type: any, props: Record<string, unknown> | null, ...children: ReactNode[]) => ReactNode;
  Link: unknown;
  // Ligação para um artigo que esta pessoa não pode ver (só Super Admin): fica texto.
  visible: (slug: string) => boolean;
  headingAction?: (id: string, text: string, level: 2 | 3) => ReactNode;
};

export function renderInline(nodes: Inline[], ctx: RenderContext): ReactNode[] {
  const { h } = ctx;
  return nodes.flatMap((n, key): ReactNode[] => {
    if (n.t === "text") return [n.v];
    if (n.t === "code") return [h("code", { key }, n.v)];
    if (n.t === "strong") return [h("strong", { key }, ...renderInline(n.c, ctx))];
    if (n.t === "em") return [h("em", { key }, ...renderInline(n.c, ctx))];
    const kids = renderInline(n.c, ctx);
    const href = safeHref(n.href);
    if (!href) return kids;
    if (isExternalHref(href))
      return [
        h(
          "a",
          { key, href, target: "_blank", rel: "noopener noreferrer", className: "docs-ext" },
          ...kids,
          h("span", { className: "sr-only" }, " (abre noutro separador)"),
        ),
      ];
    if (href.startsWith("mailto:")) return [h("a", { key, href }, ...kids)];
    const target = internalTarget(href);
    if (target?.slug && !ctx.visible(target.slug)) return kids;
    return [h(ctx.Link, { key, href }, ...kids)];
  });
}

function renderList(b: ListBlock, ctx: RenderContext, key: number): ReactNode {
  const { h } = ctx;
  return h(
    b.t,
    { key, start: b.t === "ol" && b.start !== 1 ? b.start : undefined },
    ...b.items.map((it, i) => h("li", { key: i }, ...renderInline(it.c, ctx), it.sub ? renderList(it.sub, ctx, -1) : null)),
  );
}

const ALIGN_CLASS = { left: "align-left", center: "align-center", right: "align-right" } as const;

// Nome de cada tabela para os leitores de ecrã: as colunas e a secção onde está (com o mesmo nome em todas, a lista de
// zonas da página não as distinguia). Fica com tabIndex para se poder deslizar com o teclado.
function tableLabel(head: Inline[][], section: string): string {
  const cols = head.map((c) => inlineText(c).trim()).filter(Boolean).join(", ");
  return `Tabela${cols ? `: ${cols}` : ""}${section ? ` (${section})` : ""}`;
}

export function renderBlocks(blocks: Block[], ctx: RenderContext, within = ""): ReactNode[] {
  const { h } = ctx;
  let section = within;
  return blocks.map((b, key) => {
    if (b.t === "p") return h("p", { key }, ...renderInline(b.c, ctx));
    // O botão de copiar a ligação fica ao lado do título (dentro dele, entrava no nome lido pelos leitores de ecrã).
    if (b.t === "h2" || b.t === "h3") {
      section = b.text;
      return h(
        "div",
        { key, className: `docs-h-row ${b.t}` },
        h(b.t, { id: b.id, className: "docs-h" }, ...renderInline(b.c, ctx)),
        ctx.headingAction ? ctx.headingAction(b.id, b.text, b.t === "h2" ? 2 : 3) : null,
      );
    }
    if (b.t === "ul" || b.t === "ol") return renderList(b, ctx, key);
    if (b.t === "table") {
      const cls = (c: number) => (b.align[c] ? ALIGN_CLASS[b.align[c]!] : undefined);
      return h(
        "div",
        { key, className: "docs-table", role: "region", tabIndex: 0, "aria-label": tableLabel(b.head, section) },
        h(
          "table",
          null,
          h("thead", null, h("tr", null, ...b.head.map((c, i) => h("th", { key: i, scope: "col", className: cls(i) }, ...renderInline(c, ctx))))),
          h(
            "tbody",
            null,
            ...b.rows.map((r, i) => h("tr", { key: i }, ...r.map((c, j) => h("td", { key: j, className: cls(j) }, ...renderInline(c, ctx))))),
          ),
        ),
      );
    }
    if (b.t === "callout")
      return h(
        "aside",
        { key, className: `docs-callout ${b.kind}`, role: "note", "aria-label": b.label },
        h("p", { className: "docs-callout-label" }, b.label),
        ...renderBlocks(b.blocks, ctx, section),
      );
    return null;
  });
}
