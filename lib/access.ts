import "server-only";
import { accessEmail, accessLink } from "./access-email";
import { dashboardUrl, emailConfigured, sendEmail } from "./email";
import { rpc, userMessage } from "./supabase";

type Created = { token: string; email: string; username: string; full_name: string | null; expires_at: string; reply_to: string | null };

// Remetente dos acessos (qualquer endereço @lojadoouro.pt serve: o domínio está verificado no Resend).
function accessFrom() {
  return process.env.ACCESS_FROM || "Loja do Ouro <acessos@lojadoouro.pt>";
}

// Cria o link na base de dados (só Super Admin; anula os anteriores) e envia-o à pessoa pelo Resend. O token só
// passa por aqui para entrar no email: não é guardado nem registado. As respostas ao email vão para quem o enviou.
export async function sendAccess(session: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!emailConfigured()) return { ok: false, error: "O envio de emails não está configurado no servidor." };
  let link: Created;
  try {
    link = await rpc<Created>("ldo_create_access", { p_session: session, p_user_id: userId });
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
  const base = dashboardUrl();
  const mail = accessEmail({
    baseUrl: base, link: accessLink(base, link.token), username: link.username, fullName: link.full_name, expiresAt: link.expires_at,
  });
  const sent = await sendEmail([link.email], mail.subject, mail.html, {
    from: accessFrom(), text: mail.text, ...(link.reply_to ? { replyTo: link.reply_to } : {}),
  });
  if (sent.ok) return { ok: true };
  // O link não chegou a ninguém: fica anulado, para a lista não o mostrar como enviado.
  await rpc("ldo_cancel_access", { p_session: session, p_user_id: userId }).catch(() => undefined);
  return { ok: false, error: `O email não foi enviado (${sent.detail}).` };
}
