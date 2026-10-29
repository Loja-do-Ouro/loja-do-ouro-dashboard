"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import {
  ACK_LABEL, autoOkBlockers, cardAlerts, CARD_ESTADOS, companyAllowlist, isIntent, PII_LABEL, reviewCard, storeKeywords, unackedWarnings,
  type AutoCard, type CardEstado, type PiiProblem,
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

type CardText = { pergunta: string; variantes: string[]; resposta: string };
type CardList = {
  cards: (AutoCard & CardText & { loja: string | null; avisos?: string[]; avisos_ok?: string[] })[];
  stores: { id: string; name: string; city: string | null }[];
  targets: Pick<AutoCard, "id" | "estado" | "intent" | "brand" | "loja_id" | "auto_ok">[];
  knowledge: { title: string; body: string }[];
  company?: string[];
  staff_names?: string[];
};
// avisos: os da proposta da IA; avisos_ok: os confirmados para o texto guardado (vazio quando o texto mudou).
type Saved = { id: string; estado: CardEstado; alterada: boolean; auto_retirada: boolean; avisos?: string[]; avisos_ok?: string[] };

const cardList = (viewer: Viewer, estado: CardEstado) =>
  sessionRpc<CardList>(viewer.session, "ldo_support_knowledge_cards", { p_estado: estado, p_q: null });
const knowledgeOf = (list: CardList) => list.knowledge.map((k) => `## ${k.title}\n${k.body}`).join("\n\n");
const allowOf = (list: CardList) => companyAllowlist({ knowledge: knowledgeOf(list), stores: list.stores, extra: list.company || [] });

// Dados pessoais (recusas) no texto de um cartão: as mesmas regras das propostas da IA, com os dados da empresa aceites e
// os nomes da equipa. Os dados da empresa que faltem têm de entrar na base de conhecimento.
const blocksOf = (list: CardList, card: CardText) => reviewCard(card, allowOf(list), list.staff_names || []).blocks;
const alertsOf = (list: CardList, card: CardText & { avisos?: string[] }) => cardAlerts(card, allowOf(list), list.staff_names || []);
const piiText = (p: PiiProblem[]) => p.map((x) => PII_LABEL[x]).join(", ");
const PII_HINT = "os dados da empresa (telefones, moradas, emails) têm de estar na base de conhecimento";
const ACK_HINT = `Se o texto não tiver dados pessoais nem contradisser a resposta da equipa, marque «${ACK_LABEL}» e volte a carregar no botão; se não, corrija-o.`;

// Avisos por confirmar do texto guardado. Com a confirmação marcada, regista-a na BD (com a lista dos avisos), mas só
// se forem os avisos que o Super Admin viu no painel (avisos_vistos) e para o texto guardado: um aviso novo (o texto
// mudou entretanto) volta a pedir a confirmação (novos).
async function checkWarnings(viewer: Viewer, form: FormData, id: string, values: CardText, list: CardList, saved: Saved) {
  const all = alertsOf(list, { ...values, avisos: saved.avisos || [] });
  const pending = unackedWarnings(all, saved.avisos_ok);
  if (!pending.length || form.get("avisos_ok") !== "1") return { pending, novos: false, confirmados: 0 };
  let seen: unknown = [];
  try {
    seen = JSON.parse(field(form, "avisos_vistos") || "[]");
  } catch {
    seen = [];
  }
  const shown = new Set(Array.isArray(seen) ? seen.filter((x): x is string => typeof x === "string") : []);
  if (all.length > 60 || pending.some((w) => !shown.has(w))) return { pending, novos: true, confirmados: 0 };
  await sessionRpc(viewer.session, "ldo_support_knowledge_card_ack", {
    p_id: id, p_texto: { pergunta: values.pergunta, variantes: values.variantes, resposta: values.resposta }, p_avisos: all,
  });
  return { pending: [] as string[], novos: false, confirmados: pending.length };
}
const warningsText = (w: { pending: string[]; novos: boolean }) =>
  `${w.novos ? "O texto tem avisos que ainda não tinha visto: veja-os e confirme de novo." : ACK_HINT} Avisos: ${w.pending.slice(0, 5).join("; ")}${w.pending.length > 5 ? "…" : ""}.`;

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
// texto tiver dados pessoais ou avisos por confirmar, a mensagem diz quais, e "Aprovar" e "Publicar alterações" recusam-no
// até ser corrigido (ou, nos avisos, confirmado).
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
  const s = saved!;
  const to = id ? estado : "proposta";
  const done = !id ? "Proposta criada: aprove-a para a usar." : s.alterada ? `Resposta corrigida.${publishHint(s)}` : "Sem alterações.";
  const list = await cardList(viewer, "aprovada").catch(() => null);
  if (!list) back({ cartoes_ok: done }, to, q);
  const blocks = blocksOf(list!, values);
  let w = { pending: [] as string[], novos: false, confirmados: 0 };
  try {
    w = await checkWarnings(viewer, form, s.id, values, list!, s);
  } catch (e) {
    back({ cartoes_erro: `${done} ${userMessage(e)}` }, to, q);
  }
  const warn = [
    blocks.length ? `o texto tem ${piiText(blocks)} (corrija-o; ${PII_HINT}).` : "",
    w.pending.length ? warningsText(w) : "",
  ].filter(Boolean);
  if (warn.length) back({ cartoes_erro: `${done} Atenção, só pode aprovar ou publicar depois disto: ${warn.join(" ")}` }, to, q);
  back({ cartoes_ok: `${done}${w.confirmados ? " Registada a confirmação dos avisos para este texto." : ""}` }, to, q);
}

// "Aprovar", "Aprovar de novo" e "Confirmar que continua certa", no mesmo formulário das correções: guarda primeiro o que
// estiver nos campos e só depois aprova (ou regista a revisão). Não aprova um texto com dados pessoais nem com avisos
// por confirmar (ACK_LABEL, no mesmo formulário).
export async function saveAndApprove(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id");
  const estado = estadoOf(form), q = queryOf(form);
  const values = cardValues(form);
  if (!id) back({ cartoes_erro: "Resposta não encontrada." }, estado, q);
  if (!isIntent(values.intent)) back({ cartoes_erro: "Escolha o tema." }, estado, q);
  let saved: Saved | null = null;
  let list: CardList | null = null;
  try {
    saved = await sessionRpc<Saved>(viewer.session, "ldo_support_knowledge_card_save", { p_id: id, p_values: values });
    list = await cardList(viewer, "aprovada");
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  const s = saved!;
  const not = `${s.alterada ? "Correções guardadas, mas a" : "A"} resposta não foi ${s.estado === "aprovada" ? "confirmada" : "aprovada"}`;
  const blocks = blocksOf(list!, values);
  if (blocks.length)
    back({ cartoes_erro: `${not}: o texto tem ${piiText(blocks)}. Corrija-o (${PII_HINT}) e volte a carregar no botão.` }, estado, q);
  let w = { pending: [] as string[], novos: false, confirmados: 0 };
  try {
    w = await checkWarnings(viewer, form, id, values, list!, s);
  } catch (e) {
    back({ cartoes_erro: `${not}: ${userMessage(e)}` }, estado, q);
  }
  if (w.pending.length) back({ cartoes_erro: `${not}: ${warningsText(w)}` }, estado, q);
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
      + `${r?.alterada ? " Confirme de novo os avisos da outra." : ""}`
      + `${r?.alterada && r.estado === "aprovada" ? " Publique as alterações para a IA usar a nova versão." : ""}`
      + `${r?.auto_retirada ? " A outra deixou de estar marcada para respostas automáticas." : ""}`,
  }, estado, q);
}

// Publicar: nada é publicado enquanto uma resposta por publicar tiver dados pessoais ou avisos por confirmar.
export async function publishCards(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form), q = queryOf(form);
  let blocked: string[] = [];
  let unacked: string[] = [];
  try {
    const list = await cardList(viewer, "aprovada");
    const pending = list.cards.filter((c) => c.por_publicar);
    blocked = pending.filter((c) => blocksOf(list, c).length).map((c) => `«${c.pergunta.slice(0, 80)}»`);
    unacked = pending.filter((c) => !blocksOf(list, c).length && unackedWarnings(alertsOf(list, c), c.avisos_ok).length)
      .map((c) => `«${c.pergunta.slice(0, 80)}»`);
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  const few = (l: string[]) => `${l.slice(0, 3).join(", ")}${l.length > 3 ? "…" : ""}`;
  if (blocked.length || unacked.length)
    back({
      cartoes_erro: `Nada foi publicado: ${[
        blocked.length ? `${blocked.length === 1 ? "uma resposta aprovada tem" : `${blocked.length} respostas aprovadas têm`} dados pessoais (${few(blocked)}); corrija-as nas Aprovadas (${PII_HINT})` : "",
        unacked.length ? `${unacked.length === 1 ? "uma resposta aprovada tem" : `${unacked.length} respostas aprovadas têm`} avisos por confirmar (${few(unacked)}); confirme-os ou corrija-as nas Aprovadas` : "",
      ].filter(Boolean).join("; ")}.`,
    }, "aprovada", q);
  let r: { alteradas: number; em_uso: number } | null = null;
  try {
    r = await sessionRpc<{ alteradas: number; em_uso: number }>(viewer.session, "ldo_support_knowledge_publish");
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  back({ cartoes_ok: `Publicadas ${r?.alteradas ?? 0} alteração(ões). A IA usa agora ${r?.em_uso ?? 0} resposta(s) aprovada(s).` }, estado, q);
}

// "Permitir em respostas automáticas" (só marca o cartão para o futuro; nada é enviado). O texto é verificado aqui
// (também dados pessoais e avisos por confirmar); o resto também na BD.
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
      now: new Date(), knowledge: knowledgeOf(list!), others: list!.targets, allow: allowOf(list!), staffNames: list!.staff_names || [],
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
