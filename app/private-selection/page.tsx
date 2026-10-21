import Link from "next/link";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { emailConfigured } from "@/lib/email";
import { klaviyoWriteConfigured } from "@/lib/klaviyo-write";
import { canManagePrivateSelection, homePath } from "@/lib/permissions";
import { psList, type PsMember } from "@/lib/private-selection/db";
import { sweepPrivateSelection } from "@/lib/private-selection/send";
import { entryUrl, PS_BRANDS, PS_LOCALES, PS_PASSWORD_MAX, PS_PASSWORD_MIN, type PsLocale } from "@/lib/private-selection-rules";
import { encryptionProblem } from "@/lib/support/crypto";
import { requireViewer } from "@/lib/viewer";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { addMember, removeMember, resendEmail, retryKlaviyo, saveEntryPath, savePassword } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Private Selection · Loja do Ouro" };

const OK: Record<string, string> = {
  added: "Pessoa adicionada.",
  readded: "Pessoa adicionada de novo (estava removida).",
  resent: "Email com a senha de novo na fila.",
  removed: "Pessoa removida: as sessões dela na loja terminaram, o email por enviar foi cancelado e sai da lista da Klaviyo. Novos pedidos com o mesmo email (ou o mesmo telemóvel) não recebem a senha. Como a senha é partilhada, quem a sabe ainda entra com o email de outro membro: para cortar esse acesso, mude a senha.",
  password: "Senha guardada. Todas as sessões abertas na loja terminaram; os membros só voltam a entrar depois de receberem a nova senha (use Reenviar ou guarde de novo com a opção de a enviar a todos).",
  password_sent: "Senha guardada e enviada de novo a todos os membros ativos (nos próximos minutos). Todas as sessões abertas na loja terminaram.",
  settings: "Página guardada.",
  klaviyo: "Klaviyo de novo na fila.",
};
// Mensagens que acabam com o envio do email (já, ou só quando houver senha).
const QUEUED = new Set(["added", "readded", "resent"]);
const LANG: Record<PsLocale, string> = { pt: "Português", en: "Inglês", es: "Espanhol", fr: "Francês", de: "Alemão", it: "Italiano" };

// Horas de Lisboa: "às 15:30" hoje, "a 21/10 às 15:30" noutro dia; "21/10 15:30" para o que já aconteceu.
const lisbon = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", ...o });
const DAY = lisbon({ dateStyle: "short" });
const DM = lisbon({ day: "2-digit", month: "2-digit" });
const HM = lisbon({ hour: "2-digit", minute: "2-digit" });
const at = (iso: string) => (DAY.format(new Date(iso)) === DAY.format(new Date()) ? "" : `a ${DM.format(new Date(iso))} `) + `às ${HM.format(new Date(iso))}`;
const when = (iso: string) => `${DM.format(new Date(iso))} ${HM.format(new Date(iso))}`;

// Email com a senha (fila em ldo_ps_members): sai quando há senha, até 5 tentativas com 30 minutos entre elas.
function EmailStatus({ m, hasPassword }: { m: PsMember; hasPassword: boolean }) {
  if (m.email_sent_at) return <>Enviado {when(m.email_sent_at)}</>;
  if (m.status === "removed" || !m.email_due_at) return <span className="muted">Não enviado</span>;
  if (!hasPassword) return <span className="pill warn">À espera da senha</span>;
  if (m.email_attempts > 0)
    return (
      <>
        <span className="error-text">Falhou: {m.email_detail || "motivo desconhecido"}</span>
        <small className="muted block">{m.email_attempts >= 5 ? "Sem mais tentativas: use Reenviar." : `Nova tentativa ${at(m.email_due_at)}`}</small>
      </>
    );
  return <>Email {at(m.email_due_at)}</>;
}

// Lista "Clientes Private Selection" na Klaviyo: ação pendente (com o erro da última tentativa; depois de 5 falhas,
// "Tentar de novo") ou o resultado. A inscrição no marketing é a que foi enviada à Klaviyo, não o estado atual: quem
// sai nos emails da Klaviyo continua aqui com ela.
function KlaviyoStatus({ m, removedView }: { m: PsMember; removedView: boolean }) {
  if (m.klaviyo_action) {
    const what = m.klaviyo_action === "remove" ? "Tirar da lista" : "Juntar à lista";
    if (!m.klaviyo_detail) return <span className="muted">{what} · na fila</span>;
    const stopped = m.klaviyo_attempts >= 5;
    return (
      <>
        <span className="error-text">Falhou: {m.klaviyo_detail}</span>
        <small className="muted block">{what}{stopped ? " · sem mais tentativas" : ""}</small>
        {stopped && (
          <form action={retryKlaviyo} className="row-action">
            <input type="hidden" name="id" value={m.id} />
            {removedView && <input type="hidden" name="ver" value="removidos" />}
            <button type="submit" className="secondary-button" title={`${what} de novo: ${m.email}`}>Tentar de novo</button>
          </form>
        )}
      </>
    );
  }
  if (!m.klaviyo_synced_at) return <span className="muted">—</span>;
  return (
    <>
      {m.status === "removed" ? "Fora da lista" : "Na lista"}
      <small className="muted block">{when(m.klaviyo_synced_at)}</small>
      {m.klaviyo_subscribed_at && <small className="muted block">Inscrição no marketing enviada {when(m.klaviyo_subscribed_at)}</small>}
    </>
  );
}

export default async function PrivateSelectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManagePrivateSelection(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const list = await psList(viewer.session).catch(() => null);
  // De passagem, depois da resposta: o que já está na hora sai sem esperar pela verificação de 5 em 5 minutos.
  after(() => sweepPrivateSelection().catch(() => undefined));
  const removedView = q.ver === "removidos";
  const members = list?.members || [];
  const active = members.filter((m) => m.status === "active");
  const removed = members.filter((m) => m.status === "removed");
  const shown = removedView ? removed : active;
  const s = list?.settings;
  // "Adicionar de novo": o formulário abre com os dados do removido (pelo id; os dados nunca vão no endereço).
  const readd = typeof q.id === "string" ? removed.find((m) => m.id === q.id) || null : null;
  const okKey = typeof q.ok === "string" ? q.ok : "";
  const ok = OK[okKey]
    ? `${OK[okKey]}${QUEUED.has(okKey) ? (s?.has_password ? " O email com a senha sai nos próximos minutos." : " O email com a senha só sai depois de definir a senha.") : ""}`
    : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  const keyProblem = encryptionProblem();
  const listHref = (params: Record<string, string>) => `/private-selection?${new URLSearchParams({ ...(removedView ? { ver: "removidos" } : {}), ...params })}`;
  const keepView = removedView && <input type="hidden" name="ver" value="removidos" />;

  return (
    <AppShell viewer={viewer} current="private-selection" title="Private Selection">
      <PageHeading eyebrow="LOJA ONLINE" title="Private Selection" text="Página reservada da loja: quem tem acesso, a senha partilhada e o email que a envia.">
        <Link className="outline-button" href="#adicionar">+ Adicionar pessoa</Link>
      </PageHeading>
      <Flash ok={ok} error={error} />
      {!list || !s ? (
        <div className="notice error-notice">Lista indisponível (falta a atualização da base de dados?).</div>
      ) : (
        <>
          <div className="two-col admin-layout">
            <Panel title={readd ? `Adicionar de novo ${readd.name}` : "Adicionar pessoa"} eyebrow={readd ? "REMOVIDO" : "NOVO MEMBRO"} id="adicionar">
              <form action={addMember} className="form-grid" key={readd?.id || "novo"}>
                <input type="hidden" name="id" value={readd?.id || ""} />
                {keepView}
                <label className="wide">
                  Nome
                  <input name="name" required maxLength={120} autoComplete="off" defaultValue={readd?.name || ""} />
                </label>
                <label>
                  Email
                  <input name="email" type="email" required maxLength={254} autoCapitalize="none" autoComplete="off" spellCheck={false} defaultValue={readd?.email || ""} />
                </label>
                <label>
                  Telemóvel
                  <input
                    name="phone"
                    type="tel"
                    required
                    maxLength={40}
                    pattern="\+?[0-9][0-9 .\(\)\-]{6,24}"
                    title="Com o indicativo do país, ex.: +351 912 345 678"
                    placeholder="+351 912 345 678"
                    autoComplete="off"
                    defaultValue={readd?.phone || ""}
                  />
                </label>
                <label>
                  Língua do email
                  <select name="locale" defaultValue={readd?.locale || "pt"}>
                    {PS_LOCALES.map((l) => (
                      <option key={l} value={l}>{LANG[l]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Marca
                  <select name="brand" defaultValue={readd?.brand || "ldo"}>
                    {(["ldo", "gsp"] as const).map((b) => (
                      <option key={b} value={b}>{PS_BRANDS[b].name}</option>
                    ))}
                  </select>
                </label>
                <p className="field-help wide">
                  Como na loja: <strong>Loja do Ouro</strong> para quem está em português e em Portugal, <strong>Gold Store Premium</strong> para os restantes. Telemóvel com o indicativo do país (na Loja do Ouro, sem indicativo conta como português). O email com a senha sai já, nessa língua e com essa marca. Se o email já for de um membro, os dados passam a ser estes e a senha volta a ser enviada.
                </p>
                <div className="wide form-actions">
                  <button type="submit">{readd ? "Adicionar de novo" : "Adicionar"}</button>
                  {readd && <Link href={listHref({})}>Cancelar</Link>}
                </div>
              </form>
            </Panel>

            <div className="stack">
              <Panel title="Senha de acesso" eyebrow="UMA SÓ PARA TODOS">
                <dl className="config-list">
                  <dt>Senha</dt>
                  <dd>
                    {s.has_password ? <span className="pill ok">Definida</span> : <span className="pill warn">Por definir</span>}
                    {s.has_password && s.password_changed_at && (
                      <small className="muted block">Mudada em {timestamp(s.password_changed_at)}{s.password_changed_by_name ? ` por ${s.password_changed_by_name}` : ""}</small>
                    )}
                    {!s.has_password && <small className="block error-text">Sem senha ninguém consegue entrar e os emails ficam à espera.</small>}
                  </dd>
                </dl>
                <form action={savePassword} className="form-grid">
                  {keepView}
                  <label>
                    Nova senha
                    <input name="password" type="password" required minLength={PS_PASSWORD_MIN} maxLength={PS_PASSWORD_MAX} autoComplete="new-password" spellCheck={false} />
                  </label>
                  <label>
                    Repetir a nova senha
                    <input name="confirm_password" type="password" required minLength={PS_PASSWORD_MIN} maxLength={PS_PASSWORD_MAX} autoComplete="new-password" spellCheck={false} />
                  </label>
                  <label className="check wide">
                    <input type="checkbox" name="notify_all" />
                    <span>Enviar a nova senha a todos os membros ativos ({active.length})</span>
                  </label>
                  <div className="wide form-actions">
                    <button type="submit" disabled={Boolean(keyProblem)}>Guardar senha</button>
                    <small>Pelo menos {PS_PASSWORD_MIN} caracteres. Mudar a senha termina todas as sessões abertas na loja; sem a opção acima, ninguém recebe a nova senha e os membros só voltam a entrar com Reenviar. A senha nunca é mostrada aqui.</small>
                  </div>
                </form>
              </Panel>

              <Panel title="Email e página na loja" eyebrow="CONFIGURAÇÃO">
                <dl className="config-list">
                  <dt>Email com a senha</dt>
                  <dd>{s.delay_minutes} minutos depois do pedido ({s.delay_minutes} a {s.delay_minutes + 5} com a verificação de 5 em 5 minutos); logo, para quem a equipa adiciona.</dd>
                  <dt>Envio (Resend)</dt><dd>{emailConfigured() ? <span className="pill ok">Configurado</span> : <span className="pill warn">Em falta</span>}</dd>
                  <dt>Cifra da senha</dt>
                  <dd>
                    {keyProblem ? <span className="pill warn">Em falta</span> : <span className="pill ok">Configurada</span>}
                    {keyProblem && <small className="block error-text">{keyProblem}</small>}
                  </dd>
                  <dt>Klaviyo</dt>
                  <dd>
                    {klaviyoWriteConfigured() ? <span className="pill ok">Configurada</span> : <span className="pill warn">Em falta</span>}{" "}
                    <small className="muted">KLAVIYO_WRITE_API_KEY, KLAVIYO_PRIVATE_SELECTION_LIST_ID</small>
                    <small className="block muted">
                      A lista tem de ter double opt-in: o formulário não confirma o email, por isso a Klaviyo pede a confirmação a quem marcou o marketing. Na lista também está quem não aceitou: as campanhas vão só para um segmento da lista com consentimento de email (Subscribed), nunca para a lista inteira.
                    </small>
                  </dd>
                  <dt>Sessão na loja</dt><dd>{s.session_days} dias, confirmada em cada visita da página</dd>
                </dl>
                <form action={saveEntryPath} className="form-grid">
                  {keepView}
                  <label className="wide">
                    Página da Private Selection na loja (caminho ou link)
                    <input name="entry_path" required maxLength={500} spellCheck={false} defaultValue={s.entry_path} />
                  </label>
                  <div className="wide form-actions">
                    <button type="submit" className="secondary-button">Guardar</button>
                  </div>
                </form>
                <p className="panel-note">
                  Botão do email: <a href={entryUrl("ldo", "pt", s.entry_path)} target="_blank" rel="noopener noreferrer">{entryUrl("ldo", "pt", s.entry_path)}</a> (Loja do Ouro) ou{" "}
                  <a href={entryUrl("gsp", "en", s.entry_path)} target="_blank" rel="noopener noreferrer">{entryUrl("gsp", "en", s.entry_path)}</a> (Gold Store Premium), com o prefixo da língua de cada membro (/en, /es…).
                </p>
              </Panel>
            </div>
          </div>

          <Panel
            title={`${shown.length} ${removedView ? (shown.length === 1 ? "membro removido" : "membros removidos") : shown.length === 1 ? "membro ativo" : "membros ativos"}`}
            eyebrow="MEMBROS"
            note="Remover é uma marca: termina as sessões da pessoa na loja e, se pedir acesso de novo com o mesmo email (ou o mesmo telemóvel), recebe a mesma resposta sem email. Só a equipa a pode adicionar outra vez. A senha é partilhada: quem a sabe ainda entra com o email de outro membro, e um pedido com outro email e outro telemóvel conta como pessoa nova. Para cortar o acesso de quem já sabe a senha, mude-a."
          >
            <div className="list-controls">
              <nav className="segmented" aria-label="Mostrar">
                <Link href="/private-selection" className={removedView ? "" : "active"} aria-current={removedView ? undefined : "page"}>Ativos ({active.length})</Link>
                <Link href="/private-selection?ver=removidos" className={removedView ? "active" : ""} aria-current={removedView ? "page" : undefined}>Removidos ({removed.length})</Link>
              </nav>
            </div>
            <div className="table-scroll" tabIndex={0} aria-label="Membros da Private Selection">
              <table className="left-table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Língua e marca</th>
                    <th>Pedido</th>
                    <th>Email com a senha</th>
                    <th>Klaviyo</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.id} className={m.id === readd?.id ? "selected-row" : ""}>
                      <td>
                        {m.name}
                        <small className="muted block">{m.email}</small>
                        <small className="muted block">{m.phone}</small>
                      </td>
                      <td>
                        {LANG[m.locale] || m.locale}
                        <small className="muted block">{PS_BRANDS[m.brand]?.store || m.brand}</small>
                      </td>
                      <td>
                        {timestamp(m.created_at)}
                        <small className="muted block">{m.source === "form" ? "Formulário da loja" : `Equipa${m.created_by_name ? ` · ${m.created_by_name}` : ""}`}</small>
                        {m.consent_marketing && <span className="tag gold">Aceitou marketing</span>}
                      </td>
                      <td><EmailStatus m={m} hasPassword={s.has_password} /></td>
                      <td><KlaviyoStatus m={m} removedView={removedView} /></td>
                      <td>
                        {m.status === "active" ? <span className="pill ok">Ativo</span> : <span className="pill">Removido</span>}
                        {m.removed_at && <small className="muted block">{timestamp(m.removed_at)}{m.removed_by_name ? ` · ${m.removed_by_name}` : ""}</small>}
                        <small className="muted block">{m.last_login_at ? `Último acesso ${timestamp(m.last_login_at)}` : "Ainda não entrou"}</small>
                      </td>
                      <td>
                        {m.status === "active" ? (
                          <>
                            <form action={resendEmail} className="row-action">
                              <input type="hidden" name="id" value={m.id} />
                              {keepView}
                              <button type="submit" className="secondary-button" title={`Enviar de novo a senha para ${m.email}`}>Reenviar</button>
                            </form>
                            <form action={removeMember} className="row-action knowledge-row">
                              <input type="hidden" name="id" value={m.id} />
                              {keepView}
                              <label className="checkbox-label"><input type="checkbox" name="confirm" required /> Confirmo</label>
                              <button type="submit" className="secondary-button" title={`Remover ${m.email}: termina as sessões e bloqueia novos pedidos`}>Remover</button>
                            </form>
                          </>
                        ) : (
                          <Link href={`${listHref({ id: m.id })}#adicionar`}>Adicionar de novo</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr>
                      <td colSpan={7} className="muted">{removedView ? "Ninguém foi removido." : "Ainda não há membros. Quem pedir acesso na página da loja aparece aqui."}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
