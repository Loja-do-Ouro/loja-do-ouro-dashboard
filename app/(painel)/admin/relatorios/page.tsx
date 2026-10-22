import Link from "next/link";
import { redirect } from "next/navigation";
import { emailConfigured, emailFrom } from "@/lib/email";
import { homePath } from "@/lib/permissions";
import { baseUrl, buildMissingAlert, buildReport, renderMissingAlert, renderReport, reportsConfigured, type ReportKind } from "@/lib/reports";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { sendNow } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Relatórios por email · Loja do Ouro" };

type Log = { id: string; kind: string; period_from: string | null; period_to: string | null; recipients: string[]; status: string; detail: string | null; created_at: string };
type User = { id: string; username: string; full_name: string | null; is_super_admin: boolean; active: boolean; email: string | null; receive_reports: boolean };

const VIEWS = [
  ["daily", "Diário", "Todos os dias às 8h30 (dia anterior)"],
  ["weekly", "Semanal", "Segundas-feiras às 8h30 (semana anterior)"],
  ["monthly", "Mensal", "Dia 1 às 8h30 (mês anterior)"],
  ["alert", "Alerta de lojas sem dados", "Todos os dias às 22h00, só se faltar alguma loja"],
] as const;
const KIND_LABEL: Record<string, string> = { daily: "Diário", weekly: "Semanal", monthly: "Mensal", alert: "Alerta" };
const STATUS: Record<string, [string, string]> = { sent: ["Enviado", "ok"], skipped: ["Não enviado", ""], failed: ["Falhou", "warn"], preview: ["Pré-visualização", ""] };

export default async function ReportsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const view = VIEWS.find(([k]) => k === q.ver)?.[0] ?? "daily";
  const [users, log] = await Promise.all([
    rpc<User[]>("ldo_list_users", { p_session: viewer.session }),
    rpc<Log[]>("ldo_list_report_log", { p_session: viewer.session }).catch(() => [] as Log[]),
  ]);
  const supers = users.filter((u) => u.is_super_admin && u.active);
  const recipients = supers.filter((u) => u.email && u.receive_reports);
  const me = users.find((u) => u.id === viewer.id);
  const ready = reportsConfigured();
  let preview = "";
  let subject = "";
  let previewError = "";
  if (ready)
    try {
      const out = view === "alert" ? renderMissingAlert(await buildMissingAlert(), baseUrl()) : renderReport(await buildReport(view as ReportKind), baseUrl());
      preview = out.html;
      subject = out.subject;
    } catch (e) {
      previewError = userMessage(e);
    }
  const ok = q.ok === "sent" ? "Email enviado. Pode demorar um ou dois minutos a chegar." : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  const testDomain = emailFrom().includes("resend.dev");

  return (
    <AppShell viewer={viewer} current="relatorios" title="Relatórios por email">
      <PageHeading eyebrow="ADMINISTRAÇÃO" title="Relatórios por email" text="Resumos automáticos da loja online e das lojas físicas, com o ranking das lojas, enviados aos Super Admins." />
      <Flash ok={ok} error={error} />
      <div className="report-status">
        <article className={emailConfigured() ? "status-card ok" : "status-card warn"}>
          <span>Envio de email (Resend)</span>
          <strong>{emailConfigured() ? "Configurado" : "Por configurar"}</strong>
          <small>{emailConfigured() ? `Remetente: ${emailFrom()}` : "Falta a variável RESEND_API_KEY no Vercel."}</small>
        </article>
        <article className={ready ? "status-card ok" : "status-card warn"}>
          <span>Acesso aos dados</span>
          <strong>{ready ? "Configurado" : "Por configurar"}</strong>
          <small>{ready ? "REPORTS_TOKEN definido." : "Falta a variável REPORTS_TOKEN no Vercel."}</small>
        </article>
        <article className={recipients.length ? "status-card ok" : "status-card warn"}>
          <span>Destinatários</span>
          <strong>{recipients.length} {recipients.length === 1 ? "Super Admin" : "Super Admins"}</strong>
          <small>{recipients.length ? recipients.map((u) => u.email).join(", ") : "Nenhum Super Admin com email e relatórios ativos."}</small>
        </article>
      </div>
      {emailConfigured() && testDomain && (
        <div role="status" className="notice">
          <span>
            O domínio ainda não está verificado no Resend: com o remetente de teste (onboarding@resend.dev) os emails só chegam ao endereço da própria conta Resend. Depois de verificar lojadoouro.pt, defina REPORTS_FROM no Vercel (ex.: “Loja do Ouro &lt;relatorios@lojadoouro.pt&gt;”).
          </span>
        </div>
      )}
      <div className="two-col admin-layout report-layout">
        <Panel title="Pré-visualização" eyebrow="EMAIL" note={subject ? `Assunto: ${subject}` : undefined}>
          <nav className="chips" aria-label="Tipo de relatório">
            {VIEWS.map(([k, l]) => (
              <Link key={k} className={view === k ? "chip active" : "chip"} href={`/admin/relatorios?ver=${k}`}>{l}</Link>
            ))}
          </nav>
          <p className="field-help">{VIEWS.find(([k]) => k === view)?.[2]} (hora de Portugal, aproximada).</p>
          {preview ? (
            <iframe className="email-preview" title="Pré-visualização do email" srcDoc={preview} sandbox="" />
          ) : (
            <p className="muted">{previewError || "Configure REPORTS_TOKEN para pré-visualizar."}</p>
          )}
        </Panel>
        <div className="stack">
          <Panel title="Enviar agora" eyebrow="TESTE">
            <form action={sendNow} className="form-grid">
              <input type="hidden" name="kind" value={view} />
              <p className="field-help wide">Envia o email que está a ver ({VIEWS.find(([k]) => k === view)?.[1].toLowerCase()}).</p>
              <div className="wide form-actions">
                <button type="submit" name="to" value="me" disabled={!me?.email}>Enviar só para mim</button>
                <button type="submit" name="to" value="all" className="secondary-button" disabled={!recipients.length}>Enviar a todos os Super Admins</button>
              </div>
              {!me?.email && <small className="wide">Preencha o seu email em <Link href={`/admin/utilizadores?id=${viewer.id}`}>Utilizadores</Link>.</small>}
            </form>
          </Panel>
          <Panel title="Super Admins" eyebrow="QUEM RECEBE" note="O email e a opção de receber relatórios editam-se em Utilizadores.">
            <ul className="plain-list">
              {supers.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/utilizadores?id=${u.id}`}>{u.full_name || u.username}</Link>
                  <small className="muted block">{u.email ? `${u.email} · ${u.receive_reports ? "recebe" : "não recebe"}` : "sem email"}</small>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
      <Panel title="Últimos envios" eyebrow="REGISTO">
        <div className="table-scroll" tabIndex={0} aria-label="Registo de envios">
          <table className="left-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Período</th>
                <th>Estado</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {log.length ? (
                log.map((l) => (
                  <tr key={l.id}>
                    <td>{timestamp(l.created_at)}</td>
                    <td>{KIND_LABEL[l.kind] || l.kind}</td>
                    <td>{l.period_from ? (l.period_from === l.period_to ? l.period_from : `${l.period_from} – ${l.period_to}`) : "—"}</td>
                    <td><span className={`pill ${STATUS[l.status]?.[1] || ""}`}>{STATUS[l.status]?.[0] || l.status}</span></td>
                    <td>
                      {l.detail || "—"}
                      {l.recipients?.length ? <small className="muted block">{l.recipients.join(", ")}</small> : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="muted">Ainda não houve envios.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
