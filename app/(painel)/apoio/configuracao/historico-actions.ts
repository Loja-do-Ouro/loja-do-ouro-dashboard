"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import { requireViewer } from "@/lib/viewer";

// Histórico visível do Apoio ao Cliente (só o Super Admin; verificado aqui e na BD). A mensagem volta à própria
// secção (#historico), com parâmetros só dela, para não aparecer também no topo da página.
const back = (params: Record<string, string>): never => redirect(`/apoio/configuracao?${new URLSearchParams(params)}#historico`);

export async function saveHistory(form: FormData) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect("/apoio");
  // Dia escolhido no campo de data (AAAA-MM-DD); a BD conta-o a partir das 00:00 de Lisboa.
  const day = String(form.get("history_from") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) back({ historico_erro: "Escolha uma data." });
  try {
    await sessionRpc(viewer.session, "ldo_support_history_settings_save", { p_history_from: day });
  } catch (e) {
    back({ historico_erro: userMessage(e) });
  }
  back({ historico_ok: "1" });
}
