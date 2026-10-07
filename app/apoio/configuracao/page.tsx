import Link from "next/link";
import { redirect } from "next/navigation";
import { metricoolConfigured } from "@/lib/bi/metricool";
import { homePath } from "@/lib/permissions";
import { encryptionProblem } from "@/lib/support/crypto";
import { serverConfigured, sessionRpc } from "@/lib/support/db";
import { metricoolDiagnostics } from "@/lib/support/metricool";
import { WHATSAPP_STATUS } from "@/lib/support/whatsapp";
import { redirectUri, ZENDESK_SCOPES, zendeskDiagnostics, zendeskReadiness } from "@/lib/support/zendesk";
import { requireViewer } from "@/lib/viewer";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { disconnectZendesk, savePolling, setSupportAccess, syncNow } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Configuração do apoio · Loja do Ouro" };

type State = {
  settings: { poll_seconds: number; zendesk_subdomain: string };
  sources: { id: string; label: string; platform: string; status: string; status_detail: string | null; failures: number; last_attempt_at: string | null; last_success_at: string | null; next_attempt_at: string | null; last_error: string | null; config: Record<string, unknown> }[];
  connections: { user_id: string; name: string; zendesk_name: string | null; zendesk_email: string | null; zendesk_role: string | null; scope: string | null; status: string; status_detail: string | null; access_expires_at: string | null; refresh_expires_at: string | null; connected_at: string; updated_at: string }[];
  users: { id: string; name: string; username: string; support_access: boolean; is_super_admin: boolean }[];
  counts: { conversations: number; open: number };
  audit: { action: string; details: Record<string, unknown>; created_at: string; actor: string }[];
};

const STATUS: Record<string, [string, string]> = {
  active: ["Ativo", "ok"],
  pending: ["A aguardar", "warn"],
  error: ["Erro", "warn"],
  blocked: ["Bloqueado", "warn"],
  not_configured: ["Por configurar", ""],
};
const yes = (v: boolean) => (v ? <span className="pill ok">Configurado</span> : <span className="pill warn">Em falta</span>);

export default async function SupportConfigPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const state = await sessionRpc<State>(viewer.session, "ldo_support_admin_state");
  const z = zendeskReadiness();
  const diag = q.diagnostico === "1";
  const [zd, fb, ig] = diag
    ? await Promise.all([zendeskDiagnostics(), metricoolDiagnostics("FACEBOOK"), metricoolDiagnostics("INSTAGRAM")])
    : [null, null, null];
  // URL de produção estável a registar no Zendesk (o da preview só serve para testes).
  const productionCallback = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "loja-do-ouro-dashboard.vercel.app"}/api/support/zendesk/callback`;
  const thisCallback = redirectUri(`https://${process.env.VERCEL_URL || "localhost"}/`);

  return (
    <AppShell viewer={viewer} current="apoio-config" title="Configuração do apoio">
      <PageHeading eyebrow="APOIO AO CLIENTE" title="Configuração do apoio" text="Ligações às plataformas, sincronização e acessos. Só o Super Admin vê esta página.">
        <Link className="outline-button" href="/apoio/configuracao?diagnostico=1">Validar ligações</Link>
      </PageHeading>
      <Flash ok={typeof q.ok === "string" ? q.ok.slice(0, 200) : undefined} error={typeof q.erro === "string" ? q.erro.slice(0, 600) : undefined} />
      {!serverConfigured() && <div className="notice error-notice">O servidor não tem ligação ao Supabase (BI_INGEST_TOKEN): a sincronização não pode gravar.</div>}

      <div className="two-col">
        <Panel title="Zendesk" eyebrow="TICKETS">
          <dl className="config-list">
            <dt>Conta</dt><dd>{state.settings.zendesk_subdomain}.zendesk.com</dd>
            <dt>Cliente OAuth</dt><dd>{yes(z.client)} <small className="muted">ZENDESK_CLIENT_ID, ZENDESK_CLIENT_SECRET</small></dd>
            <dt>Cifra dos tokens</dt><dd>{yes(!encryptionProblem())} <small className="muted">{encryptionProblem() || "SUPPORT_ENCRYPTION_KEY"}</small></dd>
            <dt>Scopes pedidos</dt><dd><code>{ZENDESK_SCOPES}</code></dd>
            <dt>Redirect URL (produção)</dt><dd><code>{productionCallback}</code></dd>
            {process.env.VERCEL_ENV === "preview" && (<><dt>Redirect URL (esta preview)</dt><dd><code>{thisCallback}</code></dd></>)}
          </dl>
          <p className="panel-note">Cada colaboradora liga a sua própria conta de agente (botão “Ligar Zendesk” no Apoio ao Cliente). Respostas e notas saem com essa autoria; nenhuma resposta usa a conta do administrador por omissão. Uma resposta aceite pelo Zendesk só chega ao cliente se as notificações (triggers) do canal estiverem ativas.</p>
          <div className="table-scroll">
            <table className="left-table">
              <thead><tr><th>Colaborador</th><th>Conta Zendesk</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {state.connections.map((c) => (
                  <tr key={c.user_id}>
                    <td>{c.name}</td>
                    <td>{c.zendesk_name}<small className="muted block">{c.zendesk_email} · {c.zendesk_role}</small></td>
                    <td>
                      {c.status === "active" ? <span className="pill ok">Ligado</span> : <span className="pill warn">Voltar a ligar</span>}
                      <small className="muted block">Renovação até {timestamp(c.refresh_expires_at)}</small>
                      {c.status_detail && <small className="muted block">{c.status_detail}</small>}
                    </td>
                    <td>
                      <form action={disconnectZendesk}>
                        <input type="hidden" name="user_id" value={c.user_id} />
                        <button className="secondary-button" type="submit">Desligar</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!state.connections.length && <tr><td colSpan={4} className="muted">Nenhuma conta Zendesk ligada.</td></tr>}
              </tbody>
            </table>
          </div>
          {zd && <pre className="diag">{JSON.stringify(zd, null, 2)}</pre>}
        </Panel>

        <Panel title="Facebook e Instagram (Metricool)" eyebrow="MENSAGENS PRIVADAS">
          <dl className="config-list">
            <dt>Marca</dt><dd>Loja do Ouro Jericó · blogId {process.env.METRICOOL_BLOG_ID || "2912472"} · userId {process.env.METRICOOL_USER_ID || "2334170"}</dd>
            <dt>Token Metricool</dt><dd>{yes(metricoolConfigured())} <small className="muted">METRICOOL_USER_TOKEN (o mesmo das Redes sociais)</small></dd>
            <dt>Sincronização</dt><dd>Consulta periódica — a Inbox Metricool não tem webhooks.</dd>
            <dt>Anexos na resposta</dt><dd>Não nesta fase (só texto).</dd>
          </dl>
          {fb && <pre className="diag">{JSON.stringify(fb, null, 2)}</pre>}
          {ig && <pre className="diag">{JSON.stringify(ig, null, 2)}</pre>}
          <p className="panel-note">Comentários de publicações e de anúncios ficam fora desta fase. As respostas saem pela página/conta da marca; o dashboard regista quem as escreveu.</p>
        </Panel>
      </div>

      <div className="two-col">
        <Panel title="Sincronização" eyebrow="FONTES">
          <form action={savePolling} className="inline-form">
            <label>
              Frequência com o dashboard aberto (segundos)
              <input type="number" name="poll_seconds" min={30} max={3600} step={10} defaultValue={state.settings.poll_seconds} />
            </label>
            <button type="submit" className="secondary-button">Guardar</button>
          </form>
          <div className="table-scroll">
            <table className="left-table">
              <thead><tr><th>Fonte</th><th>Estado</th><th>Última sincronização</th><th>Próxima</th></tr></thead>
              <tbody>
                {state.sources.map((s) => (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td>
                      <span className={`pill ${STATUS[s.status]?.[1] || ""}`}>{s.id === "whatsapp" ? WHATSAPP_STATUS : STATUS[s.status]?.[0] || s.status}</span>
                      {s.status_detail && <small className="muted block">{s.status_detail}</small>}
                      {s.last_error && <small className="block error-text">{s.last_error}{s.failures > 1 ? ` (${s.failures} falhas seguidas)` : ""}</small>}
                    </td>
                    <td>{timestamp(s.last_success_at)}</td>
                    <td>{s.id === "whatsapp" ? "—" : timestamp(s.next_attempt_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={syncNow}><button type="submit" className="secondary-button">Sincronizar agora</button></form>
          <p className="panel-note">Sem processos permanentes: a sincronização corre quando alguém tem o Apoio ao Cliente aberto (com esta frequência), no botão Atualizar e numa passagem diária da Vercel. Depois de erros, a espera dobra até 30 minutos. {state.counts.conversations} conversas guardadas, {state.counts.open} por resolver.</p>
        </Panel>

        <Panel title="WhatsApp" eyebrow="FASE SEGUINTE">
          <p><span className="pill">{WHATSAPP_STATUS}</span></p>
          <dl className="config-list">
            <dt>Número</dt><dd>Reservado (phone_number_id) — por configurar</dd>
            <dt>Conta empresarial</dt><dd>Reservado (business_account_id) — por configurar</dd>
            <dt>Webhook</dt><dd><code>/api/support/webhooks/whatsapp</code> — recusa pedidos até estar configurado</dd>
            <dt>Regras previstas</dt><dd>Janela de atendimento de 24 h; fora dela só mensagens modelo aprovadas.</dd>
          </dl>
          <p className="panel-note">WhatsApp Cloud API, independente do Zendesk. Nada foi ligado: o número e o WhatsApp atual nos telemóveis não foram alterados.</p>
        </Panel>
      </div>

      <Panel title="Quem usa o Apoio ao Cliente" eyebrow="ACESSOS">
        <div className="table-scroll">
          <table className="left-table">
            <thead><tr><th>Pessoa</th><th>Acesso</th><th /></tr></thead>
            <tbody>
              {state.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}<small className="muted block">{u.username}</small></td>
                  <td>{u.is_super_admin ? <span className="tag gold">Super Admin</span> : u.support_access ? <span className="tag green">Apoio ao Cliente</span> : <span className="muted">Sem acesso</span>}</td>
                  <td>
                    {!u.is_super_admin && (
                      <form action={setSupportAccess}>
                        <input type="hidden" name="user_id" value={u.id} />
                        <input type="hidden" name="access" value={u.support_access ? "0" : "1"} />
                        <button type="submit" className="secondary-button">{u.support_access ? "Retirar acesso" : "Dar acesso"}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-note">Novas colaboradoras: criar o utilizador em Administração → Utilizadores e marcar “Apoio ao Cliente”. O plano Zendesk Team tem 3 licenças de agente: só quem tem licença consegue ligar o Zendesk.</p>
      </Panel>
    </AppShell>
  );
}
