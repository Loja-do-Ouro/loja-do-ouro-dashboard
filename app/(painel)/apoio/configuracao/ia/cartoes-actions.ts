"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import {
  autoOkBlockers, cardPii, CARD_ESTADOS, companyAllowlist, isIntent, PII_LABEL, storeKeywords, type AutoCard, type CardEstado, type PiiProblem,
} from "@/lib/support/knowledge-rules";
import { requireViewer, type Viewer } from "@/lib/viewer";

// Base de conhecimento aprendida (só o Super Admin; verificado aqui e na BD). As mensagens voltam ao painel dos cartões,
// com parâmetros próprios (a revisão da IA, na mesma página, tem os seus), com o estado e a pesquisa que estavam abertos.
const back = (params: Record<string, string>, estado?: string, q?: string): never =>
  redirect(`/apoio/configuracao/ia?${new URLSearchParams({ ...params, ...(estado ? { cartoes: estado } : {}), ...(q ? { cartoes_q: q } : {}) })}#cartoes`);

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
const queryOf = (form: FormData) => field(form, "voltar_q").slice(0, 200);

type CardList = {
  cards: (AutoCard & { loja: string | null; pergunta: string; variantes: string[] })[];
  stores: { id: string; name: string; city: string | null }[];
  targets: Pick<AutoCard, "id" | "estado" | "intent" | "brand" | "loja_id" | "auto_ok">[];
  knowledge: { title: string; body: string }[];
  company?: string[];
  staff_names?: string[];
};
type Saved = { id: string; estado: CardEstado; alterada: boolean; auto_retirada: boolean };

const cardList = (viewer: Viewer, estado: CardEstado) =>
  sessionRpc<CardList>(viewer.session, "ldo_support_knowledge_cards", { p_estado: estado, p_q: null });
const knowledgeOf = (list: CardList) => list.knowledge.map((k) => `## ${k.title}\n${k.body}`).join("\n\n");

// Dados pessoais no texto de um cartão: as mesmas regras das propostas da IA, com os dados da empresa aceites e os nomes
// da equipa. Os dados da empresa que faltem têm de entrar na base de conhecimento.
function piiOf(list: CardList, card: { pergunta: string; variantes: string[]; resposta: string }) {
  const allow = companyAllowlist({ knowledge: knowledgeOf(list), stores: list.stores, extra: list.company || [] });
  return cardPii(card, allow, list.staff_names || []);
}
const piiText = (p: PiiProblem[]) => p.map((x) => PII_LABEL[x]).join(", ");
const PII_HINT = "os dados da empresa (telefones, moradas, emails) têm de estar na base de conhecimento";

function cardValues(form: FormData) {
  return {
    intent: field(form, "intent"), brand: field(form, "brand") || "ldo", loja_id: field(form, "loja_id") || null, pergunta: field(form, "pergunta"),
    variantes: field(form, "variantes").split("\n").map((v) => v.trim()).filter(Boolean), resposta: field(form, "resposta"),
    valido_ate: field(form, "valido_ate") || null,
  };
}

const publishHint = (s: Saved) =>
  `${s.estado === "aprovada" ? " Publique as alterações para a IA usar a nova versão." : ""}${s.auto_retirada ? " Deixou de estar marcada para respostas automáticas." : ""}`;

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

// Criar (sem id) ou corrigir um cartão. Variantes: uma por linha. A correção fica sempre guardada (nada se perde); se o
// texto parecer ter dados pessoais, o aviso diz o quê, e "Aprovar" e "Publicar alterações" recusam-no até ser corrigido.
export async function saveCard(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id") || null;
  const estado = estadoOf(form), q = queryOf(form);
  const values = cardValues(form);
  if (!isIntent(values.intent)) back({ cartoes_erro: "Escolha o tema." }, estado, q);
  let saved: Saved | null = null;
  try {
    saved = await sessionRpc<Saved>(viewer.session, "ldo_support_knowledge_card_save", { p_id: id, p_values: values });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  const to = id ? estado : "proposta";
  const done = !id ? "Proposta criada: aprove-a para a usar." : saved!.alterada ? `Resposta corrigida.${publishHint(saved!)}` : "Sem alterações.";
  const pii = await cardList(viewer, "aprovada").then((l) => piiOf(l, values)).catch(() => [] as PiiProblem[]);
  if (pii.length) back({ cartoes_erro: `${done} Atenção: o texto parece ter ${piiText(pii)}. Corrija-o antes de aprovar ou publicar (${PII_HINT}).` }, to, q);
  back({ cartoes_ok: done }, to, q);
}

// "Aprovar", "Aprovar de novo" e "Confirmar que continua certa", no mesmo formulário das correções: guarda primeiro o que
// estiver nos campos e só depois aprova (ou regista a revisão). Não aprova um texto com dados pessoais.
export async function saveAndApprove(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id");
  const estado = estadoOf(form), q = queryOf(form);
  const values = cardValues(form);
  if (!id) back({ cartoes_erro: "Resposta não encontrada." }, estado, q);
  if (!isIntent(values.intent)) back({ cartoes_erro: "Escolha o tema." }, estado, q);
  let saved: Saved | null = null;
  let pii: PiiProblem[] = [];
  try {
    saved = await sessionRpc<Saved>(viewer.session, "ldo_support_knowledge_card_save", { p_id: id, p_values: values });
    pii = piiOf(await cardList(viewer, "aprovada"), values);
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  const s = saved!;
  if (pii.length)
    back({ cartoes_erro: `${s.alterada ? "Correções guardadas, mas a" : "A"} resposta não foi ${s.estado === "aprovada" ? "confirmada" : "aprovada"}: o texto parece ter ${piiText(pii)}. Corrija-o (${PII_HINT}) e volte a carregar no botão.` }, estado, q);
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_state", { p_id: id, p_estado: "aprovada" });
  } catch (e) {
    back({ cartoes_erro: `${s.alterada ? "Correções guardadas, mas " : ""}${userMessage(e)}` }, estado, q);
  }
  back({
    cartoes_ok: s.estado === "aprovada"
      ? s.alterada ? `Correções guardadas e revisão registada.${publishHint(s)}` : "Revisão registada."
      : `Resposta aprovada${s.alterada ? " com as correções" : ""}. Publique as alterações para a IA a usar.`,
  }, estado, q);
}

// Arquivar (sai logo da IA e das respostas automáticas).
export async function archiveCard(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form), q = queryOf(form);
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_state", { p_id: field(form, "id"), p_estado: "arquivada" });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  back({ cartoes_ok: "Resposta arquivada: a IA deixou de a usar." }, estado, q);
}

export async function mergeCard(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form), q = queryOf(form);
  const into = field(form, "into");
  if (!into) back({ cartoes_erro: "Escolha a resposta a que quer juntar esta." }, estado, q);
  let r: { estado: string; alterada: boolean; auto_retirada: boolean } | null = null;
  try {
    r = await sessionRpc(viewer.session, "ldo_support_knowledge_card_merge", { p_id: field(form, "id"), p_into: into });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  back({
    cartoes_ok: `Respostas juntas: esta ficou arquivada${r?.alterada ? " e a pergunta passou a ser uma das formas da outra" : " (a pergunta já era uma das formas da outra)"}.`
      + `${r?.alterada && r.estado === "aprovada" ? " Publique as alterações para a IA usar a nova versão." : ""}`
      + `${r?.auto_retirada ? " A outra deixou de estar marcada para respostas automáticas." : ""}`,
  }, estado, q);
}

// Publicar: nada é publicado enquanto uma resposta por publicar parecer ter dados pessoais.
export async function publishCards(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form), q = queryOf(form);
  let blocked: string[] = [];
  try {
    const list = await cardList(viewer, "aprovada");
    blocked = list.cards.filter((c) => c.por_publicar && piiOf(list, c).length).map((c) => `«${c.pergunta.slice(0, 80)}»`);
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  if (blocked.length)
    back({
      cartoes_erro: `Nada foi publicado: ${blocked.length === 1 ? "uma resposta aprovada parece ter" : `${blocked.length} respostas aprovadas parecem ter`} dados pessoais (${blocked.slice(0, 3).join(", ")}${blocked.length > 3 ? "…" : ""}). Corrija-as nas Aprovadas (${PII_HINT}).`,
    }, "aprovada", q);
  let r: { alteradas: number; em_uso: number } | null = null;
  try {
    r = await sessionRpc<{ alteradas: number; em_uso: number }>(viewer.session, "ldo_support_knowledge_publish");
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  back({ cartoes_ok: `Publicadas ${r?.alteradas ?? 0} alteração(ões). A IA usa agora ${r?.em_uso ?? 0} resposta(s) aprovada(s).` }, estado, q);
}

// "Permitir em respostas automáticas" (só marca o cartão para o futuro; nada é enviado). O texto é verificado aqui; o
// resto também na BD.
export async function setCardAuto(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id");
  const q = queryOf(form);
  const on = field(form, "auto_ok") === "1";
  if (on) {
    let list: CardList | null = null;
    try {
      list = await cardList(viewer, "aprovada");
    } catch (e) {
      back({ cartoes_erro: userMessage(e) }, "aprovada", q);
    }
    const card = list?.cards.find((c) => c.id === id);
    if (!list || !card) back({ cartoes_erro: "Resposta não encontrada entre as aprovadas." }, "aprovada", q);
    const store = list!.stores.find((s) => s.id === card!.loja_id);
    const blockers = autoOkBlockers(card!, {
      now: new Date(), knowledge: knowledgeOf(list!), others: list!.targets,
      storeNames: store ? storeKeywords(store.name, list!.stores.map((s) => s.name)) : [],
    });
    if (blockers.length) back({ cartoes_erro: blockers.join(" ") }, "aprovada", q);
  }
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_auto", { p_id: id, p_auto_ok: on });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, "aprovada", q);
  }
  back({
    cartoes_ok: on
      ? "Marcada para respostas automáticas. Nada é enviado aos clientes enquanto as respostas automáticas não existirem e não forem ligadas."
      : "Deixou de estar marcada para respostas automáticas.",
  }, "aprovada", q);
}
