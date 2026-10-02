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
  const stores: Record<string, Level> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("loja:") || (value !== "store" && value !== "manager")) continue;
    const storeId = key.slice(5);
    if (grantableLevels(viewer, storeId).includes(value)) stores[storeId] = value;
  }
  let error = "";
  let saved = "";
  try {
    saved = await rpc<string>("ldo_save_user", {
      p_session: viewer.session,
      p_user_id: id,
      p_username: String(form.get("username") || ""),
      p_full_name: String(form.get("full_name") || ""),
      p_is_super_admin: viewer.isSuper && form.get("is_super_admin") === "on",
      p_online_access: viewer.isSuper && form.get("online_access") === "on",
      p_active: form.get("active") === "on",
      p_stores: stores,
      p_password: String(form.get("password") || ""),
      p_must_change: form.get("must_change") === "on",
    });
    if (viewer.isSuper)
      await rpc("ldo_save_user_contact", {
        p_session: viewer.session,
        p_user_id: saved || id,
        p_email: String(form.get("email") || "").trim().toLowerCase().slice(0, 160),
        p_receive_reports: form.get("receive_reports") === "on",
      });
  } catch (e) {
    error = userMessage(e);
  }
  if (error) {
    // A new user keeps what was typed (never the password) so it does not have to be written again.
    const typed: Record<string, string> = id
      ? { id }
      : { novo: "1", username: String(form.get("username") || ""), nome: String(form.get("full_name") || "") };
    redirect(`/admin/utilizadores?${new URLSearchParams({ ...typed, erro: error })}`);
  }
  redirect(`/admin/utilizadores?${new URLSearchParams({ id: saved || id || "", ok: id ? "updated" : "created" })}`);
}
