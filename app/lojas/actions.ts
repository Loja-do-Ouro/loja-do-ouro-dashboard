"use server";

import { redirect } from "next/navigation";
import { validDate } from "@/lib/bi/periods";
import { parseSaleForm } from "@/lib/store-sales";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

function back(form: FormData, result: { ok?: string; erro?: string }) {
  const params = new URLSearchParams();
  for (const key of ["loja", "mes", "data"]) {
    const v = String(form.get(key) || "");
    if (v) params.set(key, v);
  }
  if (result.ok) params.set("ok", result.ok);
  if (result.erro) params.set("erro", result.erro);
  return `/lojas?${params}`;
}

// Permissions are enforced again by ldo_save_store_sale in the database.
export async function saveSale(form: FormData) {
  const viewer = await requireViewer();
  const store = viewer.stores.find((s) => s.id === String(form.get("store_id") || ""));
  const date = String(form.get("data") || "");
  if (!store || !validDate(date)) redirect(back(form, { erro: "Loja ou data inválida." }));
  const parsed = parseSaleForm(form);
  if ("error" in parsed) redirect(back(form, { erro: parsed.error }));
  let error = "";
  try {
    await rpc("ldo_save_store_sale", {
      p_session: viewer.session,
      p_store_id: store.id,
      p_sale_date: date,
      p_total_sales: parsed.values.total_sales,
      p_receipts: parsed.values.receipts,
      p_items: parsed.values.items,
      p_cash: parsed.values.cash,
      p_card: parsed.values.card,
      p_other_payment: parsed.values.other_payment,
      p_notes: parsed.notes,
    });
  } catch (e) {
    error = userMessage(e);
  }
  redirect(back(form, error ? { erro: error } : { ok: "saved" }));
}

export async function deleteSale(form: FormData) {
  const viewer = await requireViewer();
  let error = "";
  try {
    await rpc("ldo_remove_store_sale", { p_session: viewer.session, p_sale_id: String(form.get("sale_id") || "") });
  } catch (e) {
    error = userMessage(e);
  }
  redirect(back(form, error ? { erro: error } : { ok: "deleted" }));
}
