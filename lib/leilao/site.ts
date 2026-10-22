import "server-only";
import { createHmac } from "node:crypto";
import { cookies, headers } from "next/headers";
import { dashboardUrl } from "@/lib/email";
import { siteBaseFor } from "@/lib/leilao-site-rules";
import { serverRpc } from "@/lib/support/db";

// Site público do leilão: o servidor fala com a BD com o token de servidor (BI_INGEST_TOKEN) e, quando é do cliente,
// com a sessão dele (cookie httpOnly; a BD só guarda o hash). Reserva, máximos e emails dos outros nunca saem da BD.

export const AUCTION_COOKIE = "ldo_leilao";

export type PubSettings = {
  extend_window_seconds: number; extend_minutes: number; increments: [number, number][]; deposit_threshold: number;
  deposit_percent: number; deposit_min: number; verified_threshold: number; payment_hours: number; ending_soon_minutes: number;
  new_warranty_months: number; used_warranty_months: number; company_name: string; company_nif: string; company_address: string;
  company_registry: string; rjoc_title: string; contact_email: string; contact_phone: string; ral_entity: string;
  terms_version: string; session_days: number; hold_days: number; payment_methods: string[];
};

export type PubLot = {
  id: string; position: number; title: string; description: string; images: string[]; metal: string | null; fineness: string | null;
  weight_g: number | null; gems: string | null; hallmarked: boolean; condition: "new" | "used"; condition_report: string;
  warranty_months: number; start_price: number; buy_now_price: number | null; has_reserve: boolean; reserve_met: boolean;
  current_price: number | null; bid_count: number; bidder_count: number; leader_alias: string | null; close_at: string | null;
  extensions: number; status: "ready" | "closed"; result: "sold" | "unsold" | null; opens_at: string; event_slug: string;
  event_title: string; deposit: number; min_next: number;
  me_leading?: boolean; me_bid?: boolean; me_watch?: boolean; me_max?: number | null; payment_due_at?: string | null;
};

export type PubEventCard = {
  slug: string; title: string; intro: string; opens_at: string; first_close_at: string; last_close_at: string | null;
  lots: number; cover: string | null; open_lots: number; sort: number;
};

export type PubEvent = { slug: string; title: string; intro: string; opens_at: string; first_close_at: string; stagger_seconds: number };

export type Me = {
  id: string; name: string; first_name: string; alias: string; email: string; phone: string | null; nif: string | null;
  birth_date: string | null; address: { line1?: string; line2?: string; postal_code?: string; city?: string };
  level: "registered" | "verified" | "vip" | "blocked"; marketing_consent: boolean; created_at: string; terms_accepted_at: string | null;
};

export type LotMe = {
  alias: string; level: Me["level"]; is_staff: boolean; leading: boolean; max: number | null; bid: boolean; watch: boolean;
  deposit_held: boolean; won: boolean; payment_due_at: string | null;
};

export type LotHistory = { alias: string; amount: number; kind: "bid" | "auto"; created_at: string; mine: boolean };

export type LotLive = {
  current_price: number | null; bid_count: number; bidder_count: number; close_at: string | null; extensions: number;
  status: "ready" | "closed"; result: "sold" | "unsold" | null; reserve_met: boolean; leader_alias: string | null;
  min_next: number; me_leading: boolean; me_max: number | null; server_time: string;
};

// ---------------------------------------------------------------- sessão e endereços

export async function auctionSession(): Promise<string> {
  const v = (await cookies()).get(AUCTION_COOKIE)?.value || "";
  return /^[0-9a-f]{64}$/.test(v) ? v : "";
}

export async function setAuctionSession(token: string, expiresAt: string) {
  (await cookies()).set(AUCTION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: new Date(expiresAt),
  });
}

export async function clearAuctionSession() {
  (await cookies()).delete(AUCTION_COOKIE);
}

// "" no domínio do leilão, "/l" no do dashboard.
export async function siteBase() {
  return siteBaseFor((await headers()).get("host"));
}

// Endereço absoluto do site (ligações dos emails). LEILAO_URL quando o domínio estiver ligado.
export function siteUrl() {
  if (process.env.LEILAO_URL) return process.env.LEILAO_URL.replace(/\/+$/, "");
  return `${dashboardUrl()}/l`;
}

// Ligação do cliente, só como hash com chave (limites contra abuso; nunca o IP em claro).
export async function ipHash() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHmac("sha256", process.env.BI_INGEST_TOKEN || "ldo-leilao").update(`auc:${ip}`).digest("hex");
}

// ---------------------------------------------------------------- BD

export const pubHome = () => serverRpc<{ settings: PubSettings; events: PubEventCard[] }>("ldo_auc_public_home");
export const pubEvent = (slug: string, session: string) =>
  serverRpc<{ event: PubEvent; settings: PubSettings; lots: PubLot[] } | null>("ldo_auc_public_event", { p_slug: slug, p_session: session || null });
export const pubLot = (slug: string, position: number, session: string) =>
  serverRpc<{ lot: PubLot; settings: PubSettings; history: LotHistory[]; me: LotMe | null } | null>("ldo_auc_public_lot", {
    p_slug: slug, p_position: position, p_session: session || null,
  });
export const lotLive = (lot: string, session: string) => serverRpc<LotLive | null>("ldo_auc_lot_live", { p_lot: lot, p_session: session || null });

export const aucMe = (session: string) => (session ? serverRpc<Me | null>("ldo_auc_me", { p_session: session }) : Promise.resolve(null));
export const aucMy = (session: string) => serverRpc<{ lots: PubLot[] } | null>("ldo_auc_my", { p_session: session });

// Definições públicas para o rodapé e as páginas legais (sem sessão).
export async function pubSettings(): Promise<PubSettings | null> {
  return (await pubHome().catch(() => null))?.settings ?? null;
}
