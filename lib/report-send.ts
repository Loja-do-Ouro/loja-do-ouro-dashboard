import "server-only";
import { emailConfigured, sendEmail } from "./email";
import { baseUrl, buildMissingAlert, buildReport, logReport, renderMissingAlert, renderReport, type ReportKind } from "./reports";

// Builds, sends and logs a report. "only" sends to those addresses instead of the Super Admins.
export async function sendReport(kind: ReportKind, only?: string[]) {
  const report = await buildReport(kind);
  const { subject, html } = renderReport(report, baseUrl());
  const to = only || report.recipients.map((r) => r.email);
  if (!emailConfigured()) {
    await logReport(kind, report.range, to, "skipped", "RESEND_API_KEY por configurar.");
    return { kind, status: "skipped" as const, detail: "RESEND_API_KEY por configurar." };
  }
  const sent = await sendEmail(to, subject, html);
  await logReport(kind, report.range, to, sent.ok ? "sent" : "failed", sent.detail);
  return { kind, status: sent.ok ? ("sent" as const) : ("failed" as const), detail: sent.detail };
}

export async function sendMissingAlert(only?: string[]) {
  const alert = await buildMissingAlert();
  const period = { from: alert.day, to: alert.day };
  const to = only || alert.recipients.map((r) => r.email);
  // Nothing to warn about: no email, only a line in the log.
  if (!alert.missing.length && !only) {
    await logReport("alert", period, [], "skipped", "Todas as lojas registaram dados.");
    return { kind: "alert", status: "skipped" as const, detail: "Todas as lojas registaram dados." };
  }
  if (!emailConfigured()) {
    await logReport("alert", period, to, "skipped", "RESEND_API_KEY por configurar.");
    return { kind: "alert", status: "skipped" as const, detail: "RESEND_API_KEY por configurar." };
  }
  const { subject, html } = renderMissingAlert(alert, baseUrl());
  const sent = await sendEmail(to, subject, html);
  await logReport("alert", period, to, sent.ok ? "sent" : "failed", `${alert.missing.map((s) => s.name).join(", ") || "sem falhas"} · ${sent.detail}`);
  return { kind: "alert", status: sent.ok ? ("sent" as const) : ("failed" as const), detail: sent.detail };
}

