// Regras do leilão (leilao.lojadoouro.pt) que não dependem do servidor: horas de Lisboa nos formulários, incrementos e
// caução (iguais às da BD, supabase/migrations/20261022100000_ldo_auction.sql), leitura de produtos do Shopify e textos
// de estado. Sem I/O (testado em tests/leilao.cjs).

export const LISBON = "Europe/Lisbon";

export type AucSettings = {
  extend_window_seconds: number; extend_minutes: number; increments: [number, number][];
  deposit_threshold: number; deposit_percent: number; deposit_min: number; verified_threshold: number;
  payment_hours: number; default_stagger_seconds: number; ending_soon_minutes: number;
  new_warranty_months: number; used_warranty_months: number; authority_notice_days: number; updated_at?: string;
  company_name?: string; company_nif?: string; company_address?: string; company_registry?: string; rjoc_title?: string;
  contact_email?: string; contact_phone?: string; ral_entity?: string; terms_version?: string;
};

export type AucEvent = {
  id: string; title: string; slug: string; intro: string; status: "draft" | "published" | "cancelled";
  opens_at: string; first_close_at: string; stagger_seconds: number; authority_notice_at: string | null;
  published_at?: string | null; lots?: number; ready?: number; bids?: number; sold?: number; sold_value?: number;
  last_close_at?: string | null;
};

export type AucLot = {
  id: string; event_id: string; position: number; shopify_handle: string | null; shopify_product_id: string | null;
  sku: string | null; title: string; description: string; images: string[]; metal: string | null; fineness: string | null;
  weight_g: number | null; gems: string | null; hallmarked: boolean; condition: "new" | "used"; condition_report: string;
  warranty_months: number; start_price: number; reserve_price: number | null; buy_now_price: number | null;
  deposit_mode: "auto" | "required" | "none"; status: "draft" | "ready" | "withdrawn" | "closed";
  scheduled_close_at: string | null; close_at: string | null; extensions: number; current_price: number | null;
  leader_id: string | null; leader_max: number | null; bid_count: number; bidder_count: number;
  result: "sold" | "unsold" | null; closed_at: string | null; payment_due_at: string | null;
  leader_alias?: string | null; leader_email?: string | null;
};

// ---------------------------------------------------------------- horas de Lisboa

// Diferença (minutos) entre a hora de Lisboa e UTC num instante.
function lisbonOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LISBON, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

// "2026-11-02T21:00" (campo datetime-local, hora de Lisboa) → ISO UTC. Inválido → null.
export function lisbonInputToIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(guess).getUTCDate() !== d) return null;
  // Duas passagens: a primeira acerta o dia da mudança de hora.
  let t = guess - lisbonOffsetMinutes(new Date(guess)) * 60000;
  t = guess - lisbonOffsetMinutes(new Date(t)) * 60000;
  return new Date(t).toISOString();
}

// ISO → "2026-11-02T21:00" em hora de Lisboa (valor de um datetime-local).
export function isoToLisbonInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const local = new Date(at.getTime() + lisbonOffsetMinutes(at) * 60000);
  return local.toISOString().slice(0, 16);
}

const DT = new Intl.DateTimeFormat("pt-PT", { timeZone: LISBON, dateStyle: "short", timeStyle: "short" });
export const lisbonDateTime = (iso: string | null | undefined) => (iso ? DT.format(new Date(iso)) : "—");

// ---------------------------------------------------------------- valores

const EUR = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
export const eur = (n: number | null | undefined) => (n === null || n === undefined ? "—" : EUR.format(Number(n)));

// "1.234,50", "1234.5", "1 234,50 €" → 1234.5; vazio → null; inválido → NaN.
export function parseEuro(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[€\s ]/g, "");
  if (!s) return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

// Incremento para um preço: o do último degrau cujo início é <= preço (como ldo_private.auc_increment).
export function incrementFor(price: number, steps: [number, number][]): number {
  let inc = 1;
  for (const [from, step] of [...steps].sort((a, b) => a[0] - b[0])) if (from <= price) inc = step;
  return inc;
}

export function minNextBid(lot: Pick<AucLot, "leader_id" | "start_price" | "current_price">, steps: [number, number][]): number {
  if (!lot.leader_id || lot.current_price === null) return Number(lot.start_price);
  return Number(lot.current_price) + incrementFor(Number(lot.current_price), steps);
}

// Caução do lote (0 = sem caução), como ldo_private.auc_deposit_amount.
export function depositFor(lot: Pick<AucLot, "deposit_mode" | "start_price" | "current_price">, s: AucSettings): number {
  if (lot.deposit_mode === "none") return 0;
  const high = Number(lot.start_price) >= s.deposit_threshold || Number(lot.current_price || 0) >= s.deposit_threshold;
  if (lot.deposit_mode !== "required" && !high) return 0;
  return Math.max(s.deposit_min, Math.round(Number(lot.start_price) * s.deposit_percent) / 100);
}

// Linhas "0 5\n100 10" (ou "0;5") → [[0,5],[100,10]]; erro → mensagem.
export function parseIncrements(text: string): { ok: true; steps: [number, number][] } | { ok: false; error: string } {
  const steps: [number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[\s;=→>-]+/).filter(Boolean).map(parseEuro);
    if (parts.length !== 2 || parts.some((p) => p === null || Number.isNaN(p)))
      return { ok: false, error: `Linha inválida nos incrementos: «${line}». Use «a partir de» e «incremento», ex.: 500 25.` };
    steps.push([parts[0] as number, parts[1] as number]);
  }
  if (!steps.length) return { ok: false, error: "Indique pelo menos um incremento." };
  for (let i = 0; i < steps.length; i++) {
    if (steps[i][1] <= 0) return { ok: false, error: "Os incrementos têm de ser maiores que zero." };
    if (i && steps[i][0] <= steps[i - 1][0]) return { ok: false, error: "Os incrementos têm de estar por ordem crescente." };
  }
  if (steps[0][0] !== 0) return { ok: false, error: "O primeiro incremento tem de começar em 0 €." };
  return { ok: true, steps };
}

export const formatIncrements = (steps: [number, number][]) => steps.map(([a, b]) => `${a} ${b}`).join("\n");

// ---------------------------------------------------------------- endereços e produtos do Shopify

// "Joias de Outono 2026!" → "joias-de-outono-2026".
export function slugify(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
}

// Handle de um produto a partir do endereço da loja (qualquer língua) ou do próprio handle.
export function productHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (/^[a-z0-9][a-z0-9-]{0,254}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)(lojadoouro\.pt|goldstorepremium\.com|myshopify\.com)$/.test(url.hostname)) return null;
  const m = /\/products\/([a-z0-9][a-z0-9-]{0,254})\/?$/.exec(decodeURIComponent(url.pathname));
  return m ? m[1] : null;
}

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// HTML da descrição do Shopify → texto simples (parágrafos separados por linha em branco).
export function htmlToPlain(html: string): string {
  return decodeEntities(
    String(html || "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type ShopifyProductDraft = {
  handle: string; product_id: string; title: string; description: string; images: string[]; price: number | null; sku: string | null;
  metal: string | null; fineness: string | null; weight_g: number | null;
};

// /products/<handle>.js da loja (público) → dados para pré-preencher o lote. Metal, toque e peso tirados do título e
// da descrição quando estão escritos ("Ouro 19,2kl", "800‰", "27,45 g"); a equipa confirma.
export function shopifyProductDraft(json: unknown): ShopifyProductDraft | null {
  if (!json || typeof json !== "object") return null;
  const p = json as Record<string, unknown>;
  if (typeof p.handle !== "string" || typeof p.title !== "string") return null;
  const images = (Array.isArray(p.images) ? p.images : [])
    .filter((u): u is string => typeof u === "string")
    .map((u) => (u.startsWith("//") ? `https:${u}` : u))
    .filter((u) => /^https:\/\/[a-z0-9.-]+\//.test(u))
    .slice(0, 30);
  const variants = Array.isArray(p.variants) ? (p.variants as Record<string, unknown>[]) : [];
  const priceCents = typeof p.price === "number" ? p.price : typeof variants[0]?.price === "number" ? (variants[0].price as number) : null;
  const description = htmlToPlain(typeof p.description === "string" ? p.description : "");
  const text = `${p.title} ${description}`;
  const metal = /ouro branco/i.test(text) ? "Ouro branco" : /ouro rosa/i.test(text) ? "Ouro rosa" : /bicolor/i.test(text) ? "Ouro bicolor"
    : /\bouro\b/i.test(text) ? "Ouro" : /\bprata\b/i.test(text) ? "Prata" : /platina/i.test(text) ? "Platina" : null;
  const kl = /(\d{1,2}(?:[.,]\d)?)\s*(?:kl|k\b|quilates)/i.exec(text);
  const permil = /\b(375|500|585|750|800|833|916|925|999)\s*‰/.exec(text);
  const fineness = permil ? `${permil[1]}‰` : kl ? `${kl[1].replace(".", ",")} kl` : null;
  const grams = /(\d+(?:[.,]\d{1,3})?)\s*(?:gr?\b|gramas)/i.exec(text);
  return {
    handle: p.handle,
    product_id: p.id !== undefined ? String(p.id) : "",
    title: p.title.trim().slice(0, 200),
    description: description.slice(0, 20000),
    images,
    price: priceCents === null ? null : priceCents / 100,
    sku: typeof variants[0]?.sku === "string" && variants[0].sku ? String(variants[0].sku).slice(0, 80) : null,
    metal,
    fineness,
    weight_g: grams ? Number(grams[1].replace(",", ".")) : null,
  };
}

// ---------------------------------------------------------------- estados

export type LotPhase = "draft" | "withdrawn" | "scheduled" | "open" | "ending" | "closed_sold" | "closed_unsold";

// Estado de um lote para mostrar (o fecho real é feito pela BD de minuto a minuto).
export function lotPhase(
  lot: Pick<AucLot, "status" | "close_at" | "result">,
  event: Pick<AucEvent, "status" | "opens_at">,
  now = new Date(),
  endingMinutes = 60,
): LotPhase {
  if (lot.status === "withdrawn") return "withdrawn";
  if (lot.status === "closed") return lot.result === "sold" ? "closed_sold" : "closed_unsold";
  if (lot.status === "draft" || event.status !== "published") return "draft";
  if (now < new Date(event.opens_at)) return "scheduled";
  if (!lot.close_at) return "draft";
  const left = new Date(lot.close_at).getTime() - now.getTime();
  if (left <= 0) return "ending";
  return left <= endingMinutes * 60000 ? "ending" : "open";
}

export const PHASE_LABEL: Record<LotPhase, string> = {
  draft: "Rascunho", withdrawn: "Retirado", scheduled: "Agendado", open: "Aberto", ending: "A terminar",
  closed_sold: "Vendido", closed_unsold: "Não vendido",
};

export const EVENT_STATUS: Record<AucEvent["status"], string> = { draft: "Rascunho", published: "Publicado", cancelled: "Cancelado" };
export const CUSTOMER_LEVEL: Record<string, string> = { registered: "Registado", verified: "Verificado", vip: "VIP", blocked: "Bloqueado" };
export const BID_KIND: Record<string, string> = { bid: "Licitação", auto: "Automática", max_raise: "Subiu o máximo" };

// Aviso às autoridades (RJOC art. 65.º, a confirmar): data-limite antes da abertura.
export function authorityNoticeDeadline(opensAt: string, days: number): string {
  const d = new Date(new Date(opensAt).getTime() - days * 86400000);
  return new Intl.DateTimeFormat("pt-PT", { timeZone: LISBON, dateStyle: "short" }).format(d);
}
