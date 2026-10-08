import Link from "next/link";
import { redirect } from "next/navigation";
import { metricoolConfigured } from "@/lib/bi/metricool";
import { emailConfigured } from "@/lib/email";
import { shopifyConfigured, supportStoreInfo, type StoreInfo } from "@/lib/bi/shopify";
import { homePath } from "@/lib/permissions";
import { aiConfigured, aiWorkspaceStatus } from "@/lib/support/ai";
import { AI_MODEL, htmlToText } from "@/lib/support/ai-rules";
import { encryptionProblem } from "@/lib/support/crypto";
import { emailSettings, gmailConfigured, gmailMailbox, gmailPushAudience, gmailPushReady, gmailRedirectUri, type EmailSettings } from "@/lib/support/gmail";
import { serverConfigured, sessionRpc } from "@/lib/support/db";
import { supportEmailFrom } from "@/lib/support/notify";
import { siteOrigins } from "@/lib/support/site-chat";
import { metricoolDiagnostics } from "@/lib/support/metricool";
import { WHATSAPP_STATUS } from "@/lib/support/whatsapp";
import { redirectUri, ZENDESK_SCOPES, zendeskDiagnostics, zendeskReadiness } from "@/lib/support/zendesk";
import { requireViewer } from "@/lib/viewer";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { deleteKnowledge, disconnectGmail, disconnectZendesk, saveAiSettings, saveEmailSettings, saveKnowledge, savePolling, setSupportAccess, syncNow } from "./actions";

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
type AiAdmin = {
  settings: { ai_enabled: boolean; ai_daily_limit: number; ai_monthly_budget: number };
  knowledge: { id: string; title: string; body: string; position: number; updated_at: string; updated_by_name: string | null }[];
  usage: { month_cost: number; month_requests: number; month_errors: number; by_user: { name: string; requests: number; cost: number }[] };
};
type GmailStatus = { email: string; status: "active" | "reconnect"; status_detail: string | null; scope: string | null; watch_expires_at: string | null; connected_at: string; connected_by: string | null } | null;
// Resultado da ligação ao Gmail (código no URL, vindo das rotas /api/support/gmail/*).
const GMAIL_FLASH: Record<string, [boolean, string]> = {
  ligado: [true, "Caixa Gmail ligada. Os emails que chegarem a partir de agora entram no canal Email (os anteriores ficam no Gmail e no Zendesk). Envie um email de teste de um endereço nosso para confirmar."],
  "sem-acesso": [false, "Só o Super Admin pode ligar a caixa de email."],
  "por-configurar": [false, "Faltam GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou SUPPORT_ENCRYPTION_KEY na Vercel."],
  endereco: [false, "A caixa liga-se no endereço de produção do dashboard (o registado na Google). Carregue em Ligar Gmail aqui."],
  recusado: [false, "A autorização foi cancelada na Google. Nada foi alterado."],
  invalido: [false, "O pedido de ligação expirou ou não é válido. Carregue de novo em Ligar Gmail."],
  "outra-conta": [false, "Entrou com outra conta Google. Escolha a conta da caixa do apoio e volte a tentar."],
  erro: [false, "A Google não concluiu a ligação. Tente de novo; se repetir, veja os registos da Vercel."],
};
const usd = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "USD" }).format(Number(v) || 0);

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
  const [state, ai, gmail, email] = await Promise.all([
    sessionRpc<State>(viewer.session, "ldo_support_admin_state"),
    sessionRpc<AiAdmin>(viewer.session, "ldo_support_ai_admin"),
    sessionRpc<GmailStatus>(viewer.session, "ldo_support_gmail_status").catch((): GmailStatus => null),
    emailSettings().catch((): EmailSettings | null => null),
  ]);
  // O que a IA consegue ler da loja online (políticas e páginas dependem de autorizações da app Shopify).
  let store: StoreInfo | null = null;
  let storeError = "";
  if (shopifyConfigured()) {
    try {
      store = await supportStoreInfo(htmlToText);
    } catch (e) {
      storeError = e instanceof Error ? e.message : "Shopify indisponível.";
    }
  } else storeError = "Ligação Shopify por configurar.";
  // Chat do site: remetente dos avisos por email (o Resend só entrega a partir de um domínio verificado).
  const siteSource = state.sources.find((x) => x.id === "site-chat");
  const siteFrom = supportEmailFrom();
  const siteDomainPending = /resend\.dev/i.test(siteFrom);
  // Mensagens das ações da IA aparecem dentro da secção da IA (o redirect leva até lá com #ia).
  const aiFlash = q.secao === "ia";
  // Email: mensagens das ações (secao=email) e da ligação OAuth (gmail=<código>) aparecem na secção do email.
  const gmailFlash = typeof q.gmail === "string" ? GMAIL_FLASH[q.gmail] : undefined;
  const emailFlash = q.secao === "email" || Boolean(gmailFlash);
  const gmailSource = state.sources.find((x) => x.id === "gmail");
  const gmailOrigin = new URL(gmailRedirectUri()).origin;
  // O botão só aparece onde a Google aceita o retorno (produção); numa preview fica o endereço certo.
  const gmailHere = process.env.VERCEL_ENV === "production" || !process.env.VERCEL_ENV;
  const aiWorkspace = aiWorkspaceStatus();
  const flashOk = typeof q.ok === "string" ? q.ok.slice(0, 200) : undefined;
  const flashError = typeof q.erro === "string" ? q.erro.slice(0, 600) : undefined;
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
      {!aiFlash && !emailFlash && <Flash ok={flashOk} error={flashError} />}
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

      <Panel title="Email (Gmail)" eyebrow="CAIXA DO APOIO" id="email">
        {emailFlash && (gmailFlash
          ? <Flash ok={gmailFlash[0] ? gmailFlash[1] : undefined} error={gmailFlash[0] ? undefined : gmailFlash[1]} />
          : <Flash ok={flashOk} error={flashError} />)}
        <div className="two-col">
          <div>
            <dl className="config-list">
              <dt>Caixa</dt><dd>{gmailMailbox()}</dd>
              <dt>Ligação</dt>
              <dd>
                {!gmail ? <span className="pill">Por ligar</span> : gmail.status === "active" ? <span className="pill ok">Ligada</span> : <span className="pill warn">Voltar a ligar</span>}
                {gmail && <small className="muted block">{gmail.connected_by ? `Por ${gmail.connected_by}, ` : ""}{timestamp(gmail.connected_at)}</small>}
                {gmail?.status_detail && <small className="block error-text">{gmail.status_detail}</small>}
              </dd>
              <dt>Cliente OAuth</dt><dd>{yes(gmailConfigured())} <small className="muted">GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET</small></dd>
              <dt>Cifra das chaves</dt><dd>{yes(!encryptionProblem())} <small className="muted">{encryptionProblem() || "SUPPORT_ENCRYPTION_KEY"}</small></dd>
              <dt>Avisos da Google</dt>
              <dd>
                {yes(gmailPushReady())} <small className="muted">GMAIL_PUBSUB_TOPIC, GMAIL_PUSH_SERVICE_ACCOUNT</small>
                {gmail?.watch_expires_at && <small className="muted block">Ativos até {timestamp(gmail.watch_expires_at)} (renovados automaticamente)</small>}
              </dd>
              <dt>Redirect URI</dt><dd><code>{gmailRedirectUri()}</code></dd>
              <dt>Endereço dos avisos</dt><dd><code>{gmailPushAudience()}</code></dd>
              {gmailSource && (
                <>
                  <dt>Sincronização</dt>
                  <dd>
                    {STATUS[gmailSource.status]?.[0] || gmailSource.status}{gmailSource.last_success_at ? ` · ${timestamp(gmailSource.last_success_at)}` : ""}
                    {gmailSource.last_error && <small className="block error-text">{gmailSource.last_error}</small>}
                  </dd>
                </>
              )}
            </dl>
            {gmailHere ? (
              <form method="post" action="/api/support/gmail/connect" className="inline-form">
                <button type="submit" className="secondary-button" disabled={!gmailConfigured() || Boolean(encryptionProblem())}>{gmail ? "Voltar a ligar Gmail" : "Ligar Gmail"}</button>
              </form>
            ) : (
              <p className="panel-note">A caixa liga-se no dashboard de produção (<code>{gmailOrigin}/apoio/configuracao</code>), o endereço registado na Google.</p>
            )}
            {gmail && (
              <form action={disconnectGmail} className="knowledge-row">
                <label className="checkbox-label"><input type="checkbox" name="confirm" required /> Confirmo</label>
                <button type="submit" className="secondary-button">Desligar a caixa</button>
              </form>
            )}
          </div>
          {email ? (
            <form action={saveEmailSettings} className="email-form">
              <label>
                Assinatura automática
                <textarea name="email_signature" defaultValue={email.signature} maxLength={2000} rows={5} />
                <small className="muted">{"{nome}"} é trocado pelo primeiro nome de quem responde. Entra em todas as respostas por email.</small>
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="email_autoreply_enabled" defaultChecked={email.autoreply_enabled} /> Resposta automática ligada (&quot;recebemos o seu email&quot;)
              </label>
              <label>
                Texto dentro do horário
                <textarea name="email_autoreply_text" defaultValue={email.autoreply_text} maxLength={4000} rows={5} />
              </label>
              <label>
                Texto fora do horário
                <textarea name="email_autoreply_offhours_text" defaultValue={email.autoreply_offhours_text} maxLength={4000} rows={5} />
              </label>
              <div className="email-hours">
                <label>Dias úteis<input name="hours_weekdays" defaultValue={email.hours.weekdays || ""} maxLength={80} placeholder="09:30-13:00, 14:00-18:30" /></label>
                <label>Sábado<input name="hours_saturday" defaultValue={email.hours.saturday || ""} maxLength={80} placeholder="vazio = fechado" /></label>
                <label>Domingo<input name="hours_sunday" defaultValue={email.hours.sunday || ""} maxLength={80} placeholder="vazio = fechado" /></label>
              </div>
              <small className="muted">Horário de Lisboa, só para escolher o texto da resposta automática. Os feriados não são considerados.</small>
              <div className="knowledge-row"><button type="submit" className="secondary-button">Guardar</button></div>
            </form>
          ) : (
            <p className="error-text">Definições do email indisponíveis (falta a atualização do Gmail na base de dados?).</p>
          )}
        </div>
        <p className="panel-note">
          Os emails para {gmailMailbox()} entram no canal &quot;Email&quot; em poucos segundos (aviso da Google) e também em cada sincronização, a partir do momento em que a caixa é ligada (os anteriores não são importados). As respostas vão sempre para o cliente da conversa. Nos pedidos do formulário de contacto da loja o email do cliente fica como não confirmado: as encomendas só aparecem depois de a equipa associar o cliente. As respostas saem desta caixa, na mesma conversa do Gmail, com a assinatura acima, e ficam nos Enviados do Gmail. A resposta automática vai só uma vez por conversa e no máximo uma vez por dia a cada remetente; nunca a newsletters, notificações automáticas ou endereços do próprio domínio. Spam, promoções e redes sociais do Gmail ficam de fora. Para deixar o Zendesk: depois de confirmar aqui que os emails entram e que as respostas chegam, desligue no Gmail o reencaminhamento para o Zendesk e, no Zendesk, as respostas automáticas, para o cliente não receber mensagens duplicadas.
        </p>
      </Panel>

      <Panel title="Assistente de IA" eyebrow="RESPOSTAS COM IA" id="ia">
        {aiFlash && <Flash ok={flashOk} error={flashError} />}
        <div className="two-col">
          <div>
            <dl className="config-list">
              <dt>Chave da Anthropic</dt><dd>{yes(aiConfigured())} <small className="muted">ANTHROPIC_API_KEY (variável sensível na Vercel; nunca no GitHub)</small></dd>
              <dt>Workspace da Anthropic</dt>
              <dd>
                {aiWorkspace === "set" ? <span className="pill ok">Indicado</span> : aiWorkspace === "invalid" ? <span className="pill warn">Inválido</span> : <span className="pill">Não indicado</span>}{" "}
                <small className="muted">ANTHROPIC_WORKSPACE_ID: só é preciso se a chave não pertencer a um workspace (o ID começa por wrkspc_).</small>
              </dd>
              <dt>Modelo</dt><dd>Claude Opus 5.5 <code>{AI_MODEL}</code> · esforço médio</dd>
              <dt>O que a IA lê</dt><dd>A conversa aberta e o cliente, a base de conhecimento abaixo, as lojas físicas do dashboard e a loja online. Consulta, quando precisa, produtos, encomendas do cliente da conversa, respostas anteriores da equipa e outras conversas do mesmo cliente. Só leituras.</dd>
              <dt>Loja online</dt>
              <dd>
                {store ? (
                  <>
                    {store.policies.length} política(s) · {store.pages.length} página(s) publicadas
                    {store.missing.length > 0 && <small className="muted block">Em falta: {store.missing.join("; ")}.</small>}
                  </>
                ) : (
                  <span className="error-text">{storeError}</span>
                )}
              </dd>
              <dt>Este mês</dt><dd>{usd(ai.usage.month_cost)} estimados · {ai.usage.month_requests} pedidos{ai.usage.month_errors ? ` (${ai.usage.month_errors} com erro)` : ""}</dd>
            </dl>
            {ai.usage.by_user.length > 0 && (
              <div className="table-scroll">
                <table className="left-table">
                  <thead><tr><th>Pessoa</th><th>Pedidos</th><th>Custo estimado</th></tr></thead>
                  <tbody>
                    {ai.usage.by_user.map((u) => <tr key={u.name}><td>{u.name}</td><td>{u.requests}</td><td>{usd(u.cost)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <form action={saveAiSettings} className="inline-form">
            <label className="checkbox-label">
              <input type="checkbox" name="ai_enabled" defaultChecked={ai.settings.ai_enabled} /> Assistente ligado
            </label>
            <label>
              Pedidos por pessoa e por dia
              <input type="number" name="ai_daily_limit" required min={0} max={1000} step={1} defaultValue={ai.settings.ai_daily_limit} />
            </label>
            <label>
              Orçamento mensal (US$)
              <input type="number" name="ai_monthly_budget" required min={0} max={10000} step={1} defaultValue={ai.settings.ai_monthly_budget} />
            </label>
            <button type="submit" className="secondary-button">Guardar</button>
          </form>
        </div>
        <p className="panel-note">
          A IA propõe respostas e responde a perguntas da equipa; nunca envia nada ao cliente. Cada pedido custa normalmente alguns cêntimos (estimativa no histórico de cada pessoa e acima; a fatura da Anthropic é a referência). Ao atingir o orçamento do mês, os pedidos param até ao mês seguinte ou até o aumentar. A conversa e os dados consultados são enviados à Anthropic para gerar a resposta: a Anthropic não usa os dados da API para treinar modelos e guarda-os por um período limitado. Para criar a chave: console.anthropic.com → API Keys → Create Key; depois, na Vercel, Settings → Environment Variables → ANTHROPIC_API_KEY (Sensitive, Production e Preview) e um novo deploy. Se a Anthropic responder que a chave &quot;is not scoped to a workspace&quot;, copie o ID do workspace (Claude Console → Settings → Workspaces; começa por wrkspc_) para ANTHROPIC_WORKSPACE_ID na Vercel (não é segredo) e publique de novo.
        </p>

        <h3 className="panel-subtitle">Base de conhecimento</h3>
        <p className="panel-note">O que a IA deve saber sobre a empresa e que não está na loja online: moradas e horários das lojas, prazos e custos de envio, trocas e garantias, reparações, gravações, compra de ouro, tom de voz e assinatura. Secções sem texto são ignoradas. A IA trata isto como verdade: escreva só o que está em vigor.</p>
        <div className="knowledge-list">
          {ai.knowledge.map((k) => (
            <details key={k.id} className={`knowledge-item${k.body.trim() ? "" : " empty"}`}>
              <summary>
                {k.title}
                <small>{k.body.trim() ? `${k.body.length} caracteres · ${k.updated_by_name ? `${k.updated_by_name}, ` : ""}${timestamp(k.updated_at)}` : "por preencher"}</small>
              </summary>
              <form action={saveKnowledge}>
                <input type="hidden" name="id" value={k.id} />
                <div className="knowledge-row">
                  <input name="title" defaultValue={k.title} maxLength={120} required aria-label="Título" />
                  <input type="number" name="position" defaultValue={k.position} min={0} max={10000} aria-label="Ordem" title="Ordem" />
                </div>
                <textarea name="body" defaultValue={k.body} maxLength={20000} aria-label={`Texto de ${k.title}`} />
                <div className="knowledge-row">
                  <button type="submit" className="secondary-button">Guardar secção</button>
                </div>
              </form>
              <form action={deleteKnowledge} className="knowledge-row">
                <input type="hidden" name="id" value={k.id} />
                <label className="checkbox-label"><input type="checkbox" required /> Confirmo</label>
                <button type="submit" className="secondary-button">Apagar secção</button>
              </form>
            </details>
          ))}
        </div>
        <form action={saveKnowledge} className="knowledge-new">
          <strong>Nova secção</strong>
          <div className="knowledge-row">
            <input name="title" placeholder="Título (ex.: Envios para as ilhas)" maxLength={120} required aria-label="Título da nova secção" />
            <input type="number" name="position" defaultValue={(ai.knowledge.at(-1)?.position ?? 0) + 10} min={0} max={10000} aria-label="Ordem" title="Ordem" />
          </div>
          <textarea name="body" maxLength={20000} placeholder="Texto que a IA deve conhecer…" aria-label="Texto da nova secção" />
          <div className="knowledge-row"><button type="submit" className="secondary-button">Criar secção</button></div>
        </form>
      </Panel>

      <Panel title="Chat do site" eyebrow="BOTÃO NO SITE" id="chat">
        <dl className="config-list">
          <dt>Estado</dt><dd>{siteSource?.status === "active" ? <span className="pill ok">Ativo</span> : <span className="pill warn">{siteSource?.status || "Por configurar"}</span>}</dd>
          <dt>Sites autorizados</dt><dd><code>{siteOrigins().join(" · ")}</code> <small className="muted block">SITE_CHAT_ORIGINS (opcional)</small></dd>
          <dt>Clientes com sessão</dt><dd>{yes(Boolean(process.env.SITE_CHAT_SECRET))} <small className="muted">SITE_CHAT_SECRET, com o mesmo valor na definição do tema. Sem ela, o email escrito no chat fica como não confirmado.</small></dd>
          <dt>Aviso por email</dt>
          <dd>
            {!emailConfigured() ? <span className="pill warn">Em falta</span> : siteDomainPending ? <span className="pill warn">Domínio por verificar</span> : <span className="pill ok">Configurado</span>}
            <small className="muted block">
              {siteDomainPending
                ? "O Resend só entrega emails enviados de um domínio verificado: verificar lojadoouro.pt no Resend e indicar o remetente em SUPPORT_EMAIL_FROM (ex.: Loja do Ouro <apoiocliente@lojadoouro.pt>). Até lá, o cliente vê a resposta só no chat."
                : `Remetente: ${siteFrom}`}
            </small>
          </dd>
        </dl>
        <p className="panel-note">O botão é instalado no tema Shopify com a secção &quot;Chat Loja do Ouro&quot; (Personalizar tema → Rodapé → Adicionar secção), onde ficam todas as definições; o código do widget vem deste dashboard. As conversas entram no canal &quot;Chat do site&quot;: a equipa responde como nos outros canais e o cliente vê a resposta em poucos segundos; se já tiver saído do site, recebe-a também por email (no máximo um email a cada 10 minutos). O email escrito por quem não tem sessão iniciada não é confirmado, por isso não mostra encomendas até a equipa o associar.</p>
        <a className="outline-button" href="/apoio/chat-teste">Testar o chat</a>
      </Panel>

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
