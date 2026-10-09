import "server-only";
import { dashboardUrl as baseUrl, sendEmail } from "@/lib/email";
import { brandEmail, emailParagraph, esc } from "@/lib/email-layout";
import { serverRpc } from "./db";
import { CHANNEL_LABEL } from "./rules";
import type { Handover } from "./service";

// Remetente dos emails do Apoio ao Cliente (clientes do chat e avisos à equipa). O domínio lojadoouro.pt
// está verificado no Resend; as respostas vão para a caixa do apoio (SITE_CHAT_REPLY_TO).
export function supportEmailFrom() {
  return process.env.SUPPORT_EMAIL_FROM || process.env.SITE_CHAT_FROM || "Loja do Ouro <apoiocliente@lojadoouro.pt>";
}
export function supportReplyTo() {
  return process.env.SITE_CHAT_REPLY_TO || "apoiocliente@lojadoouro.pt";
}

type Staff = { email: string | null; name: string; first_name: string | null } | null;

// Aviso ao colega que passou a ser responsável por uma conversa. Sem email na ficha do colaborador
// (Administração → Utilizadores) não há aviso; a conversa aparece na mesma em "Minhas".
export async function notifyHandover(h: Handover) {
  const staff = await serverRpc<Staff>("ldo_support_staff_contact", { p_user: h.target }).catch(() => null);
  if (!staff?.email) return { ok: false, detail: "Colaborador sem email." };
  const base = baseUrl();
  const link = `${base}/apoio?conversa=${encodeURIComponent(h.conversationId)}`;
  const hello = staff.first_name || staff.name;
  const channel = CHANNEL_LABEL[h.channel] || h.channel;
  const html = brandEmail({
    baseUrl: base,
    eyebrow: "Apoio ao Cliente",
    title: "Conversa transferida para si",
    preheader: `${h.actor} passou-lhe a conversa com ${h.contact}.`,
    body:
      emailParagraph(`Olá ${esc(hello)},`) +
      emailParagraph(`<strong>${esc(h.actor)}</strong> passou-lhe a conversa com <strong>${esc(h.contact)}</strong> (${esc(channel)}).`) +
      emailParagraph("A partir de agora é responsável por esta conversa e é a única pessoa que pode responder ao cliente. Se precisar, pode transferi-la de novo no separador Cliente → Atendimento."),
    button: { label: "Abrir a conversa", url: link },
    footer: "Aviso automático do Apoio ao Cliente · Loja do Ouro",
  });
  const text = `Olá ${hello},\n\n${h.actor} passou-lhe a conversa com ${h.contact} (${channel}). A partir de agora é responsável por esta conversa e é a única pessoa que pode responder ao cliente.\n\nAbrir a conversa: ${link}\n\nAviso automático do Apoio ao Cliente · Loja do Ouro`;
  return sendEmail([staff.email], `Conversa transferida para si: ${h.contact}`.slice(0, 150), html, { from: supportEmailFrom(), text, timeoutMs: 8000 });
}
