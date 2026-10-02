"use server";

import { redirect } from "next/navigation";
import { storeCode } from "@/lib/store-records";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

// Only the Super Admin manages stores; ldo_save_store enforces it.
export async function saveStore(form: FormData) {
  const viewer = await requireViewer();
  const id = String(form.get("store_id") || "") || null;
  const name = String(form.get("name") || "").trim();
  const code = storeCode(String(form.get("code") || "") || name);
  const order = Number(String(form.get("sort_order") || "100"));
  let error = "";
  let saved = "";
  if (!viewer.isSuper) error = "Só o Super Admin pode gerir lojas.";
  else if (name.length < 2) error = "Indique o nome da loja.";
  else if (!code) error = "Indique um código para a loja.";
  else
    try {
      saved = await rpc<string>("ldo_save_store", {
        p_session: viewer.session,
        p_store_id: id,
        p_code: code,
        p_name: name,
        p_city: String(form.get("city") || ""),
        p_active: form.get("active") === "on",
        p_sort_order: Number.isInteger(order) ? order : 100,
        p_ads_keyword: String(form.get("ads_keyword") || "").trim().slice(0, 40),
      });
    } catch (e) {
      error = userMessage(e);
    }
  if (error) redirect(`/admin/lojas?${new URLSearchParams({ ...(id ? { id } : { novo: "1" }), erro: error })}`);
  redirect(`/admin/lojas?${new URLSearchParams({ id: saved || id || "", ok: id ? "updated" : "created" })}`);
}
