"use server";

import { redirect } from "next/navigation";
import { grantableLevels, type Level } from "@/lib/permissions";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

// Store levels arrive as fields "loja:<store id>" = "" | "store" | "manager".
// ldo_save_user re-checks every rule in the database.
export async function saveUser(form: FormData) {
  const viewer = await requireViewer();
  const id = String(form.get("user_id") || "") || null;
  const stores: { store_id: string; level: Level }[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("loja:") || (value !== "store" && value !== "manager")) continue;
    const storeId = key.slice(5);
    if (grantableLevels(viewer, storeId).includes(value)) stores.push({ store_id: storeId, level: value });
  }
  let error = "";
  let saved = "";
  try {
    saved = await rpc<string>(viewer.token, "ldo_save_user", {
      p_user_id: id,
      p_email: String(form.get("email") || ""),
      p_full_name: String(form.get("full_name") || ""),
      p_is_super_admin: viewer.isSuper && form.get("is_super_admin") === "on",
      p_online_access: viewer.isSuper && form.get("online_access") === "on",
      p_active: form.get("active") === "on",
      p_stores: stores,
    });
  } catch (e) {
    error = userMessage(e);
  }
  if (error) {
    // A new invite keeps what was typed so it does not have to be written again.
    const typed: Record<string, string> = id ? { id } : { novo: "1", email: String(form.get("email") || ""), nome: String(form.get("full_name") || "") };
    redirect(`/admin/utilizadores?${new URLSearchParams({ ...typed, erro: error })}`);
  }
  redirect(`/admin/utilizadores?${new URLSearchParams({ id: saved || id || "", ok: id ? "updated" : "created" })}`);
}
