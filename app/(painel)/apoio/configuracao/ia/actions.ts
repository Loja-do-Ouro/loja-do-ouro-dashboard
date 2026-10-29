"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import { isReviewModel, REVIEW_CRITERIA_MAX, REVIEW_MODES, type ReviewMode } from "@/lib/support/review-rules";
import { requireViewer } from "@/lib/viewer";

// Definições da IA do apoio (só o Super Admin; verificado aqui e na BD). As mensagens voltam a esta página.
const back = (params: Record<string, string>, hash = "#revisao"): never => redirect(`/apoio/configuracao/ia?${new URLSearchParams(params)}${hash}`);

export async function saveReviewSettings(form: FormData) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect("/apoio");
  const mode = String(form.get("mode") ?? "");
  const model = String(form.get("model") ?? "");
  const rawBudget = String(form.get("monthly_budget") ?? "").trim().replace(",", ".");
  // Um campo vazio nunca vale 0 (pararia a revisão para toda a equipa sem querer).
  const budget = rawBudget ? Number(rawBudget) : NaN;
  const criteria = String(form.get("criteria") ?? "").replace(/\r\n?/g, "\n").trim();
  if (!REVIEW_MODES.includes(mode as ReviewMode)) back({ erro: "Escolha o modo da revisão." });
  if (!isReviewModel(model)) back({ erro: "Escolha o modelo da revisão." });
  if (!Number.isFinite(budget)) back({ erro: "Indique um orçamento mensal válido." });
  if (!criteria || criteria.length > REVIEW_CRITERIA_MAX) back({ erro: `Os critérios têm de ter entre 1 e ${REVIEW_CRITERIA_MAX} caracteres.` });
  try {
    await sessionRpc(viewer.session, "ldo_support_review_settings_save", {
      p_values: { mode, model, monthly_budget: Math.round(budget * 100) / 100, criteria },
    });
  } catch (e) {
    back({ erro: userMessage(e) });
  }
  back({ ok: "Revisão da IA atualizada." });
}
