"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import { REFUSAL, runSync } from "@/lib/support/sync";
import { revokeConnection } from "@/lib/support/zendesk";
import { requireViewer } from "@/lib/viewer";

// Configuração do Apoio ao Cliente: só o Super Admin (verificado aqui e nas funções da BD).
async function superViewer() {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect("/apoio");
  return viewer;
}

const back = (params: Record<string, string>, hash = ""): never => redirect(`/apoio/configuracao?${new URLSearchParams(params)}${hash}`);

export async function savePolling(form: FormData) {
  const viewer = await superViewer();
  const seconds = Number(form.get("poll_seconds"));
  try {
    await sessionRpc(viewer.session, "ldo_support_save_settings", { p_poll_seconds: Math.round(seconds) });
  } catch (e) {
    back({ erro: userMessage(e) });
  }
  back({ ok: "Frequência guardada." });
}

export async function setSupportAccess(form: FormData) {
  const viewer = await superViewer();
  try {
    await sessionRpc(viewer.session, "ldo_support_set_user_access", { p_user_id: String(form.get("user_id") || ""), p_access: form.get("access") === "1" });
  } catch (e) {
    back({ erro: userMessage(e) });
  }
  back({ ok: "Acesso atualizado." });
}

export async function disconnectZendesk(form: FormData) {
  const viewer = await superViewer();
  const userId = String(form.get("user_id") || "");
  try {
    await revokeConnection(userId);
    await sessionRpc(viewer.session, "ldo_support_zendesk_disconnect", { p_user_id: userId });
  } catch (e) {
    back({ erro: userMessage(e) });
  }
  back({ ok: "Ligação Zendesk removida." });
}

export async function syncNow() {
  await superViewer();
  // O Super Admin pode ignorar a espera depois de erros (por exemplo depois de corrigir uma ligação).
  const results = await runSync({ force: true, override: true });
  const failed = results.filter((r) => r.ran && r.ok === false);
  const refused = results.filter((r) => !r.ran && r.reason);
  const note = refused.map((r) => `${r.source}: ${REFUSAL[r.reason!] || r.reason}`).join(" · ");
  back(failed.length ? { erro: failed.map((r) => `${r.source}: ${r.detail}`).join(" · ").slice(0, 600) } : { ok: `Sincronização concluída.${note ? ` Não correu: ${note}.` : ""}` });
}

// Assistente de IA: interruptor, limite diário por pessoa e orçamento mensal (US$).
export async function saveAiSettings(form: FormData) {
  const viewer = await superViewer();
  const limit = Number(form.get("ai_daily_limit"));
  const budget = Number(String(form.get("ai_monthly_budget") || "").replace(",", "."));
  if (!Number.isFinite(limit) || !Number.isFinite(budget)) back({ erro: "Indique números válidos no limite e no orçamento." }, "#ia");
  try {
    await sessionRpc(viewer.session, "ldo_support_ai_save_settings", {
      p_enabled: form.get("ai_enabled") === "on", p_daily_limit: Math.round(limit), p_monthly_budget: Math.round(budget * 100) / 100,
    });
  } catch (e) {
    back({ erro: userMessage(e) }, "#ia");
  }
  back({ ok: "Assistente de IA atualizado." }, "#ia");
}

// Base de conhecimento que a IA lê (políticas, lojas, tom de voz). Sem id cria uma secção nova.
export async function saveKnowledge(form: FormData) {
  const viewer = await superViewer();
  const id = String(form.get("id") || "") || null;
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_save", {
      p_id: id, p_title: String(form.get("title") || ""), p_body: String(form.get("body") || ""),
      p_position: Math.round(Number(form.get("position") || 0)) || 0,
    });
  } catch (e) {
    back({ erro: userMessage(e) }, "#ia");
  }
  back({ ok: id ? "Secção guardada." : "Secção criada." }, "#ia");
}

export async function deleteKnowledge(form: FormData) {
  const viewer = await superViewer();
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_delete", { p_id: String(form.get("id") || "") });
  } catch (e) {
    back({ erro: userMessage(e) }, "#ia");
  }
  back({ ok: "Secção apagada." }, "#ia");
}
