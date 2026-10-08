import "server-only";
import { emailFrom, sendEmail } from "@/lib/email";
import { baseUrl } from "@/lib/reports";
import { serverRpc } from "./db";
import { CHANNEL_LABEL } from "./rules";
import type { Handover } from "./service";

// Remetente dos emails do Apoio ao Cliente (clientes do chat e avisos à equipa). Enquanto o domínio
// lojadoouro.pt não estiver verificado no Resend, os emails só chegam à conta do próprio Resend.
export function supportEmailFrom() {
  return process.env.SUPPORT_EMAIL_FROM || process.env.SITE_CHAT_FROM || emailFrom();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Staff = { email: string | null; name: string; first_name: string | null } | null;

// Aviso ao colega que passou a ser responsável por uma conversa. Sem email na ficha do colaborador
// (Administração → Utilizadores) não há aviso; a conversa aparece na mesma em "Minhas".
export async function notifyHandover(h: Handover) {
  const staff = await serverRpc<Staff>("ldo_support_staff_contact", { p_user: h.target }).catch(() => null);
  if (!staff?.email) return { ok: false, detail: "Colaborador sem email." };
  const link = `${baseUrl()}/apoio?conversa=${encodeURIComponent(h.conversationId)}`;
  const hello = staff.first_name || staff.name;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#253531;max-width:560px">
<p>Olá ${esc(hello)},</p>
<p><strong>${esc(h.actor)}</strong> passou-lhe a conversa com <strong>${esc(h.contact)}</strong> (${esc(CHANNEL_LABEL[h.channel] || h.channel)}).
A partir de agora é responsável por esta conversa e é a única pessoa que pode responder ao cliente.</p>
<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#a47a37;color:#fff;text-decoration:none;border-radius:6px">Abrir a conversa</a></p>
<p style="color:#78807c;font-size:13px">Aviso automático do Apoio ao Cliente da Loja do Ouro.</p>
</div>`;
  return sendEmail([staff.email], `Conversa transferida para si: ${h.contact}`.slice(0, 150), html, { from: supportEmailFrom(), timeoutMs: 8000 });
}
