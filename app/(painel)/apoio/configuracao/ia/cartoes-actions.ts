"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import {
  ACK_LABEL, ACK_MAX_WARNINGS, autoOkBlockers, cardAlerts, CARD_ESTADOS, companyAllowlist, isIntent, needsConfirmation, PII_LABEL, plainSpaces,
  reviewCard, storeKeywords, type AutoCard, type CardEstado, type PiiProblem,
} from "@/lib/support/knowledge-rules";
import { requireViewer, type Viewer } from "@/lib/viewer";

// Base de conhecimento aprendida (só o Super Admin; verificado aqui e na BD). As mensagens voltam ao painel dos cartões,
// com parâmetros próprios (a revisão da IA, na mesma página, tem os seus), com o estado e a pesquisa que estavam abertos.
// Nenhuma mensagem leva texto do cartão nem os avisos (que podem citar um nome ou uma morada): só contagens e o id do
// cartão (cartoes_card), que o painel abre com os avisos à vista.
const back = (params: Record<string, string>, estado?: string, q?: string, card?: string | null): never =>
  redirect(`/apoio/configuracao/ia?${new URLSearchParams({ ...params, ...(estado ? { cartoes: estado } : {}), ...(q ? { cartoes_q: q } : {}),
    ...(card ? { cartoes_card: card } : {}) })}#cartoes`);

async function superViewer() {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect("/apoio");
  return viewer;
}

// Espaços que não quebram e caracteres invisíveis passam a espaços normais (as regras leem o texto assim).
const field = (form: FormData, name: string) => plainSpaces(String(form.get(name) ?? "")).replace(/\r\n?/g, "\n").trim();
const estadoOf = (form: FormData) => {
  const e = field(form, "voltar");
  return CARD_ESTADOS.includes(e as CardEstado) ? e : "proposta";
};
const queryOf = (form: FormData) => field(form, "voltar_q").slice(0, 200);

type CardText = { pergunta: string; variantes: string[]; resposta: string };
type CardList = {
  cards: (AutoCard & CardText & { loja: string | null; avisos?: string[]; avisos_ok?: string[]; confirmado?: boolean })[];
  stores: { id: string; name: string; city: string | null }[];
  targets: Pick<AutoCard, "id" | "estado" | "intent" | "brand" | "loja_id" | "auto_ok">[];
  knowledge: { title: string; body: string }[];
  company?: string[];
  staff_names?: string[];
};
// avisos: os da proposta da IA; avisos_ok: os mostrados na confirmação do texto guardado; confirmado: há uma confirmação
// para o texto guardado (a BD apaga-a quando o texto muda).
type Saved = { id: string; estado: CardEstado; alterada: boolean; auto_retirada: boolean; avisos?: string[]; avisos_ok?: string[]; confirmado?: boolean };

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
const avisosN = (n: number) => (n === 1 ? "1 aviso" : `${n} avisos`);

// A confirmação do Super Admin (ACK_LABEL), pedida em TODOS os cartões antes de aprovar: com a caixa marcada, regista-a
// na BD para o texto guardado (com a lista dos avisos mostrados, talvez vazia), mas só se os avisos do texto guardado
// forem os que o painel mostrou (avisos_vistos): um aviso que não estava no ecrã (o texto foi corrigido no formulário)
// volta a pedir a confirmação. Mais de ACK_MAX_WARNINGS avisos: o texto tem de ser encurtado.
type Ack = { ok: true; registada: boolean } | { ok: false; motivo: "falta" | "novos" | "demasiados"; n: number };
async function confirmText(viewer: Viewer, form: FormData, id: string, values: CardText, list: CardList, saved: Saved): Promise<Ack> {
  const all = alertsOf(list, { ...values, avisos: saved.avisos || [] });
  const card = { ...values, avisos: saved.avisos || [], avisos_ok: saved.avisos_ok || [], confirmado: !!saved.confirmado };
  if (!needsConfirmation(card, allowOf(list), list.staff_names || [])) return { ok: true, registada: false };
  if (form.get("avisos_ok") !== "1") return { ok: false, motivo: "falta", n: all.length };
  if (all.length > ACK_MAX_WARNINGS) return { ok: false, motivo: "demasiados", n: all.length };
  let seen: unknown = [];
  try {
    seen = JSON.parse(field(form, "avisos_vistos") || "[]");
  } catch {
    seen = [];
  }
  const shown = new Set(Array.isArray(seen) ? seen.filter((x): x is string => typeof x === "string") : []);
  const unseen = all.filter((w) => !shown.has(w));
  if (unseen.length) return { ok: false, motivo: "novos", n: unseen.length };
  await sessionRpc(viewer.session, "ldo_support_knowledge_card_ack", {
    p_id: id, p_texto: { pergunta: values.pergunta, variantes: values.variantes, resposta: values.resposta }, p_avisos: all,
  });
  return { ok: true, registada: true };
}
// Mensagem sem dados (só contagens): os avisos ficam à vista no cartão, que o painel abre.
const ackText = (a: Ack) => a.ok ? ""
  : a.motivo === "demasiados" ? `O texto tem demasiados avisos (${a.n}): encurte-o ou divida-o em várias respostas e volte a guardar.`
  : a.motivo === "novos" ? `O texto que guardou tem ${avisosN(a.n)} que não estava${a.n === 1 ? "" : "m"} no ecrã: leia-${a.n === 1 ? "o" : "os"} no cartão e confirme de novo.`
  : `Leia o texto${a.n ? ` e ${a.n === 1 ? "o aviso" : `os ${a.n} avisos`} no cartão` : ""}, marque «${ACK_LABEL}» e volte a carregar no botão.`;

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

// Criar (sem id) ou corrigir um cartão. Variantes: uma por linha. A correção fica sempre guardada (nada se perde); com a
// caixa de confirmação marcada, regista também a confirmação do texto guardado. Se o texto tiver dados pessoais ou ainda
// não estiver confirmado, a mensagem diz o que falta, e "Aprovar" e "Publicar alterações" recusam-no até ser corrigido
// (ou confirmado).
export async function saveCard(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id") || null;
  const estado = estadoOf(form), q = queryOf(form);
  const values = cardValues(form);
  if (!isIntent(values.intent)) back({ cartoes_erro: "Escolha o tema." }, estado, q, id);
  let saved: Saved | null = null;
  try {
    saved = await sessionRpc<Saved>(viewer.session, "ldo_support_knowledge_card_save", { p_id: id, p_values: values });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q, id);
  }
  const s = saved!;
  const to = id ? estado : "proposta";
  const done = !id ? "Proposta criada: leia-a, confirme-a e aprove-a para a usar." : s.alterada ? `Resposta corrigida.${publishHint(s)}` : "Sem alterações.";
  const list = await cardList(viewer, "aprovada").catch(() => null);
  if (!list) back({ cartoes_ok: done }, to, q, s.id);
  const blocks = blocksOf(list!, values);
  let ack: Ack = { ok: true, registada: false };
  // Uma proposta nova (sem id) só se confirma depois de o painel mostrar os avisos; um texto com dados pessoais claros
  // nunca fica confirmado (a confirmação diz que não os tem).
  if (id && !blocks.length) {
    try {
      ack = await confirmText(viewer, form, s.id, values, list!, s);
    } catch (e) {
      back({ cartoes_erro: `${done} ${userMessage(e)}` }, to, q, s.id);
    }
  }
  const warn = [blocks.length ? `o texto tem ${piiText(blocks)} (corrija-o; ${PII_HINT}).` : "", ack.ok ? "" : ackText(ack)].filter(Boolean);
  if (warn.length) back({ cartoes_erro: `${done} Atenção, só pode aprovar ou publicar depois disto: ${warn.join(" ")}` }, to, q, s.id);
  back({ cartoes_ok: `${done}${ack.ok && ack.registada ? " Registada a confirmação deste texto." : ""}` }, to, q, s.id);
}

// "Guardar e aprovar", "Guardar e aprovar de novo" e "Guardar e confirmar que continua certa", no mesmo formulário das
// correções: guarda primeiro o que estiver nos campos e só depois aprova (ou regista a revisão). Não aprova um texto com
// dados pessoais nem um texto que o Super Admin não confirmou (ACK_LABEL, no mesmo formulário, em todos os cartões).
export async function saveAndApprove(form: FormData) {
  const viewer = await superViewer();
  const id = field(form, "id");
  const estado = estadoOf(form), q = queryOf(form);
  const values = cardValues(form);
  if (!id) back({ cartoes_erro: "Resposta não encontrada." }, estado, q);
  if (!isIntent(values.intent)) back({ cartoes_erro: "Escolha o tema." }, estado, q, id);
  let saved: Saved | null = null;
  let list: CardList | null = null;
  try {
    saved = await sessionRpc<Saved>(viewer.session, "ldo_support_knowledge_card_save", { p_id: id, p_values: values });
    list = await cardList(viewer, "aprovada");
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q, id);
  }
  const s = saved!;
  const not = `${s.alterada ? "Correções guardadas, mas a" : "A"} resposta não foi ${s.estado === "aprovada" ? "confirmada" : "aprovada"}`;
  const blocks = blocksOf(list!, values);
  if (blocks.length)
    back({ cartoes_erro: `${not}: o texto tem ${piiText(blocks)}. Corrija-o (${PII_HINT}) e volte a carregar no botão.` }, estado, q, id);
  let ack: Ack = { ok: true, registada: false };
  try {
    ack = await confirmText(viewer, form, id, values, list!, s);
  } catch (e) {
    back({ cartoes_erro: `${not}: ${userMessage(e)}` }, estado, q, id);
  }
  if (!ack.ok) back({ cartoes_erro: `${not}: ${ackText(ack)}` }, estado, q, id);
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_state", { p_id: id, p_estado: "aprovada" });
  } catch (e) {
    back({ cartoes_erro: `${s.alterada ? "Correções guardadas, mas " : ""}${userMessage(e)}` }, estado, q, id);
  }
  back({
    cartoes_ok: s.estado === "aprovada"
      ? s.alterada ? `Correções guardadas e revisão registada.${publishHint(s)}` : "Revisão registada."
      : `Resposta aprovada${s.alterada ? " com as correções" : ""}. Publique as alterações para a IA a usar.`,
  }, estado, q, id);
}

// Arquivar (sai logo da IA e das respostas automáticas).
export async function archiveCard(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form), q = queryOf(form);
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_state", { p_id: field(form, "id"), p_estado: "arquivada" });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q, field(form, "id"));
  }
  back({ cartoes_ok: "Resposta arquivada: a IA deixou de a usar." }, estado, q);
}

export async function mergeCard(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form), q = queryOf(form);
  const into = field(form, "into");
  if (!into) back({ cartoes_erro: "Escolha a resposta a que quer juntar esta." }, estado, q, field(form, "id"));
  let r: { estado: string; alterada: boolean; auto_retirada: boolean; avisos_cortados?: number } | null = null;
  try {
    r = await sessionRpc(viewer.session, "ldo_support_knowledge_card_merge", { p_id: field(form, "id"), p_into: into });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q, field(form, "id"));
  }
  const cut = r?.avisos_cortados ?? 0;
  // Volta ao separador da outra resposta (proposta ou aprovada), com ela aberta: é essa que se confirma de novo.
  back({
    cartoes_ok: `Respostas juntas: esta ficou arquivada${r?.alterada ? " e a pergunta passou a ser uma das formas da outra" : " (a pergunta já era uma das formas da outra)"}.`
      + " A confirmação da outra foi apagada: leia-a e confirme-a de novo antes de a aprovar ou publicar."
      + `${r?.alterada && r.estado === "aprovada" ? " Publique as alterações para a IA usar a nova versão." : ""}`
      + `${r?.auto_retirada ? " A outra deixou de estar marcada para respostas automáticas." : ""}`
      + `${cut ? ` ${cut === 1 ? "1 aviso não coube" : `${cut} avisos não couberam`} na outra resposta (fica com 30, as contradições primeiro).` : ""}`,
  }, CARD_ESTADOS.includes(r?.estado as CardEstado) ? r!.estado : estado, q, into);
}

// Publicar: nada é publicado enquanto uma resposta aprovada tiver dados pessoais ou o texto atual por confirmar (a BD
// volta a verificar a confirmação). A mensagem só tem contagens.
export async function publishCards(form: FormData) {
  const viewer = await superViewer();
  const estado = estadoOf(form), q = queryOf(form);
  let blocked: string[] = [];
  let unconfirmed: string[] = [];
  try {
    const list = await cardList(viewer, "aprovada");
    blocked = list.cards.filter((c) => c.por_publicar && blocksOf(list, c).length).map((c) => c.id);
    unconfirmed = list.cards.filter((c) => !blocked.includes(c.id) && needsConfirmation(c, allowOf(list), list.staff_names || [])).map((c) => c.id);
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  const n = (l: string[]) => (l.length === 1 ? "uma resposta aprovada tem" : `${l.length} respostas aprovadas têm`);
  if (blocked.length || unconfirmed.length)
    back({
      cartoes_erro: `Nada foi publicado: ${[
        blocked.length ? `${n(blocked)} dados pessoais; corrija-as nas Aprovadas (${PII_HINT})` : "",
        unconfirmed.length ? `${n(unconfirmed)} o texto por confirmar; leia-as e confirme-as nas Aprovadas` : "",
      ].filter(Boolean).join("; ")}.`,
    }, "aprovada", q, blocked[0] || unconfirmed[0]);
  let r: { alteradas: number; em_uso: number } | null = null;
  try {
    r = await sessionRpc<{ alteradas: number; em_uso: number }>(viewer.session, "ldo_support_knowledge_publish");
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, estado, q);
  }
  back({ cartoes_ok: `Publicadas ${r?.alteradas ?? 0} alteração(ões). A IA usa agora ${r?.em_uso ?? 0} resposta(s) aprovada(s).` }, estado, q);
}

// "Permitir em respostas automáticas" (só marca o cartão para o futuro; nada é enviado). O texto é verificado aqui
// (também dados pessoais e a confirmação do texto atual); o resto também na BD. Os motivos ficam no cartão.
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
      back({ cartoes_erro: userMessage(e) }, "aprovada", q, id);
    }
    const card = list?.cards.find((c) => c.id === id);
    if (!list || !card) back({ cartoes_erro: "Resposta não encontrada entre as aprovadas." }, "aprovada", q);
    const store = list!.stores.find((s) => s.id === card!.loja_id);
    const blockers = autoOkBlockers(card!, {
      now: new Date(), knowledge: knowledgeOf(list!), others: list!.targets, allow: allowOf(list!), staffNames: list!.staff_names || [],
      storeNames: store ? storeKeywords(store.name, list!.stores.map((s) => s.name)) : [],
    });
    if (blockers.length)
      back({ cartoes_erro: `Ainda não pode ser usada em respostas automáticas (${blockers.length === 1 ? "1 motivo" : `${blockers.length} motivos`}): veja-os no cartão.` },
        "aprovada", q, id);
  }
  try {
    await sessionRpc(viewer.session, "ldo_support_knowledge_card_auto", { p_id: id, p_auto_ok: on });
  } catch (e) {
    back({ cartoes_erro: userMessage(e) }, "aprovada", q, id);
  }
  back({
    cartoes_ok: on
      ? "Marcada para respostas automáticas. Nada é enviado aos clientes enquanto as respostas automáticas não existirem e não forem ligadas."
      : "Deixou de estar marcada para respostas automáticas.",
  }, "aprovada", q, id);
}
