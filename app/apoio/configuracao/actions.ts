"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import { REFUSAL, runSync } from "@/lib/support/sync";
import { gmailDisconnectRemote } from "@/lib/support/gmail";
import { revokeConnection } from "@/lib/support/zendesk";
import { requireViewer } from "@/lib/viewer";

// Configuração do Apoio ao Cliente: só o Super Admin (verificado aqui e nas funções da BD).
async function superViewer() {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect("/apoio");
  return viewer;
}

// Ações das secções da IA e do email voltam a essa secção (secao=ia mostra lá a mensagem; #ia faz scroll até ela).
const back = (params: Record<string, string>, hash = ""): never =>
  redirect(`/apoio/configuracao?${new URLSearchParams(hash === "#ia" || hash === "#email" ? { ...params, secao: hash.slice(1) } : params)}${hash}`);

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
  const rawLimit = String(form.get("ai_daily_limit") ?? "").trim();
  const rawBudget = String(form.get("ai_monthly_budget") ?? "").trim().replace(",", ".");
  // Um campo vazio nunca vale 0 (desligaria a IA para toda a equipa sem querer).
  const limit = rawLimit ? Number(rawLimit) : NaN;
  const budget = rawBudget ? Number(rawBudget) : NaN;
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

// Email (Gmail): assinatura automática, resposta automática ("recebemos o seu email") e horário de atendimento.
export async function saveEmailSettings(form: FormData) {
  const viewer = await superViewer();
  const text = (name: string) => String(form.get(name) ?? "").replace(/\r\n/g, "\n");
  try {
    await sessionRpc(viewer.session, "ldo_support_email_save_settings", {
      p_signature: text("email_signature"), p_autoreply_enabled: form.get("email_autoreply_enabled") === "on",
      p_autoreply_text: text("email_autoreply_text"), p_autoreply_offhours_text: text("email_autoreply_offhours_text"),
      p_hours: { weekdays: text("hours_weekdays"), saturday: text("hours_saturday"), sunday: text("hours_sunday") },
    });
  } catch (e) {
    back({ erro: userMessage(e) }, "#email");
  }
  back({ ok: "Definições do email guardadas." }, "#email");
}

// Desligar a caixa: para os avisos da Google, revoga a autorização e apaga as chaves.
export async function disconnectGmail(form: FormData) {
  const viewer = await superViewer();
  if (form.get("confirm") !== "on") back({ erro: "Confirme antes de desligar a caixa." }, "#email");
  try {
    await gmailDisconnectRemote();
    await sessionRpc(viewer.session, "ldo_support_gmail_disconnect");
  } catch (e) {
    back({ erro: userMessage(e) }, "#email");
  }
  back({ ok: "Caixa Gmail desligada." }, "#email");
}
