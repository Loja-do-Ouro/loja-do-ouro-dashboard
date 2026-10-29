"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import { autoOkBlockers, CARD_ESTADOS, isIntent, storeKeywords, type AutoCard, type CardEstado } from "@/lib/support/knowledge-rules";
import { requireViewer } from "@/lib/viewer";

// Base de conhecimento aprendida (só o Super Admin; verificado aqui e na BD). As mensagens voltam ao painel dos cartões,
// com parâmetros próprios (a revisão da IA, na mesma página, tem os seus).
const back = (params: Record<string, string>, estado?: string): never =>
  redirect(`/apoio/configuracao/ia?${new URLSearchParams({ ...params, ...(estado ? { cartoes: estado } : {}) })}#cartoes`);

async function superViewer() {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect("/apoio");
  return viewer;
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").replace(/\r\n?/g, "\n").trim();
const estadoOf = (form: FormData) => {
  const e = field(form, "voltar");
  return CARD_ESTADOS.includes(e as CardEstado) ? e : "proposta";
};

export async function saveKnowledgeSettings(form: FormData) {
  const viewer = await superViewer();
  const rawBudget = field(form, "monthly_budget").replace(",", ".");
  // Um campo vazio nunca vale 0 (pararia as propostas sem querer).
  const budget = rawBudget ? Number(rawBudget) : NaN;
  if (!Number.isFinite(budget)) back({ cartoes_erro: "Indique um orçamento mensal válido." });
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_settings_save", {
      p_values: { auto_proposals: form.get("auto_proposals") === "on", monthly_budget: Math.round(budget * 100) / 100 },
    });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) });
  }
  back({ cartoes_ok: "Definições da base de conhecimento aprendida atualizadas." });
}

// Criar (sem id) ou corrigir um cartão. Variantes: uma por linha.
export async function saveCard(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id") || null;
  const intent = field(form, "intent");
  const estado = estadoOf(form);
  if (!isIntent(intent)) back({ cartoes_erro: "Escolha o tema." }, estado);
  const values = {
    intent, brand: field(form, "brand") || "ldo", loja_id: field(form, "loja_id") || null, pergunta: field(form, "pergunta"),
    variantes: field(form, "variantes").split("\n").map((v) => v.trim()).filter(Boolean), resposta: field(form, "resposta"),
    valido_ate: field(form, "valido_ate") || null,
  };
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_save", { p_id: id, p_values: values });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado);
  }
  back({ cartoes_ok: id ? "Resposta corrigida." : "Proposta criada: aprove-a para a usar." }, id ? estado : "proposta");
}

// Aprovar, confirmar que continua certa (numa aprovada) ou arquivar.
export async function setCardState(form: FormData) {
  const viewer = await superViewer();
  const to = field(form, "estado");
  const estado = estadoOf(form);
  if (to !== "aprovada" && to !== "arquivada") back({ cartoes_erro: "Estado inválido." }, estado);
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_state", { p_id: field(form, "id"), p_estado: to });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado);
  }
  back({
    cartoes_ok: to === "arquivada"
      ? "Resposta arquivada: a IA deixou de a usar."
      : estado === "aprovada" ? "Revisão registada." : "Resposta aprovada. Publique as alterações para a IA a usar.",
  }, estado);
}

export async function mergeCard(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form);
  const into = field(form, "into");
  if (!into) back({ cartoes_erro: "Escolha a resposta a que quer juntar esta." }, estado);
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_merge", { p_id: field(form, "id"), p_into: into });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado);
  }
  back({ cartoes_ok: "Respostas juntas: a pergunta passou a ser uma das formas da outra e esta ficou arquivada." }, estado);
}

export async function publishCards(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form);
  let r: { alteradas: number; em_uso: number } | null = null;
  try {
    r = await sessionRpc<{ alteradas: number; em_uso: number }>(viewer.session, "ldo_support_knowledge_publish");
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado);
  }
  back({ cartoes_ok: `Publicadas ${r?.alteradas ?? 0} alteração(ões). A IA usa agora ${r?.em_uso ?? 0} resposta(s) aprovada(s).` }, estado);
}

type CardsForAuto = {
  cards: (AutoCard & { loja: string | null })[];
  stores: { id: string; name: string; city: string | null }[];
  targets: Pick<AutoCard, "id" | "estado" | "intent" | "brand" | "loja_id" | "auto_ok">[];
  knowledge: { title: string; body: string }[];
};

// "Permitir em respostas automáticas" (só marca o cartão para o futuro; nada é enviado). O texto é verificado aqui; o
// resto também na BD.
export async function setCardAuto(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id");
  const on = field(form, "auto_ok") === "1";
  if (on) {
    let list: CardsForAuto | null = null;
    try {
      list = await sessionRpc<CardsForAuto>(viewer.session, "ldo_support_knowledge_cards", { p_estado: "aprovada", p_q: null });
    } catch (e) {
      back({ cartoes_erro: userMessage(e) }, "aprovada");
    }
    const card = list?.cards.find((c) => c.id === id);
    if (!list || !card) back({ cartoes_erro: "Resposta não encontrada entre as aprovadas." }, "aprovada");
    const store = list!.stores.find((s) => s.id === card!.loja_id);
    const blockers = autoOkBlockers(card!, {
      now: new Date(), knowledge: list!.knowledge.map((k) => `## ${k.title}\n${k.body}`).join("\n\n"), others: list!.targets,
      storeNames: store ? storeKeywords(store.name, list!.stores.map((s) => s.name)) : [],
    });
    if (blockers.length) back({ cartoes_erro: blockers.join(" ") }, "aprovada");
  }
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_auto", { p_id: id, p_auto_ok: on });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, "aprovada");
  }
  back({
    cartoes_ok: on
      ? "Marcada para respostas automáticas. Nada é enviado aos clientes enquanto as respostas automáticas não existirem e não forem ligadas."
      : "Deixou de estar marcada para respostas automáticas.",
  }, "aprovada");
}
