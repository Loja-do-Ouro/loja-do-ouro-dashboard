import type { Period } from "./periods";
import { detail, number, type Row, type Store } from "./model";

// Where the advertising money goes: the online store, a physical store, or shared
// (e.g. brand search that helps both). Physical-store spend is not part of the
// online budget, so online efficiency (MER) only counts the online share.
export type Destination = "online" | "store" | "shared";
export type ChannelRules = {
  stores: { id: string; name: string; keyword: string | null }[];
  overrides: { source: string; campaign: string; channel: Destination; store_id: string | null }[];
};
export type Classified = { destination: Destination; storeId: string | null; storeName: string | null; rule: "manual" | "keyword" | "default" };

export const DESTINATION_LABEL: Record<Destination, string> = { online: "Online", store: "Loja física", shared: "Partilhado" };
export const AD_SOURCES = [
  { source: "meta", dataset: "ads", label: "Meta" },
  { source: "google_ads", dataset: "campaigns", label: "Google Ads" },
] as const;

export function plain(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

// A manual choice wins; otherwise the store whose keyword is in the name (longest
// keyword first, so "LEIRIA CITY" beats "LEIRIA"); otherwise online.
export function classify(source: string, campaign: string, rules: ChannelRules | undefined): Classified {
  const stores = rules?.stores || [];
  const manual = rules?.overrides.find((o) => o.source === source && o.campaign === campaign);
  if (manual) {
    const store = stores.find((s) => s.id === manual.store_id);
    return { destination: manual.channel, storeId: manual.channel === "store" ? manual.store_id : null, storeName: manual.channel === "store" ? store?.name || null : null, rule: "manual" };
  }
  const name = plain(campaign);
  const hit = stores
    .filter((s) => s.keyword && name.includes(plain(s.keyword)))
    .sort((a, b) => (b.keyword || "").length - (a.keyword || "").length)[0];
  if (hit) return { destination: "store", storeId: hit.id, storeName: hit.name, rule: "keyword" };
  return { destination: "online", storeId: null, storeName: null, rule: "default" };
}

export type CampaignSpend = Classified & { source: string; campaign: string; spend: number };
export type Split = {
  complete: boolean;
  note: string;
  online: number;
  store: number;
  shared: number;
  bySource: Record<string, { online: number; store: number; shared: number; complete: boolean }>;
  byStore: { id: string; name: string; meta: number; google: number; total: number }[];
  campaigns: CampaignSpend[];
};

// Sums campaign rows (per ad and day for Meta, per campaign and day for Google).
export function splitRows(source: string, rows: Row[], rules: ChannelRules | undefined): CampaignSpend[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const campaign = String(r.campaign ?? "—");
    totals.set(campaign, (totals.get(campaign) || 0) + (number(r.spend) || 0));
  }
  return [...totals].map(([campaign, spend]) => ({ source, campaign, spend: Math.round(spend * 100) / 100, ...classify(source, campaign, rules) }));
}

export function adSplit(store: Store, p: Period): Split {
  const out: Split = { complete: true, note: "", online: 0, store: 0, shared: 0, bySource: {}, byStore: [], campaigns: [] };
  const stores = new Map<string, Split["byStore"][number]>();
  const notes: string[] = [];
  for (const { source, dataset, label } of AD_SOURCES) {
    const d = detail(store, p, source, dataset, true);
    const campaigns = splitRows(source, d.rows, store.channels);
    const part = { online: 0, store: 0, shared: 0, complete: d.complete };
    for (const c of campaigns) {
      part[c.destination] += c.spend;
      if (c.destination === "store" && c.storeId) {
        const s = stores.get(c.storeId) || { id: c.storeId, name: c.storeName || "Loja", meta: 0, google: 0, total: 0 };
        if (source === "meta") s.meta += c.spend; else s.google += c.spend;
        s.total += c.spend;
        stores.set(c.storeId, s);
      }
    }
    out.bySource[source] = part;
    out.online += part.online; out.store += part.store; out.shared += part.shared;
    out.campaigns.push(...campaigns);
    if (!d.complete) { out.complete = false; notes.push(`${label}: ${d.note}`); }
  }
  if (!store.channels) notes.push("Regras de destino indisponíveis nesta vista; tudo contado como online.");
  out.note = notes.join(" · ");
  out.byStore = [...stores.values()].sort((a, b) => b.total - a.total);
  out.campaigns.sort((a, b) => b.spend - a.spend);
  return out;
}

// Online investment = account totals minus what went to physical stores or is shared.
// Without complete campaign detail for the period it stays unknown, never guessed.
export function onlineInvestment(store: Store, p: Period, totalSpend: number | null, sales: number | null) {
  const split = adSplit(store, p);
  const known = Boolean(store.channels) && split.complete && totalSpend !== null;
  const online = known ? Math.max(0, Math.round((totalSpend! - split.store - split.shared) * 100) / 100) : null;
  return { split, online, physical: known ? split.store : null, shared: known ? split.shared : null, mer: online && sales !== null ? sales / online : null };
}
