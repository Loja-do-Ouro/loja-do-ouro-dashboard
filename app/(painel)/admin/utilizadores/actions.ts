"use server";

import { redirect } from "next/navigation";
import { sendAccess } from "@/lib/access";
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
  const password = String(form.get("password") || "");
  const email = String(form.get("email") || "").trim().toLowerCase().slice(0, 160);
  // Só o Super Admin envia o acesso por email (link para a pessoa criar a palavra-passe), e só se houver email.
  const askedToSend = viewer.isSuper && form.get("send_access") === "on";
  const sendByEmail = askedToSend && !!email;
  let error = "";
  let saved = "";
  if (viewer.isSuper && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error = "Email inválido.";
  else if (!id && !password && !sendByEmail) error = "Indique uma palavra-passe inicial ou o email da pessoa para lhe enviar o acesso.";
  else
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
        p_password: password,
        p_must_change: form.get("must_change") === "on",
      });
      if (viewer.isSuper)
        await rpc("ldo_save_user_contact", {
          p_session: viewer.session,
          p_user_id: saved || id,
          p_email: email,
          p_receive_reports: form.get("receive_reports") === "on",
        });
      if (viewer.isSuper)
        await rpc("ldo_support_set_user_access", { p_session: viewer.session, p_user_id: saved || id, p_access: form.get("support_access") === "on" });
    } catch (e) {
      error = userMessage(e);
    }
  if (error) {
    // A user that was already created opens in edit mode (and says so); a new one keeps what was typed (never the
    // password).
    if (saved && !id)
      redirect(`/admin/utilizadores?${new URLSearchParams({ id: saved, erro: `Utilizador criado, mas não ficou tudo guardado: ${error} Corrija e grave de novo.` })}`);
    const typed: Record<string, string> = id
      ? { id }
      : { novo: "1", username: String(form.get("username") || ""), nome: String(form.get("full_name") || "") };
    redirect(`/admin/utilizadores?${new URLSearchParams({ ...typed, erro: error })}`);
  }
  let ok = id ? "updated" : "created";
  if (askedToSend && !email) ok = id ? "updated_noemail" : "created_noemail";
  if (sendByEmail) {
    const sent = await sendAccess(viewer.session, saved || id!);
    if (!sent.ok)
      redirect(`/admin/utilizadores?${new URLSearchParams({ id: saved || id || "", erro: `${id ? "Alterações guardadas" : "Utilizador criado"}, mas o acesso não foi enviado: ${sent.error}` })}`);
    ok = id ? "updated_sent" : "created_sent";
  }
  redirect(`/admin/utilizadores?${new URLSearchParams({ id: saved || id || "", ok })}`);
}

// "Enviar acesso" na lista: um link novo (o anterior deixa de funcionar).
export async function resendAccess(form: FormData) {
  const viewer = await requireViewer();
  const id = String(form.get("user_id") || "");
  const filter = String(form.get("loja") || "");
  const sent = viewer.isSuper ? await sendAccess(viewer.session, id) : ({ ok: false, error: "Só o Super Admin pode enviar acessos por email." } as const);
  redirect(`/admin/utilizadores?${new URLSearchParams({ ...(filter ? { loja: filter } : {}), ...(sent.ok ? { ok: "sent" } : { erro: sent.error }) })}`);
}
