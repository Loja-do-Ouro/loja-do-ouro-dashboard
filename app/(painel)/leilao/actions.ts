"use server";

import { redirect } from "next/navigation";
import { canManageAuction, homePath } from "@/lib/permissions";
import {
  aucCustomerUpdate, aucEventSave, aucLegalSave, aucLotSave, aucLotStatus, aucSettingsSave, fetchShopifyProduct,
} from "@/lib/leilao/db";
import { lisbonInputToIso, parseEuro, parseIncrements, productHandle, slugify } from "@/lib/leilao-rules";
import { userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

// Leilão: Super Admin e Loja Online (verificado aqui e nas funções da BD, ldo_private.auc_admin). Os endereços de
// volta só levam ids e o resultado, nunca dados pessoais.
async function adminViewer() {
  const viewer = await requireViewer();
  if (!canManageAuction(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  return viewer;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: FormDataEntryValue | null) => (typeof v === "string" && UUID.test(v) ? v : null);
const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const go = (path: string, params: Record<string, string>): never => redirect(`${path}?${new URLSearchParams(params)}`);

// Valor em euros do formulário: vazio → "" (a BD guarda null); inválido → erro.
function money(form: FormData, field: string, label: string, required = false): string {
  const v = parseEuro(form.get(field));
  if (v === null) {
    if (required) throw new Error(`Indique ${label}.`);
    return "";
  }
  if (Number.isNaN(v)) throw new Error(`${label[0].toUpperCase()}${label.slice(1)}: valor inválido (ex.: 1250 ou 1.250,00).`);
  return String(v);
}

// ---------------------------------------------------------------- leilões

export async function saveEvent(form: FormData) {
  const viewer = await adminViewer();
  const eventId = id(form.get("id"));
  const back = eventId ? `/leilao/${eventId}` : "/leilao";
  const title = text(form.get("title"));
  const opens = lisbonInputToIso(form.get("opens_at"));
  const firstClose = lisbonInputToIso(form.get("first_close_at"));
  const stagger = Number(text(form.get("stagger_seconds")) || "60");
  if (!opens || !firstClose) go(back, { erro: "Indique a abertura e o primeiro fecho (dia e hora de Lisboa)." });
  if (!Number.isInteger(stagger) || stagger < 0 || stagger > 3600) go(back, { erro: "O intervalo entre lotes vai de 0 a 3600 segundos." });
  let saved = "";
  try {
    saved = await aucEventSave(viewer.session, eventId, {
      title,
      slug: text(form.get("slug")) || slugify(title),
      intro: text(form.get("intro")),
      status: text(form.get("status")) || "draft",
      opens_at: opens,
      first_close_at: firstClose,
      stagger_seconds: stagger,
      authority_notice_at: text(form.get("authority_notice_at")),
    });
  } catch (e) {
    go(back, { erro: userMessage(e) });
  }
  go(`/leilao/${saved}`, { ok: eventId ? "event_saved" : "event_created" });
}

// ---------------------------------------------------------------- lotes

// Novo lote a partir de um produto da loja (endereço ou handle): título, descrição, fotografias (CDN do Shopify) e, se
// estiverem escritos, metal, toque e peso. Fica em rascunho para a equipa completar.
export async function importLot(form: FormData) {
  const viewer = await adminViewer();
  const eventId = id(form.get("event_id"));
  if (!eventId) go("/leilao", { erro: "Leilão inválido." });
  const back = `/leilao/${eventId}`;
  const handle = productHandle(form.get("product"));
  if (!handle) go(back, { erro: "Cole o endereço do produto na loja (…/products/…) ou o seu handle." });
  let start = "";
  try {
    start = money(form, "start_price", "a base de licitação", true);
  } catch (e) {
    go(back, { erro: (e as Error).message });
  }
  const product = await fetchShopifyProduct(handle as string);
  if (!product) go(back, { erro: "Produto não encontrado na loja. Confirme o endereço (o produto tem de estar publicado)." });
  let lotId = "";
  try {
    lotId = await aucLotSave(viewer.session, null, eventId as string, {
      shopify_handle: product!.handle,
      shopify_product_id: /^[0-9]{1,20}$/.test(product!.product_id) ? product!.product_id : "",
      sku: product!.sku || "",
      title: product!.title,
      description: product!.description,
      images: product!.images,
      metal: product!.metal || "",
      fineness: product!.fineness || "",
      weight_g: product!.weight_g === null ? "" : String(product!.weight_g),
      condition: text(form.get("condition")) === "new" ? "new" : "used",
      start_price: start,
    });
  } catch (e) {
    go(back, { erro: userMessage(e) });
  }
  go(`/leilao/${eventId}/lote/${lotId}`, { ok: "lot_imported" });
}

export async function saveLot(form: FormData) {
  const viewer = await adminViewer();
  const eventId = id(form.get("event_id"));
  const lotId = id(form.get("id"));
  if (!eventId || !lotId) go("/leilao", { erro: "Lote inválido." });
  const back = `/leilao/${eventId}/lote/${lotId}`;
  const images = text(form.get("images")).split(/\s+/).filter(Boolean);
  let data: Record<string, unknown> = {};
  // Com licitações a BD só aceita textos e fotografias (os campos de preço vêm desativados e não chegam).
  if (form.get("locked") === "1") {
    data = { title: text(form.get("title")), description: text(form.get("description")), images, condition_report: text(form.get("condition_report")) };
  } else try {
    data = {
      position: text(form.get("position")) || undefined,
      shopify_handle: text(form.get("shopify_handle")),
      shopify_product_id: text(form.get("shopify_product_id")),
      sku: text(form.get("sku")),
      title: text(form.get("title")),
      description: text(form.get("description")),
      images,
      metal: text(form.get("metal")),
      fineness: text(form.get("fineness")),
      weight_g: text(form.get("weight_g")).replace(",", "."),
      gems: text(form.get("gems")),
      hallmarked: form.get("hallmarked") === "on",
      condition: text(form.get("condition")) === "new" ? "new" : "used",
      condition_report: text(form.get("condition_report")),
      warranty_months: text(form.get("warranty_months")),
      start_price: money(form, "start_price", "a base de licitação", true),
      reserve_price: money(form, "reserve_price", "o preço de reserva"),
      buy_now_price: money(form, "buy_now_price", "o preço «comprar já»"),
      deposit_mode: ["auto", "required", "none"].includes(text(form.get("deposit_mode"))) ? text(form.get("deposit_mode")) : "auto",
    };
  } catch (e) {
    go(back, { erro: (e as Error).message });
  }
  try {
    await aucLotSave(viewer.session, lotId, eventId as string, data);
  } catch (e) {
    go(back, { erro: userMessage(e) });
  }
  go(back, { ok: "lot_saved" });
}

export async function setLotStatus(form: FormData) {
  const viewer = await adminViewer();
  const eventId = id(form.get("event_id"));
  const lotId = id(form.get("id"));
  const status = text(form.get("status"));
  if (!eventId || !lotId || !["draft", "ready", "withdrawn"].includes(status)) go("/leilao", { erro: "Pedido inválido." });
  const back = form.get("from") === "event" ? `/leilao/${eventId}` : `/leilao/${eventId}/lote/${lotId}`;
  if (status === "withdrawn" && form.get("confirm") !== "on") go(back, { erro: "Confirme antes de retirar o lote." });
  try {
    await aucLotStatus(viewer.session, lotId as string, status as "draft" | "ready" | "withdrawn");
  } catch (e) {
    go(back, { erro: userMessage(e) });
  }
  go(back, { ok: `lot_${status}` });
}

// ---------------------------------------------------------------- regras

export async function saveSettings(form: FormData) {
  const viewer = await adminViewer();
  const back = "/leilao/definicoes";
  const steps = parseIncrements(text(form.get("increments")));
  if (!steps.ok) go(back, { erro: steps.error });
  const int = (f: string) => text(form.get(f));
  let data: Record<string, unknown> = {};
  try {
    data = {
      extend_window_seconds: int("extend_window_seconds"),
      extend_minutes: int("extend_minutes"),
      increments: (steps as { steps: [number, number][] }).steps,
      deposit_threshold: money(form, "deposit_threshold", "o limiar da caução", true),
      deposit_percent: int("deposit_percent").replace(",", "."),
      deposit_min: money(form, "deposit_min", "a caução mínima", true),
      verified_threshold: money(form, "verified_threshold", "o limiar da conta verificada", true),
      payment_hours: int("payment_hours"),
      default_stagger_seconds: int("default_stagger_seconds"),
      ending_soon_minutes: int("ending_soon_minutes"),
      new_warranty_months: int("new_warranty_months"),
      used_warranty_months: int("used_warranty_months"),
      authority_notice_days: int("authority_notice_days"),
    };
  } catch (e) {
    go(back, { erro: (e as Error).message });
  }
  try {
    await aucSettingsSave(viewer.session, data);
  } catch (e) {
    go(back, { erro: userMessage(e) });
  }
  go(back, { ok: "settings" });
}

export async function saveLegal(form: FormData) {
  const viewer = await adminViewer();
  const back = "/leilao/definicoes";
  const fields = ["company_name", "company_nif", "company_address", "company_registry", "rjoc_title", "contact_email", "contact_phone", "ral_entity", "terms_version"];
  try {
    await aucLegalSave(viewer.session, Object.fromEntries(fields.map((f) => [f, text(form.get(f))])));
  } catch (e) {
    go(back, { erro: userMessage(e) });
  }
  go(back, { ok: "legal" });
}

// ---------------------------------------------------------------- clientes

export async function updateCustomer(form: FormData) {
  const viewer = await adminViewer();
  const customerId = id(form.get("id"));
  const q = text(form.get("q")).slice(0, 100);
  const back = (params: Record<string, string>) => go("/leilao/clientes", { ...(q ? { q } : {}), ...params });
  if (!customerId) back({ erro: "Cliente inválido." });
  const level = text(form.get("level"));
  try {
    await aucCustomerUpdate(viewer.session, customerId as string, level, form.get("is_staff") === "on", text(form.get("notes")));
  } catch (e) {
    back({ erro: userMessage(e) });
  }
  back({ ok: "customer" });
}
