"use server";

import { redirect } from "next/navigation";
import { optionCode } from "@/lib/store-records";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

// Only the Super Admin edits the lists; ldo_save_option enforces it.
export async function saveOption(form: FormData) {
  const viewer = await requireViewer();
  const list = String(form.get("list") || "");
  const name = String(form.get("label") || "").trim();
  const code = String(form.get("code") || "") || optionCode(name);
  const order = Number(String(form.get("sort_order") || "100"));
  let error = "";
  if (!name) error = "Escreva o nome da opção.";
  else if (!code) error = "Nome inválido.";
  else
    try {
      await rpc("ldo_save_option", {
        p_session: viewer.session,
        p_list: list,
        p_code: code,
        p_label: name.slice(0, 80),
        p_sort_order: Number.isInteger(order) ? order : 100,
        p_active: form.get("active") === "on",
        p_digital: form.get("digital") === "on",
      });
    } catch (e) {
      error = userMessage(e);
    }
  redirect(`/admin/opcoes?${new URLSearchParams({ lista: list, ...(error ? { erro: error } : { ok: "1" }) })}`);
}
