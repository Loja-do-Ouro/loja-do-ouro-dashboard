import "server-only";

// Sends through Resend (https://resend.com) with RESEND_API_KEY. Until the
// lojadoouro.pt domain is verified there, Resend only delivers mail sent from
// onboarding@resend.dev to the address of the Resend account itself.
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom() {
  return process.env.REPORTS_FROM || "Loja do Ouro <onboarding@resend.dev>";
}

export async function sendEmail(
  to: string[], subject: string, html: string,
  opts: { from?: string; replyTo?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, detail: "RESEND_API_KEY por configurar." };
  if (!to.length) return { ok: false, detail: "Sem destinatários (Super Admins com email e relatórios ativos)." };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: opts.from || emailFrom(), to, subject, html, ...(opts.replyTo ? { reply_to: opts.replyTo } : {}) }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    return r.ok ? { ok: true, detail: body.id || "enviado" } : { ok: false, detail: body.message || `Resend recusou (${r.status}).` };
  } catch {
    return { ok: false, detail: "Resend indisponível." };
  }
}
