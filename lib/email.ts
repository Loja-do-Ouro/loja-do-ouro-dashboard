import "server-only";

// Sends through Resend (https://resend.com) with RESEND_API_KEY. The lojadoouro.pt
// domain is verified in Resend (DKIM resend._domainkey and send.lojadoouro.pt in
// Cloudflare), so any @lojadoouro.pt sender works. REPORTS_FROM overrides the default.
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom() {
  return process.env.REPORTS_FROM || "Loja do Ouro <relatorios@lojadoouro.pt>";
}

// Endereço público do dashboard (ligações e logótipo dos emails).
export function dashboardUrl() {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://loja-do-ouro-dashboard.vercel.app";
}

export async function sendEmail(
  to: string[], subject: string, html: string,
  opts: { from?: string; replyTo?: string; timeoutMs?: number; text?: string } = {},
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
      body: JSON.stringify({
        from: opts.from || emailFrom(), to, subject, html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    return r.ok ? { ok: true, detail: body.id || "enviado" } : { ok: false, detail: body.message || `Resend recusou (${r.status}).` };
  } catch {
    return { ok: false, detail: "Resend indisponível." };
  }
}
