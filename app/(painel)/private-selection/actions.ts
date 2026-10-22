"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { canManagePrivateSelection, homePath } from "@/lib/permissions";
import { psAdd, psBlockedResolve, psKlaviyoRetry, psRemove, psResend, psSetMemberCode, psSetPassword, psSetSettings } from "@/lib/private-selection/db";
import { sweepPrivateSelection } from "@/lib/private-selection/send";
import {
  cleanEmail, isBrand, isLocale, normalizePhone, parseMemberCode, PS_PASSWORD_MAX, PS_PASSWORD_MIN, validPassword,
} from "@/lib/private-selection-rules";
import { userMessage } from "@/lib/supabase";
import { encryptionProblem } from "@/lib/support/crypto";
import { requireViewer } from "@/lib/viewer";

// Private Selection: Super Admin e Loja Online (verificado aqui e nas funções da BD, ldo_private.ps_admin).
async function adminViewer() {
  const viewer = await requireViewer();
  if (!canManagePrivateSelection(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  return viewer;
}

// Volta à lista que estava aberta (ver=removidos). O endereço nunca leva o nome, o email, o telemóvel nem a senha:
// fica no histórico do browser e nos registos da Vercel.
function back(form: FormData, params: Record<string, string>): never {
  redirect(`/private-selection?${new URLSearchParams({ ...(form.get("ver") === "removidos" ? { ver: "removidos" } : {}), ...params })}`);
}

// O email com a senha e a Klaviyo saem logo depois da resposta; a verificação de 5 em 5 minutos trata do resto.
const sweep = () => after(() => sweepPrivateSelection().catch(() => undefined));

// "Adicionar pessoa" (ou "Adicionar de novo" um removido): o email com a senha sai já. Um email que já seja de um
// membro ativo fica com os dados indicados e volta a receber a senha.
export async function addMember(form: FormData) {
  const viewer = await adminViewer();
  const name = String(form.get("name") || "").replace(/\s+/g, " ").trim();
  const email = cleanEmail(form.get("email"));
  const locale = form.get("locale");
  const brand = form.get("brand");
  // Como no formulário da loja: na Loja do Ouro (português e Portugal) um número sem indicativo é português.
  const phone = normalizePhone(form.get("phone"), brand === "ldo" ? "+351" : undefined);
  let error = "";
  let reactivated = false;
  if (!name) error = "Indique o nome.";
  else if (!email) error = "Indique um email válido.";
  else if (!phone) error = "Indique o telemóvel com o indicativo do país (ex.: +351 912 345 678).";
  else if (!isLocale(locale) || !isBrand(brand)) error = "Escolha a língua e a marca.";
  else
    try {
      reactivated = (await psAdd(viewer.session, { name, email, phone, locale, brand })).reactivated;
    } catch (e) {
      error = userMessage(e);
    }
  // Com erro, quem veio de "Adicionar de novo" continua com o formulário preenchido (pelo id, nunca pelos dados).
  const id = String(form.get("id") || "");
  if (error) back(form, { ...(/^[0-9a-f-]{36}$/i.test(id) ? { id } : {}), erro: error });
  sweep();
  redirect(`/private-selection?${new URLSearchParams({ ok: reactivated ? "readded" : "added" })}`);
}

// Pedido bloqueado (pessoa removida que pediu de novo): "Aceitar" torna-a membro e envia a senha já; "Ignorar" tira o
// pedido da lista sem email.
export async function resolveBlocked(form: FormData) {
  const viewer = await adminViewer();
  const accept = form.get("decision") === "accept";
  try {
    await psBlockedResolve(viewer.session, String(form.get("id") || ""), accept);
  } catch (e) {
    back(form, { erro: userMessage(e) });
  }
  if (accept) sweep();
  back(form, { ok: accept ? "blocked_accepted" : "blocked_dismissed" });
}

// "Reenviar": o email com a senha volta a sair já (só membros ativos; as tentativas recomeçam).
export async function resendEmail(form: FormData) {
  const viewer = await adminViewer();
  try {
    await psResend(viewer.session, String(form.get("id") || ""));
  } catch (e) {
    back(form, { erro: userMessage(e) });
  }
  sweep();
  back(form, { ok: "resent" });
}

// "Tentar de novo" na Klaviyo, parada depois de 5 falhas (ex.: chave sem acesso às listas): a ação pendente volta à
// fila sem mexer no membro, por isso também tira da lista quem já foi removido.
export async function retryKlaviyo(form: FormData) {
  const viewer = await adminViewer();
  try {
    await psKlaviyoRetry(viewer.session, String(form.get("id") || ""));
  } catch (e) {
    back(form, { erro: userMessage(e) });
  }
  sweep();
  back(form, { ok: "klaviyo" });
}

// "Remover" é uma marca: termina as sessões da loja, cancela o email por enviar e tira da lista da Klaviyo.
export async function removeMember(form: FormData) {
  const viewer = await adminViewer();
  if (form.get("confirm") !== "on") back(form, { erro: "Confirme antes de remover." });
  try {
    await psRemove(viewer.session, String(form.get("id") || ""));
  } catch (e) {
    back(form, { erro: userMessage(e) });
  }
  sweep();
  back(form, { ok: "removed" });
}

// Senha partilhada: cifrada aqui no servidor (psSetPassword, contexto "private-selection:password") antes de ir para
// a BD, que guarda o bcrypt e termina todas as sessões da loja. Nunca volta ao browser, nem no endereço.
export async function savePassword(form: FormData) {
  const viewer = await adminViewer();
  const password = String(form.get("password") || "");
  const notifyAll = form.get("notify_all") === "on";
  const keyProblem = encryptionProblem();
  let error = "";
  if (password !== String(form.get("confirm_password") || "")) error = "As duas senhas não coincidem.";
  else if (!validPassword(password)) error = `A senha tem de ter de ${PS_PASSWORD_MIN} a ${PS_PASSWORD_MAX} caracteres, sem espaços no início nem no fim.`;
  else if (keyProblem) error = `A senha não foi guardada: ${keyProblem}`;
  else
    try {
      await psSetPassword(viewer.session, password, notifyAll);
    } catch (e) {
      error = userMessage(e);
    }
  if (error) back(form, { erro: error });
  if (notifyAll) sweep();
  back(form, { ok: notifyAll ? "password_sent" : "password" });
}

// Página da Private Selection na loja (botão do email). Aceita o link completo copiado da loja: fica só o caminho.
export async function saveEntryPath(form: FormData) {
  const viewer = await adminViewer();
  let path = String(form.get("entry_path") || "").trim();
  if (/^https?:\/\//i.test(path))
    try {
      const url = new URL(path);
      path = `${url.pathname}${url.search}`;
    } catch {
      // Link inválido: a BD recusa-o com a mensagem habitual.
    }
  try {
    await psSetSettings(viewer.session, path);
  } catch (e) {
    back(form, { erro: userMessage(e) });
  }
  back(form, { ok: "settings" });
}

// Código de membro (o código de desconto da Shopify que a página reservada aplica sem o mostrar). A mesma regra da
// BD (parseMemberCode). Aqui só se guarda um código: retirá-lo é a ação seguinte, com confirmação. O código nunca vai
// no endereço (nem nas mensagens de erro).
export async function saveMemberCode(form: FormData) {
  const viewer = await adminViewer();
  const parsed = parseMemberCode(form.get("member_code"));
  if (!parsed.ok) back(form, { erro: parsed.error });
  if (!parsed.code) back(form, { erro: "Indique o código. Para deixar de aplicar o desconto, use «Retirar o código»." });
  try {
    await psSetMemberCode(viewer.session, parsed.code);
  } catch (e) {
    back(form, { erro: userMessage(e) });
  }
  back(form, { ok: "code" });
}

// "Retirar o código": a página deixa de aplicar o desconto (o código continua na Shopify até ser desativado lá).
export async function clearMemberCode(form: FormData) {
  const viewer = await adminViewer();
  if (form.get("confirm") !== "on") back(form, { erro: "Confirme antes de retirar o código." });
  try {
    await psSetMemberCode(viewer.session, null);
  } catch (e) {
    back(form, { erro: userMessage(e) });
  }
  back(form, { ok: "code_cleared" });
}
