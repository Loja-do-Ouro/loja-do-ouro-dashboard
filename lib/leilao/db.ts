import "server-only";
import { sessionRpc } from "@/lib/support/db";
import { shopifyProductDraft, type AucEvent, type AucLot, type AucSettings, type ShopifyProductDraft } from "@/lib/leilao-rules";

// Funções ldo_auc_* da equipa (supabase/migrations/20261022100000_ldo_auction.sql): levam a sessão do dashboard e a
// BD confirma o acesso (Super Admin ou Loja Online).

export type AucOverview = { settings: AucSettings; events: AucEvent[]; customers: number };
export type AucBid = { id: number; amount: number; max_amount: number | null; kind: string; created_at: string; alias: string; email: string; name: string };
export type AucCustomer = {
  id: string; email: string; name: string; alias: string; nif: string | null; phone: string | null; level: string; is_staff: boolean;
  email_verified_at: string | null; verified_at: string | null; marketing_consent: boolean; created_at: string;
  last_login_at: string | null; notes: string; bids: number; won: number;
};

export const aucOverview = (session: string) => sessionRpc<AucOverview>(session, "ldo_auc_overview");
export const aucSettingsSave = (session: string, data: Record<string, unknown>) => sessionRpc<null>(session, "ldo_auc_settings_save", { p_data: data });
export const aucLegalSave = (session: string, data: Record<string, unknown>) => sessionRpc<null>(session, "ldo_auc_legal_save", { p_data: data });
export const aucEventSave = (session: string, id: string | null, data: Record<string, unknown>) =>
  sessionRpc<string>(session, "ldo_auc_event_save", { p_id: id, p_data: data });
export const aucEventGet = (session: string, id: string) => sessionRpc<{ event: AucEvent; lots: AucLot[] }>(session, "ldo_auc_event_get", { p_id: id });
export const aucLotSave = (session: string, id: string | null, eventId: string, data: Record<string, unknown>) =>
  sessionRpc<string>(session, "ldo_auc_lot_save", { p_id: id, p_event: eventId, p_data: data });
export const aucLotStatus = (session: string, id: string, status: "draft" | "ready" | "withdrawn") =>
  sessionRpc<null>(session, "ldo_auc_lot_status", { p_id: id, p_status: status });
export const aucLotBids = (session: string, lotId: string) => sessionRpc<AucBid[]>(session, "ldo_auc_lot_bids", { p_lot: lotId });
export const aucCustomers = (session: string, query: string) => sessionRpc<AucCustomer[]>(session, "ldo_auc_customers_list", { p_query: query });
export const aucCustomerUpdate = (session: string, id: string, level: string, isStaff: boolean, notes: string) =>
  sessionRpc<null>(session, "ldo_auc_customer_update", { p_id: id, p_level: level, p_is_staff: isStaff, p_notes: notes });

// Produto da loja pelo handle: /products/<handle>.js é público (o mesmo que o tema usa). O endereço é sempre o da loja,
// nunca o que foi escrito no formulário.
const STORE_ORIGIN = "https://www.lojadoouro.pt";

export async function fetchShopifyProduct(handle: string): Promise<ShopifyProductDraft | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,254}$/.test(handle)) return null;
  const r = await fetch(`${STORE_ORIGIN}/products/${handle}.js`, {
    cache: "no-store", signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" }, redirect: "follow",
  }).catch(() => null);
  if (!r || !r.ok) return null;
  return shopifyProductDraft(await r.json().catch(() => null));
}

export type AucMoneyRow = {
  id: string; alias: string; email: string; amount: number; status: string; method: string | null; provider: string; provider_ref: string | null;
  expires_at?: string | null; entity?: string | null; reference?: string | null; paid_at?: string | null; detail: string | null; created_at: string;
};
export const aucLotMoneyAdmin = (session: string, lot: string) =>
  sessionRpc<{ deposits: AucMoneyRow[]; payments: AucMoneyRow[] }>(session, "ldo_auc_lot_money_admin", { p_lot: lot });
export const aucPaymentManual = (session: string, lot: string, note: string) => sessionRpc<null>(session, "ldo_auc_payment_manual", { p_lot: lot, p_note: note });
