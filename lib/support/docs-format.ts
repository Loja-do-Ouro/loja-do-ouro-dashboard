// Documentação do Apoio ao Cliente: formato dos artigos em docs/apoio/NN-slug.md (ver README, Apoio ao Cliente).
// Sem importações: o mesmo ficheiro serve o script de geração (scripts/build-support-docs.mjs, que o transpila), o
// servidor (lib/support/docs.ts) e os testes. Um artigo mal formado nunca chega à produção: a geração falha com o
// ficheiro e a linha de cada problema.
//
// Formato (resumo): linha 1 "# Título"; logo a seguir <!-- resumo: … --> (obrigatório), <!-- publico: todos |
// super-admin -->, <!-- termos: a, b --> e <!-- atualizado: AAAA-MM-DD -->. Secções "## " e "### " (âncora = título
// sem acentos, em minúsculas e com hífens), com <!-- perguntas: … | … --> logo abaixo do título. Só parágrafos, listas
// "- " e "1. " (um nível dentro, com 2 espaços), **negrito**, *itálico*, `código`, [texto](url), tabelas com cabeçalho e
// avisos "> **Atenção:**", "> **Dica:**", "> **Lei:**" ou "> **Nota:**". Sem HTML e sem imagens.

export type DocAudience = "todos" | "super-admin";
export type DocCategory = "funcionamento" | "legal" | "referencia";
export type CalloutKind = "atencao" | "dica" | "lei" | "nota";

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };
export type ListItem = { c: Inline[]; sub: ListBlock | null };
export type ListBlock = { t: "ul" | "ol"; start: number; items: ListItem[] };
export type CellAlign = "left" | "center" | "right" | null;
export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h2" | "h3"; id: string; text: string; c: Inline[] }
  | ListBlock
  | { t: "table"; align: CellAlign[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "callout"; kind: CalloutKind; label: string; blocks: Block[] };

// Secção para a pesquisa e o índice: id "" é a introdução (antes do primeiro ##); text é só o texto da própria secção
// (até ao título seguinte), sem marcação.
export type DocSection = { id: string; level: 1 | 2 | 3; heading: string; parent: string | null; perguntas: string[]; text: string };

export type SupportDoc = {
  file: string;
  slug: string;
  order: number;
  category: DocCategory;
  title: string;
  resumo: string;
  publico: DocAudience;
  termos: string[];
  atualizado: string | null;
  blocks: Block[];
  sections: DocSection[];
};
export type DocSource = { file: string; source: string };
type DocLink = { slug: string; anchor: string; line: number };

export const DOCS_BASE = "/apoio/documentacao";
export const CATEGORY_LABEL: Record<DocCategory, string> = {
  funcionamento: "Como funciona",
  legal: "Enquadramento legal",
  referencia: "Referência",
};
export const CALLOUT_LABEL: Record<CalloutKind, string> = { atencao: "Atenção", dica: "Dica", lei: "Lei", nota: "Nota" };
const CALLOUT_KIND: Record<string, CalloutKind> = { "Atenção": "atencao", Dica: "dica", Lei: "lei", Nota: "nota" };
const META_KEYS = new Set(["resumo", "publico", "termos", "atualizado"]);
// Ids que a página já usa: uma secção com o mesmo título partia a navegação.
const RESERVED_IDS = new Set(["conteudo", "menu-lateral", "docs-titulo", "docs-procurar", "docs-relacionados"]);

// Minúsculas, sem acentos (ç → c) e com os símbolos compatíveis decompostos (º → o).
export function fold(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

// Âncora de uma secção: "Transferir uma conversa" → "transferir-uma-conversa".
export function slugify(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// O texto guardado e comparado: sem BOM, fins de linha LF (o Git no Windows pode pôr CRLF), sem espaços no fim das
// linhas e tabulações iniciais como 2 espaços.
export function normalizeSource(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\t+/, (t) => "  ".repeat(t.length)).replace(/\s+$/, ""))
    .join("\n");
}

const INTERNAL = /^\/apoio\/documentacao(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?\/?(?:\?[^#]*)?(?:#([a-z0-9]+(?:-[a-z0-9]+)*))?$/;

// Só passam http(s), mailto e as páginas da documentação; tudo o resto (javascript:, data:, outras páginas, caminhos
// relativos) devolve null e aparece como texto simples.
export function safeHref(raw: string): string | null {
  const href = String(raw ?? "").trim();
  if (!href || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(href)) return null;
  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      return (u.protocol === "https:" || u.protocol === "http:") && u.hostname ? href : null;
    } catch {
      return null;
    }
  }
  if (/^mailto:[^@\s/:]+@[^@\s/]+\.[^@\s/]+$/i.test(href)) return href;
  return INTERNAL.test(href) ? href : null;
}

// Artigo e secção de uma ligação interna (slug null: a lista ou a pesquisa); null para ligações externas.
export function internalTarget(href: string): { slug: string | null; anchor: string } | null {
  const m = INTERNAL.exec(href);
  return m ? { slug: m[1] || null, anchor: m[2] || "" } : null;
}

export const isExternalHref = (href: string) => /^https?:\/\//i.test(href);

export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : inlineText(n.c))).join("");
}

function blockText(b: Block): string {
  if (b.t === "p" || b.t === "h2" || b.t === "h3") return inlineText(b.c);
  if (b.t === "ul" || b.t === "ol") return b.items.map((it) => [inlineText(it.c), it.sub ? blockText(it.sub) : ""].filter(Boolean).join(" ")).join(" ");
  if (b.t === "table") return [b.head, ...b.rows].map((r) => r.map(inlineText).join(" · ")).join(" ");
  if (b.t === "callout") return b.blocks.map(blockText).join(" ");
  return "";
}

export function categoryOf(order: number): DocCategory {
  return order >= 30 ? "referencia" : order >= 20 ? "legal" : "funcionamento";
}

type Ctx = { file: string; slug: string; errors: string[]; links: DocLink[] };
const fail = (ctx: Ctx, line: number, msg: string) => {
  ctx.errors.push(`${ctx.file}:${line}: ${msg}`);
};

// ------------------------------------------------------------------------------------------------- texto em linha

function codeEnd(src: string, i: number): number {
  const end = src.indexOf("`", i + 1);
  return end > i + 1 ? end : -1;
}

// Próximo "**" fora de código.
function findStrongClose(src: string, from: number): number {
  for (let j = from; j < src.length - 1; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "`") {
      const e = codeEnd(src, j);
      if (e > 0) j = e;
      continue;
    }
    if (src[j] === "*" && src[j + 1] === "*" && j > from) return j;
  }
  return -1;
}

// Próximo "*" sozinho (não "**"), fora de código e colado ao texto ("5 * 3" não é itálico).
function findEmClose(src: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "`") {
      const e = codeEnd(src, j);
      if (e > 0) j = e;
      continue;
    }
    if (src[j] === "*") {
      if (src[j + 1] === "*") {
        const e = findStrongClose(src, j + 2);
        if (e > 0) {
          j = e + 1;
          continue;
        }
        return -1;
      }
      return j > from && src[j - 1] !== " " ? j : -1;
    }
  }
  return -1;
}

function matching(src: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === "`" && open === "[") {
      const e = codeEnd(src, j);
      if (e > 0) j = e;
      continue;
    }
    if (src[j] === open) depth++;
    else if (src[j] === close && --depth === 0) return j;
  }
  return -1;
}

const HTML_TAG = /^(?:<!--|<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>)/;

function resolveHref(url: string, ctx: Ctx, line: number): string | null {
  const raw = url.trim();
  const href = raw.startsWith("#") ? `${DOCS_BASE}/${ctx.slug}${raw}` : raw;
  const safe = safeHref(href);
  if (!safe) {
    fail(ctx, line, `ligação não permitida: "${raw}" (só https://…, mailto:… ou ${DOCS_BASE}/<artigo>#<secção>)`);
    return null;
  }
  const target = internalTarget(safe);
  if (target?.slug) ctx.links.push({ slug: target.slug, anchor: target.anchor, line });
  return safe;
}

export function parseInline(src: string, ctx: Ctx, line: number, inLink = false): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const push = (node: Inline) => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
    out.push(node);
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|<>~]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = codeEnd(src, i);
      if (end > 0) {
        push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === "*" && src[i + 1] === "*") {
      const end = findStrongClose(src, i + 2);
      if (end > 0) {
        push({ t: "strong", c: parseInline(src.slice(i + 2, end), ctx, line, inLink) });
        i = end + 2;
        continue;
      }
      buf += "**";
      i += 2;
      continue;
    } else if (ch === "*" && src[i + 1] && src[i + 1] !== " ") {
      const end = findEmClose(src, i + 1);
      if (end > 0) {
        push({ t: "em", c: parseInline(src.slice(i + 1, end), ctx, line, inLink) });
        i = end + 1;
        continue;
      }
    } else if (ch === "!" && src[i + 1] === "[") {
      fail(ctx, line, "imagens não são suportadas na documentação");
    } else if (ch === "[" && !inLink) {
      const close = matching(src, i, "[", "]");
      if (close > 0 && src[close + 1] === "(") {
        const paren = matching(src, close + 1, "(", ")");
        if (paren > 0) {
          const children = parseInline(src.slice(i + 1, close), ctx, line, true);
          const url = src.slice(close + 2, paren);
          const href = resolveHref(url, ctx, line);
          if (!children.length) fail(ctx, line, `ligação sem texto: "${url}"`);
          if (href) push({ t: "link", href, c: children.length ? children : [{ t: "text", v: url }] });
          else {
            // Ligação recusada: fica só o texto.
            if (buf) out.push({ t: "text", v: buf });
            buf = "";
            out.push(...children);
          }
          i = paren + 1;
          continue;
        }
      }
    } else if (ch === "<" && HTML_TAG.test(src.slice(i))) {
      fail(ctx, line, `HTML não é suportado ("${HTML_TAG.exec(src.slice(i))![0].slice(0, 30)}"): use Markdown`);
    }
    buf += ch;
    i++;
  }
  if (buf) out.push({ t: "text", v: buf });
  // Junta textos seguidos (um "**" sem fecho fica texto ao lado do resto).
  return out.reduce<Inline[]>((acc, n) => {
    const last = acc[acc.length - 1];
    if (n.t === "text" && last?.t === "text") last.v += n.v;
    else acc.push(n.t === "text" ? { t: "text", v: n.v } : n);
    return acc;
  }, []);
}

// ------------------------------------------------------------------------------------------------- blocos

const HEADING = /^(#{1,6})(?:\s+(.*))?$/;
const UL_ITEM = /^ ?- (.*)$/;
const OL_ITEM = /^ ?(\d{1,3})\. (.*)$/;
const NESTED_ITEM = /^( {2,})(-|\d{1,3}\.) (.*)$/;
const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;
const COMMENT = /^<!--\s*([A-Za-zÀ-ú]+)\s*:\s*(.*?)\s*-->$/;

function isBlockStart(line: string): boolean {
  return (
    HEADING.test(line) ||
    line.startsWith("|") ||
    line.startsWith(">") ||
    UL_ITEM.test(line) ||
    OL_ITEM.test(line) ||
    /^\s*<!--/.test(line) ||
    /^\s*(```|~~~)/.test(line) ||
    /^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/.test(line)
  );
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let code = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    // "\|" é uma barra dentro da célula (também dentro de `código`, onde o resto do texto fica tal e qual).
    if (ch === "\\" && s[k + 1] === "|") {
      cur += code ? "|" : "\\|";
      k++;
      continue;
    }
    if (ch === "`") code = !code;
    if (ch === "|" && !code) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

type Pending = { text: string; line: number; sub: { t: "ul" | "ol"; start: number; items: { text: string; line: number }[] } | null };

type BodyHooks = {
  // Só no corpo do artigo: os títulos abrem secções; dentro de um aviso não há títulos, tabelas nem outros avisos.
  heading?: (level: 2 | 3, text: string, line: number, perguntas: string[] | null) => Block | null;
  onBlock?: (b: Block) => void;
};

function parseBody(lines: string[], lineNo: (i: number) => number, ctx: Ctx, hooks: BodyHooks, inCallout: boolean): Block[] {
  const blocks: Block[] = [];
  const add = (b: Block) => {
    blocks.push(b);
    hooks.onBlock?.(b);
  };
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    const ln = lineNo(i);
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      const text = (h[2] || "").trim();
      i++;
      if (inCallout || !hooks.heading) {
        fail(ctx, ln, "títulos não podem estar dentro de um aviso");
        continue;
      }
      if (level !== 2 && level !== 3) {
        fail(ctx, ln, level === 1 ? "só pode haver um título # (a primeira linha)" : "só são suportados títulos ## e ###");
        continue;
      }
      if (!text) {
        fail(ctx, ln, "título vazio");
        continue;
      }
      // Perguntas a que a secção responde: o comentário logo a seguir ao título (linhas vazias pelo meio contam).
      let j = i;
      while (j < n && !lines[j].trim()) j++;
      let perguntas: string[] | null = null;
      const c = j < n ? COMMENT.exec(lines[j].trim()) : null;
      if (c && fold(c[1]) === "perguntas") {
        perguntas = c[2]
          .split("|")
          .map((q) => q.trim())
          .filter(Boolean);
        if (!perguntas.length) fail(ctx, lineNo(j), "<!-- perguntas: --> vazio");
        i = j + 1;
      }
      const b = hooks.heading(level, text, ln, perguntas);
      if (b) add(b);
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      const c = COMMENT.exec(line.trim());
      const key = c ? fold(c[1]) : "";
      fail(
        ctx,
        ln,
        !c
          ? "comentário mal formado (tem de abrir e fechar na mesma linha: <!-- chave: valor -->)"
          : key === "perguntas"
            ? "<!-- perguntas: … --> tem de ficar logo abaixo de um título ## ou ###"
            : META_KEYS.has(key)
              ? `<!-- ${key}: … --> tem de ficar logo a seguir ao título do artigo`
              : `comentário desconhecido "${c[1]}"`,
      );
      i++;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      fail(ctx, ln, "blocos de código não são suportados (use `código` dentro do texto)");
      i++;
      continue;
    }
    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      fail(ctx, ln, "linhas horizontais (---) não são suportadas");
      i++;
      continue;
    }
    if (/^\s*<\/?[a-zA-Z]/.test(line)) {
      fail(ctx, ln, "HTML não é suportado: use Markdown");
      i++;
      continue;
    }
    if (/^\s*!\[/.test(line)) {
      fail(ctx, ln, "imagens não são suportadas na documentação");
      i++;
      continue;
    }
    if (/^ ?[*+] /.test(line) || /^ ?\d{1,3}\) /.test(line)) {
      fail(ctx, ln, 'listas: use "- " ou "1. " no início da linha');
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const start = i;
      const inner: string[] = [];
      while (i < n && lines[i].startsWith(">")) inner.push(lines[i++].replace(/^> ?/, ""));
      if (inCallout) {
        fail(ctx, ln, "um aviso não pode ter outro aviso dentro");
        continue;
      }
      const k = inner.findIndex((l) => l.trim());
      const m = k >= 0 ? /^\*\*(Atenção|Dica|Lei|Nota):\*\*\s*(.*)$/.exec(inner[k].trim()) : null;
      if (!m) {
        fail(ctx, ln, 'um aviso (">") tem de começar por **Atenção:**, **Dica:**, **Lei:** ou **Nota:**');
        continue;
      }
      inner[k] = m[2];
      const kids = parseBody(inner, (x) => lineNo(start + x), ctx, {}, true);
      if (!kids.length) fail(ctx, ln, `aviso **${m[1]}:** sem texto`);
      add({ t: "callout", kind: CALLOUT_KIND[m[1]], label: m[1], blocks: kids });
      continue;
    }
    if (line.startsWith("|")) {
      const start = i;
      const rows: string[] = [];
      while (i < n && lines[i].startsWith("|")) rows.push(lines[i++]);
      if (inCallout) {
        fail(ctx, ln, "tabelas não podem estar dentro de um aviso");
        continue;
      }
      if (rows.length < 2 || !TABLE_SEP.test(rows[1])) {
        fail(ctx, ln, "tabela sem cabeçalho: a segunda linha tem de ser o separador (| --- | --- |)");
        continue;
      }
      const head = splitRow(rows[0]);
      const sep = splitRow(rows[1]);
      if (sep.length !== head.length) fail(ctx, lineNo(start + 1), `o separador tem ${sep.length} colunas e o cabeçalho ${head.length}`);
      const align: CellAlign[] = head.map((_, c) => {
        const s = sep[c] || "";
        return s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : s.startsWith(":") ? "left" : null;
      });
      const body = rows.slice(2).map((r, x) => {
        const cells = splitRow(r);
        if (cells.length !== head.length) fail(ctx, lineNo(start + 2 + x), `a linha da tabela tem ${cells.length} colunas e o cabeçalho ${head.length}`);
        return head.map((_, c) => parseInline(cells[c] || "", ctx, lineNo(start + 2 + x)));
      });
      if (!body.length) fail(ctx, ln, "tabela sem linhas");
      add({ t: "table", align, head: head.map((c) => parseInline(c, ctx, ln)), rows: body });
      continue;
    }
    const ul = UL_ITEM.exec(line);
    const ol = OL_ITEM.exec(line);
    if (ul || ol) {
      const t: "ul" | "ol" = ul ? "ul" : "ol";
      const top = t === "ul" ? UL_ITEM : OL_ITEM;
      const other = t === "ul" ? OL_ITEM : UL_ITEM;
      const items: Pending[] = [];
      let last: { text: string; line: number } | null = null;
      while (i < n) {
        const l = lines[i];
        if (!l.trim()) {
          // Uma linha vazia só continua a lista se a seguir vier outro item dela.
          let j = i + 1;
          while (j < n && !lines[j].trim()) j++;
          if (j < n && (top.test(lines[j]) || (items.length && NESTED_ITEM.test(lines[j])))) {
            i = j;
            continue;
          }
          break;
        }
        const tm = top.exec(l);
        if (tm) {
          const text = t === "ul" ? tm[1] : tm[2];
          const item: Pending = { text, line: lineNo(i), sub: null };
          items.push(item);
          last = item;
          i++;
          continue;
        }
        if (other.test(l)) break;
        const nm = NESTED_ITEM.exec(l);
        if (nm && items.length) {
          const parent = items[items.length - 1];
          const nt: "ul" | "ol" = nm[2] === "-" ? "ul" : "ol";
          if (!parent.sub) parent.sub = { t: nt, start: nt === "ol" ? Number(nm[2].slice(0, -1)) : 1, items: [] };
          else if (parent.sub.t !== nt) fail(ctx, lineNo(i), 'uma lista dentro de outra não pode misturar "- " e "1. "');
          last = { text: nm[3], line: lineNo(i) };
          parent.sub.items.push(last);
          i++;
          continue;
        }
        if (!/^\s/.test(l) && isBlockStart(l)) break;
        // Continuação do item anterior (linha indentada ou texto corrido).
        if (last) last.text += ` ${l.trim()}`;
        i++;
      }
      const inline = (x: { text: string; line: number }) => {
        if (!x.text.trim()) fail(ctx, x.line, "item de lista vazio");
        return parseInline(x.text.trim(), ctx, x.line);
      };
      add({
        t,
        start: ol ? Number(ol[1]) : 1,
        items: items.map((it) => ({
          c: inline(it),
          sub: it.sub ? { t: it.sub.t, start: it.sub.start, items: it.sub.items.map((s) => ({ c: inline(s), sub: null })) } : null,
        })),
      });
      continue;
    }
    // Parágrafo: linhas seguidas até uma linha vazia ou outro bloco.
    const parts = [line.trim()];
    i++;
    while (i < n && lines[i].trim() && !isBlockStart(lines[i])) parts.push(lines[i++].trim());
    add({ t: "p", c: parseInline(parts.join(" "), ctx, ln) });
  }
  return blocks;
}

// ------------------------------------------------------------------------------------------------- artigo

const isValidDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

export function parseSupportDoc(file: string, raw: string): { doc: SupportDoc | null; errors: string[]; links: DocLink[] } {
  const name = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(file);
  const ctx: Ctx = { file, slug: name?.[2] || "", errors: [], links: [] };
  if (!name) {
    ctx.errors.push(`${file}: nome inválido (use NN-endereco.md, só minúsculas, números e hífens; ex.: 03-transferir-conversas.md)`);
    return { doc: null, errors: ctx.errors, links: [] };
  }
  const lines = normalizeSource(raw).split("\n");
  const t = /^# (.+)$/.exec(lines[0] || "");
  const title = t ? inlineText(parseInline(t[1].trim(), ctx, 1)).trim() : "";
  if (!title) fail(ctx, 1, 'a primeira linha tem de ser o título do artigo: "# Título"');

  // Metadados: comentários logo a seguir ao título.
  const meta: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const c = COMMENT.exec(line);
    if (!c) break;
    const key = fold(c[1]);
    if (key === "perguntas") {
      fail(ctx, i + 1, "<!-- perguntas: … --> tem de ficar logo abaixo de um título ## ou ###");
      continue;
    }
    if (!META_KEYS.has(key)) {
      fail(ctx, i + 1, `metadado desconhecido "${c[1]}" (use resumo, publico, termos ou atualizado)`);
      continue;
    }
    if (key in meta) fail(ctx, i + 1, `metadado "${key}" repetido`);
    meta[key] = c[2];
  }
  const resumo = meta.resumo ? inlineText(parseInline(meta.resumo, ctx, 2)).trim() : "";
  if (!resumo) fail(ctx, 2, "falta o resumo: <!-- resumo: uma frase --> logo a seguir ao título");
  const publico = (meta.publico || "todos").trim();
  if (publico !== "todos" && publico !== "super-admin") fail(ctx, 2, `publico "${publico}" inválido (todos ou super-admin)`);
  const termos = (meta.termos || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const atualizado = meta.atualizado ? meta.atualizado.trim() : null;
  if (atualizado !== null && !isValidDate(atualizado)) fail(ctx, 2, `data "${atualizado}" inválida (AAAA-MM-DD)`);

  const sections: DocSection[] = [{ id: "", level: 1, heading: "", parent: null, perguntas: [], text: "" }];
  const texts: string[][] = [[]];
  const ids = new Set<string>();
  let lastH2: string | null = null;
  const blocks = parseBody(
    lines.slice(i),
    (x) => i + x + 1,
    ctx,
    {
      heading(level, text, line, perguntas) {
        const c = parseInline(text, ctx, line);
        const plain = inlineText(c).trim();
        const id = slugify(plain);
        if (!id) fail(ctx, line, `o título "${text}" não dá uma âncora (use letras ou números)`);
        else if (RESERVED_IDS.has(id)) fail(ctx, line, `o título "${text}" dá a âncora reservada "#${id}": mude o título`);
        else if (ids.has(id)) fail(ctx, line, `secção repetida: "#${id}" já existe neste artigo (os títulos têm de ser diferentes)`);
        ids.add(id);
        if (level === 2) lastH2 = id;
        sections.push({ id, level, heading: plain, parent: level === 3 ? lastH2 : null, perguntas: perguntas || [], text: "" });
        texts.push([]);
        return { t: level === 2 ? "h2" : "h3", id, text: plain, c };
      },
      onBlock(b) {
        if (b.t !== "h2" && b.t !== "h3") texts[texts.length - 1].push(blockText(b));
      },
    },
    false,
  );
  sections.forEach((s, x) => {
    s.text = texts[x].join("\n").replace(/[ \t]+/g, " ").trim();
  });
  if (ctx.errors.length) return { doc: null, errors: ctx.errors, links: ctx.links };
  const order = Number(name[1]);
  return {
    doc: {
      file,
      slug: name[2],
      order,
      category: categoryOf(order),
      title,
      resumo,
      publico: publico as DocAudience,
      termos,
      atualizado,
      blocks,
      sections,
    },
    errors: [],
    links: ctx.links,
  };
}

// Todos os artigos: um endereço por artigo e ligações internas para artigos e secções que existem.
export function parseSupportDocs(sources: DocSource[]): { docs: SupportDoc[]; errors: string[] } {
  const errors: string[] = [];
  const docs: SupportDoc[] = [];
  const links = new Map<string, DocLink[]>();
  const seen = new Map<string, string>();
  for (const s of [...sources].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    const r = parseSupportDoc(s.file, s.source);
    errors.push(...r.errors);
    if (!r.doc) continue;
    const other = seen.get(r.doc.slug);
    if (other) {
      errors.push(`${s.file}: o endereço "${r.doc.slug}" já é usado por ${other}`);
      continue;
    }
    seen.set(r.doc.slug, s.file);
    docs.push(r.doc);
    links.set(s.file, r.links);
  }
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  for (const d of docs)
    for (const l of links.get(d.file) || []) {
      const target = bySlug.get(l.slug);
      if (!target) errors.push(`${d.file}:${l.line}: ligação para um artigo que não existe: ${DOCS_BASE}/${l.slug}`);
      else if (l.anchor && !target.sections.some((s) => s.id === l.anchor))
        errors.push(
          `${d.file}:${l.line}: a secção "#${l.anchor}" não existe em ${target.file} (secções: ${target.sections
            .filter((s) => s.id)
            .map((s) => `#${s.id}`)
            .join(", ") || "nenhuma"})`,
        );
    }
  docs.sort((a, b) => a.order - b.order || (a.file < b.file ? -1 : 1));
  return { docs, errors };
}

// Artigo visível para quem está a ver: os de publico "super-admin" só para o Super Admin.
export const docVisible = (doc: Pick<SupportDoc, "publico">, isSuper: boolean) => doc.publico === "todos" || isSuper;
