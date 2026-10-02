"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { setSession } from "@/lib/session";
import { homePath } from "@/lib/permissions";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

// Changing the password ends every other session; this one gets a new token.
export async function changePassword(form: FormData) {
  const viewer = await requireViewer({ allowPasswordChange: true });
  const next = String(form.get("new_password") || "");
  let error = "";
  let token = "";
  if (next !== String(form.get("confirm_password") || "")) error = "As duas palavras-passe novas não coincidem.";
  else
    try {
      token = await rpc<string>("ldo_change_password", {
        p_session: viewer.session,
        p_current: String(form.get("current_password") || ""),
        p_new: next,
      });
    } catch (e) {
      error = userMessage(e);
    }
  if (error || !token) redirect(`/conta?${new URLSearchParams({ erro: error || "Não foi possível mudar a palavra-passe.", ...(viewer.mustChangePassword ? { primeiro: "1" } : {}) })}`);
  setSession(await cookies(), token);
  redirect(viewer.mustChangePassword ? homePath(viewer) || "/conta?ok=1" : "/conta?ok=1");
}
