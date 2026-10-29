// Regras do assistente de IA do apoio que não dependem do servidor (testadas em tests/support.cjs).

import { LOCALE_LABEL, SITE_BRAND, siteRootUrl, type SiteKey, type SiteLocale } from "./rules";

export const AI_MODEL = "claude-opus-5-5";

// Workspace da Anthropic (ANTHROPIC_WORKSPACE_ID): as chaves que não pertencem a um workspace têm de o
// indicar em cada pedido (cabeçalho anthropic-workspace-id). Só identificadores simples, nunca outro texto.
export function anthropicWorkspace(raw: string | undefined) {
  const id = (raw || "").trim();
  return /^[A-Za-z0-9_-]{4,100}$/.test(id) ? id : null;
}

// Resposta da IA: "mensagem" é para a colaboradora; "resposta_cliente" é a proposta de texto ao
// cliente (null quando o pedido não era uma resposta); "verificar" lista o que confirmar antes de enviar.
export type AiOutput = { mensagem: string; resposta_cliente: string | null; verificar: string[] };

export const AI_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    mensagem: {
      type: "string",
      description: "Para a colaboradora, em português de Portugal: o que encontraste, de onde veio e o que não foi possível confirmar. Curto, exceto quando a colaboradora pede uma tradução ou um texto completo.",
    },
    resposta_cliente: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Texto pronto a enviar ao cliente, na língua do cliente e com a marca do site, em texto simples (sem Markdown), ou null se o pedido não era uma resposta ao cliente.",
    },
    verificar: {
      type: "array",
      items: { type: "string" },
      description: "Pontos que a colaboradora tem de confirmar antes de enviar. Lista vazia se não houver.",
    },
  },
  required: ["mensagem", "resposta_cliente", "verificar"],
  additionalProperties: false,
} as const;

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", euro: "€", ordm: "º", ordf: "ª", deg: "°", laquo: "«", raquo: "»",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", eacute: "é", ecirc: "ê", iacute: "í", oacute: "ó", ocirc: "ô", otilde: "õ",
  uacute: "ú", ccedil: "ç", Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Eacute: "É", Ecirc: "Ê", Iacute: "Í", Oacute: "Ó",
  Ocirc: "Ô", Otilde: "Õ", Uacute: "Ú", Ccedil: "Ç",
};

// HTML das páginas e políticas da loja em texto simples, mantendo parágrafos, listas e ligações.
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return /^https?:\/\//i.test(href) && !text.includes(href) ? `${text} (${href})` : text;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|tr|h\d|ul|ol|table|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d{1,7});/g, (m, n: string) => safeChar(Number(n), m))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, n: string) => safeChar(parseInt(n, 16), m))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function safeChar(code: number, fallback: string) {
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : fallback;
}

// Texto que vem de clientes (ou de plataformas): não pode imitar as marcas que delimitam o pedido da
// colaboradora. Os sinais < e > passam a ‹ e ›, que a IA lê da mesma forma.
export function untrusted(s: string | null | undefined) {
  return (s || "").replace(/</g, "‹").replace(/>/g, "›");
}

// Corte sem partir um emoji ao meio (a API recusa metades de caracteres).
export function clip(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max).replace(/[\uD800-\uDBFF]$/, "")} […]` : s;
}

// Lê e valida a resposta estruturada da IA (formato garantido pela API, validado na mesma).
export function parseAiOutput(text: string): AiOutput {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("A IA devolveu uma resposta num formato inesperado. Tente outra vez.");
  }
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== "object" || typeof o.mensagem !== "string" || !(o.resposta_cliente === null || typeof o.resposta_cliente === "string") || !Array.isArray(o.verificar))
    throw new Error("A IA devolveu uma resposta incompleta. Tente outra vez.");
  const draft = typeof o.resposta_cliente === "string" ? o.resposta_cliente.trim() : "";
  return {
    // Abaixo do limite da BD (8000), com o corte à vista (uma tradução longa não acaba a meio sem aviso).
    mensagem: clip(o.mensagem.trim(), 7900),
    resposta_cliente: draft ? draft.slice(0, 8000) : null,
    verificar: o.verificar.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).map((x) => x.trim().slice(0, 300)).slice(0, 10),
  };
}

// Ligações com ou sem https:// ("www.loja.pt/x", "loja.pt"); não apanha emails.
const LINK_RE = /(?<![@\w.-])(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:pt|com|net|org|eu|es|fr|de|it|uk|br|shop|store|online|site|io|co|info|biz|me|app|link|ly)(?::\d+)?(?![\w-])(?:\/[^\s<>"'«»()[\]]*)?/gi;

export function linksIn(text: string) {
  return [...new Set((text.match(LINK_RE) || []).map((u) => u.replace(/[.,;:!?…]+$/, "")))];
}
const norm = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
const host = (u: string) => norm(u).split(/[/?#:]/)[0];

// Ligações da proposta que não vieram de uma fonte de confiança (base de conhecimento, loja online e
// resultados das consultas à loja). Um domínio sozinho ("lojadoouro.pt") basta que seja de uma fonte.
export function unverifiedLinks(draft: string, trusted: string) {
  const known = linksIn(trusted);
  const urls = new Set(known.map(norm));
  const hosts = new Set(known.map(host));
  return linksIn(draft).filter((u) => {
    const n = norm(u);
    return !(urls.has(n) || (n === host(u) && hosts.has(n)));
  });
}

// Handle de um produto a partir do endereço público (…/products/<handle>, com ou sem coleção ou língua).
export function productHandle(url: string) {
  const m = /\/products\/([a-z0-9][a-z0-9-]{0,254})(?:[/?#]|$)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

// Marca da conversa: no chat do site, a do domínio onde o cliente está; nos outros canais, a Loja do Ouro. A IA
// apresenta-se e responde só com essa marca e esse domínio, e nunca menciona a outra.
export function aiIdentity(site: SiteKey) {
  return site === "gsp"
    ? "És o assistente de IA da equipa de Apoio ao Cliente da Gold Store Premium (www.goldstorepremium.com), a loja online de joalharia e ourivesaria portuguesa para clientes fora de Portugal."
    : "És o assistente de IA da equipa de Apoio ao Cliente da Loja do Ouro (www.lojadoouro.pt), uma joalharia e ourivesaria portuguesa com loja online e lojas físicas.";
}

export function aiBrandRules(site: SiteKey) {
  const lines = site === "gsp"
    ? [
        "- Esta conversa é da Gold Store Premium (www.goldstorepremium.com). Na resposta ao cliente usa só este nome e este domínio; nunca menciones a Loja do Ouro nem o site lojadoouro.pt.",
        "- A base de conhecimento, as políticas, as páginas e os resultados das ferramentas são da mesma empresa, com o nome e o domínio do site para Portugal (Loja do Ouro). Usa-os como fonte, lembrando que o cliente está fora de Portugal: se envios, prazos ou custos não forem claros para o país dele, indica-o em \"verificar\".",
        "- Preços: os dos produtos nas ferramentas são os de Portugal; na Gold Store Premium são outros. Nunca indiques ao cliente o preço de um produto: envia a ligação do produto (no chat do site aparece com o preço do site).",
      ]
    : ["- Esta conversa é da Loja do Ouro (www.lojadoouro.pt). Na resposta ao cliente usa só este nome e este domínio."];
  const example = siteRootUrl(site, site === "gsp" ? "es" : "en");
  lines.push(`- Ligações para o cliente: as das fontes começam por https://www.lojadoouro.pt/ (em português). No chat do site troca esse início pela página do site na língua do cliente (linha "site" do contexto) e mantém o resto do caminho; por exemplo, para um cliente em ${site === "gsp" ? "espanhol" : "inglês"}, https://www.lojadoouro.pt/products/anel passa a ${example}products/anel (o site abre a página traduzida).`);
  return ["Marca e site", ...lines].join("\n");
}

// Chat do site: linha do contexto com a marca, a página inicial e a língua do site, e o país do cliente.
export function siteContextLine(site: SiteKey, locale: SiteLocale, country: string | null) {
  return `- site: ${SITE_BRAND[site].brand} (${siteRootUrl(site, locale)}), língua do site: ${LOCALE_LABEL[locale]}, país: ${country || "desconhecido"}`;
}

const STORE_LINK = /^(?:https?:\/\/)?(?:www\.)?lojadoouro\.pt\/(?:(?:en|es|fr|de|pt-pt)\/)?(.*)$/i;

// Chat do site: ligações aceites sem aviso além das das fontes. As páginas iniciais do site da conversa (na Gold Store
// Premium, as de todas as línguas) e as ligações da loja das fontes com esse início (mesmo caminho noutro site ou língua).
export function siteTrustedLinks(trusted: string, site: SiteKey, locale: SiteLocale) {
  const roots = site === "gsp"
    ? [...new Set(Object.values(SITE_BRAND.gsp.roots).map((r) => SITE_BRAND.gsp.origin + r))]
    : [siteRootUrl(site, locale)];
  const paths = linksIn(trusted).map((u) => STORE_LINK.exec(u)?.[1]).filter((p): p is string => Boolean(p));
  return [...roots, ...paths.flatMap((p) => roots.map((r) => r + p))].join("\n");
}

// Proposta que menciona a outra marca ou uma ligação do outro site (o email do apoio não conta).
export function otherBrandIn(draft: string, site: SiteKey) {
  const other: SiteKey = site === "gsp" ? "ldo" : "gsp";
  const name = other === "ldo" ? /\bloja\s+do\s+ouro\b/i : /\bgold\s*store\s*premium\b/i;
  const domain = other === "ldo" ? /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*lojadoouro\.pt(?:[:/?#]|$)/i : /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*goldstorepremium\.com(?:[:/?#]|$)/i;
  return name.test(draft) || linksIn(draft).some((u) => domain.test(u)) ? `${SITE_BRAND[other].brand} (${SITE_BRAND[other].domain})` : null;
}

// Preços por milhão de tokens (US$): entrada, saída, leitura de cache, escrita de cache 5 min e 1 h.
// Estimativa: a fatura da Anthropic é a referência. Claude Haiku 5.5: preços até 100 mil tokens de entrada (acima, 5×).
const PRICES: Record<string, [number, number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5, 8],
  "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5, 4],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125, 0.2],
};
export type UsagePart = {
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
};

export function costUsd(parts: UsagePart[], fallbackModel: string) {
  let total = 0;
  for (const u of parts) {
    const [inp, out, read, w5, w1] = PRICES[u.model || fallbackModel] || PRICES["claude-opus-5"];
    const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const w5m = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0;
    total += ((u.input_tokens ?? 0) * inp + (u.output_tokens ?? 0) * out + (u.cache_read_input_tokens ?? 0) * read + w5m * w5 + w1h * w1) / 1e6;
  }
  return Math.round(total * 100000) / 100000;
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

// Lojas físicas registadas no dashboard e os dias em que fecham.
export function storesText(stores: { name: string; city: string | null; closed_weekdays: number[] | null }[]) {
  if (!stores.length) return "";
  const groups = new Map<string, string[]>();
  for (const s of stores) {
    const days = (s.closed_weekdays || []).filter((d) => d >= 0 && d <= 6).sort().map((d) => WEEKDAYS[d]).join(" e ");
    const key = days ? `encerramento semanal: ${days}` : "sem dia de encerramento registado";
    groups.set(key, [...(groups.get(key) || []), s.city && !s.name.includes(s.city) ? `${s.name} (${s.city})` : s.name]);
  }
  return [...groups].map(([days, names]) => `${names.join(", ")}: ${days}.`).join("\n");
}
