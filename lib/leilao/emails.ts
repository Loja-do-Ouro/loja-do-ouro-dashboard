import "server-only";
import { dashboardUrl, emailConfigured, sendEmail } from "@/lib/email";
import { brandEmail, emailParagraph, esc } from "@/lib/email-layout";
import { outboxEmail, type EmailText, type OutboxItem } from "@/lib/leilao-site-rules";
import { serverConfigured, serverRpc } from "@/lib/support/db";
import { siteUrl } from "./site";

// Emails do leilão (Resend): confirmação do email e recuperação da palavra-passe, na hora; e a fila da BD
// (ldo_auc_outbox: ultrapassado, prolongado, a terminar, ganhou, perdeu, reserva, retirado), enviada na verificação
// automática de 5 em 5 minutos (app/api/support/webhooks/tick) e logo depois de cada licitação. Nunca lançam erros.

const GAP_MS = 600;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function auctionFrom() {
  return process.env.LEILAO_FROM || "Leilão Loja do Ouro <leilao@lojadoouro.pt>";
}
const replyTo = () => process.env.LEILAO_REPLY_TO || "apoiocliente@lojadoouro.pt";

const FOOTER = "Leilão Loja do Ouro · peças da nossa coleção, sem comissão do comprador";

function render(t: EmailText) {
  const body = t.paragraphs.map((p) => emailParagraph(esc(p))).join("");
  return brandEmail({ baseUrl: dashboardUrl(), eyebrow: t.eyebrow, title: t.title, preheader: t.paragraphs[1], body, button: t.button ?? undefined, footer: FOOTER });
}
const plain = (t: EmailText) => [...t.paragraphs, ...(t.button ? [`${t.button.label}: ${t.button.url}`] : [])].join("\n\n");

async function send(to: string, t: EmailText) {
  return sendEmail([to], t.subject, render(t), { from: auctionFrom(), replyTo: replyTo(), text: plain(t) });
}

export async function sendVerifyEmail(to: string, name: string, token: string) {
  const url = `${siteUrl()}/conta/confirmar?t=${token}`;
  return send(to, {
    subject: "Confirme o seu email · Leilão Loja do Ouro", eyebrow: "LEILÃO · CONTA", title: "Confirme o seu email",
    paragraphs: [`Olá ${name || "cliente"},`, "Obrigado por se registar no leilão da Loja do Ouro. Confirme o seu email para poder licitar.",
      "A ligação é válida durante 48 horas. Se não foi você, ignore este email: a conta não fica ativa."],
    button: { label: "Confirmar email", url },
  });
}

export async function sendResetEmail(to: string, name: string, token: string) {
  const url = `${siteUrl()}/conta/nova-palavra-passe?t=${token}`;
  return send(to, {
    subject: "Nova palavra-passe · Leilão Loja do Ouro", eyebrow: "LEILÃO · CONTA", title: "Escolha uma nova palavra-passe",
    paragraphs: [`Olá ${name || "cliente"},`, "Recebemos um pedido para mudar a palavra-passe da sua conta do leilão.",
      "A ligação é válida durante 2 horas e só pode ser usada uma vez. Se não foi você, ignore este email: nada muda."],
    button: { label: "Escolher palavra-passe", url },
  });
}

// Declaração de livre resolução: cópia para o cliente (prova em suporte duradouro) e para a equipa.
export async function sendWithdrawalEmails(d: { name: string; email: string; lot: string; received: string; message: string; contact: string }) {
  const lines = [`Nome: ${d.name}`, `Email: ${d.email}`, `Lote / peça: ${d.lot}`, `Data da receção: ${d.received || "—"}`,
    ...(d.message ? [`Mensagem: ${d.message}`] : []), `Enviada a: ${new Date().toISOString()}`];
  const team = await sendEmail([d.contact], `Livre resolução: ${d.lot}`.slice(0, 150), render({
    subject: "", eyebrow: "LEILÃO · LIVRE RESOLUÇÃO", title: "Declaração de livre resolução recebida",
    paragraphs: ["Um cliente usou o formulário de livre resolução do site do leilão. Responda em 14 dias e reembolse no mesmo prazo.", ...lines],
    button: null,
  }), { from: auctionFrom(), replyTo: d.email });
  const customer = await send(d.email, {
    subject: "Recebemos a sua declaração de livre resolução", eyebrow: "LEILÃO · LIVRE RESOLUÇÃO", title: "Declaração recebida",
    paragraphs: [`Olá ${d.name},`, "Confirmamos a receção da sua declaração de livre resolução, com os dados abaixo. Vamos contactá-lo para combinar a devolução da peça; o reembolso é feito no prazo de 14 dias.", ...lines],
    button: null,
  });
  return team.ok && customer.ok;
}

// ---------------------------------------------------------------- fila

export async function sendAuctionOutbox({ budgetMs = 25_000 } = {}) {
  if (!serverConfigured() || !emailConfigured()) return 0;
  const until = Date.now() + budgetMs;
  const base = siteUrl();
  let sent = 0;
  try {
    while (Date.now() < until) {
      const items = (await serverRpc<OutboxItem[]>("ldo_auc_outbox_claim", { p_limit: 20 })) || [];
      for (const item of items) {
        const done = (ok: boolean, detail: string) =>
          serverRpc("ldo_auc_outbox_done", { p_id: item.id, p_lease: item.lease, p_ok: ok, p_detail: detail }).catch(() => undefined);
        const t = item.deleted ? null : outboxEmail(item, base);
        if (!t) {
          await done(true, item.deleted ? "Conta apagada: não enviado." : "Sem lote: não enviado.");
          continue;
        }
        if (sent) await pause(GAP_MS);
        const r = await send(item.email, t);
        // Resend a pedir para esperar: os reservados voltam à fila quando a reserva acaba (2 minutos).
        if (r.status === 429) return sent;
        await done(r.ok, r.detail);
        sent++;
        if (Date.now() >= until) return sent;
      }
      if (items.length < 20) break;
    }
  } catch (e) {
    console.error("leilao outbox", e instanceof Error ? e.message : e);
  }
  return sent;
}
