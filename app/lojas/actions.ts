"use server";

import { redirect } from "next/navigation";
import { validDate } from "@/lib/bi/periods";
import { parseGoldForm, parseShopSaleForm } from "@/lib/store-records";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

function back(path: string, form: FormData, result: { ok?: string; erro?: string; editar?: string }) {
  const params = new URLSearchParams();
  for (const key of ["loja", "mes", "dia"]) {
    const v = String(form.get(key) || "");
    if (v) params.set(key, v);
  }
  for (const [k, v] of Object.entries(result)) if (v) params.set(k, v);
  return `${path}?${params}`;
}

async function save(path: string, fn: string, form: FormData, parsed: { error?: string; data?: Record<string, unknown> }, dateKey: string) {
  const viewer = await requireViewer();
  const id = String(form.get("record_id") || "") || null;
  const store = viewer.stores.find((s) => s.id === String(form.get("store_id") || ""));
  const editar = id || undefined;
  if (!store) redirect(back(path, form, { erro: "Loja inválida.", editar }));
  if (parsed.error || !parsed.data) redirect(back(path, form, { erro: parsed.error, editar }));
  if (!validDate(String(parsed.data[dateKey] || ""))) redirect(back(path, form, { erro: "Data inválida.", editar }));
  let error = "";
  try {
    await rpc(fn, { p_session: viewer.session, p_id: id, p_store_id: store.id, p_data: parsed.data });
  } catch (e) {
    error = userMessage(e);
  }
  // After saving, the day of the record stays open so the next one is quick to add.
  const day = String(parsed.data[dateKey]);
  form.set("dia", day);
  form.set("mes", day.slice(0, 7));
  redirect(back(path, form, error ? { erro: error, editar } : { ok: id ? "updated" : "saved" }));
}

async function remove(path: string, fn: string, form: FormData) {
  const viewer = await requireViewer();
  let error = "";
  try {
    await rpc(fn, { p_session: viewer.session, p_id: String(form.get("record_id") || "") });
  } catch (e) {
    error = userMessage(e);
  }
  redirect(back(path, form, error ? { erro: error } : { ok: "deleted" }));
}

// ldo_save_shop_sale and ldo_save_gold_entry check every permission again in the database.
export async function saveShopSale(form: FormData) {
  await save("/lojas", "ldo_save_shop_sale", form, parseShopSaleForm(form), "sale_date");
}

export async function removeShopSale(form: FormData) {
  await remove("/lojas", "ldo_remove_shop_sale", form);
}

export async function saveGoldEntry(form: FormData) {
  await save("/lojas/ouro", "ldo_save_gold_entry", form, parseGoldForm(form), "entry_date");
}

export async function removeGoldEntry(form: FormData) {
  await remove("/lojas/ouro", "ldo_remove_gold_entry", form);
}
