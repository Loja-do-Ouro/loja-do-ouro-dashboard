import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/dashboard/ui";
import { Flash, PageHeading } from "@/components/shell";
import { crCreatorGet, crPublicCreator, crStaffMessages, type CrCreatorGet, type CrStaffMessage } from "@/lib/criadores/db";
import { PUBLIC_STOP_WHY_LABEL } from "@/lib/criadores-meta-rules";
import {
  AUDIT_ACTION_LABEL, CATEGORY_LABEL, CONSENT_LABEL, CONTACT_PREFERENCE_LABEL, CREATOR_STATUS_LABEL, DELETE_REASON_LABEL, FORMAT_LABEL,
  ibanTail, LANGUAGE_LABEL, lisbonDate, lisbonDateTime, ONBOARDING_STEPS, PLATFORM_LABEL, PRIVACY_CHANNEL_LABEL, PRIVACY_KIND_LABEL,
  type ConsentPurpose, type CreatorStatus,
} from "@/lib/criadores-rules";
import { SupabaseError } from "@/lib/supabase";
import { requireCreatorsViewer } from "@/lib/viewer";
import {
  addCreatorNote, deleteCreatorAccount, sendCreatorMessage, setCreatorStatus, validateCreatorMetric,
} from "../../actions";
import { creatorsError, creatorsMessage } from "../../messages";
import { CreatorsShell, num, pct, PrivacyPill, StatusPill, VerificationTag } from "../../ui";
import { PublicBlock } from "./publico";
import { RevealFinance } from "./revelar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ficha do criador · Loja do Ouro" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [
  ["perfil", "Perfil"],
  ["redes", "Redes e números"],
  ["pagamentos", "Pagamentos"],
  ["mensagens", "Mensagens"],
  ["notas", "Notas e histórico"],
] as const;
type Tab = (typeof TABS)[number][0];

// Decisões possíveis a partir de cada estado (as mesmas de ldo_cr_creator_status). «restricted» só com um pedido
// RGPD de limitação aberto.
type Decision = { to: Exclude<CreatorStatus, "draft" | "deleted">; label: string; reason: boolean; help?: string; danger?: boolean };
function decisions(status: CreatorStatus, restrictionOpen: boolean): Decision[] {
  const out: Decision[] = [];
  if (status === "pending_review") {
    out.push({ to: "approved", label: "Aprovar perfil", reason: false });
    out.push({ to: "rejected", label: "Recusar", reason: true, help: "O motivo vai no email ao criador (entre aspas, sem ligações).", danger: true });
  }
  if (status === "approved") out.push({ to: "suspended", label: "Suspender", reason: true, help: "Suspensa, a conta não muda o IBAN nem se candidata. O motivo vai por email.", danger: true });
  if (status === "suspended") out.push({ to: "approved", label: "Reativar", reason: false });
  if (status === "rejected") out.push({ to: "pending_review", label: "Reabrir a revisão", reason: false });
  if (status === "restricted") {
    out.push({ to: "approved", label: "Levantar a limitação (aprovado)", reason: false });
    out.push({ to: "pending_review", label: "Levantar a limitação (por rever)", reason: false });
  }
  if (status !== "restricted" && status !== "deleted" && restrictionOpen)
    out.push({ to: "restricted", label: "Limitar o tratamento", reason: true, help: "Art. 18.º do RGPD: congela candidaturas, pedidos e sincronização, e a limpeza não apaga os dados desta pessoa." });
  return out;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0 }}>{children || "—"}</dd>
    </>
  );
}
const dl = { display: "grid", gridTemplateColumns: "minmax(120px, max-content) 1fr", gap: "8px 18px", margin: 0 } as const;

function auditSummary(details: Record<string, unknown>) {
  const parts: string[] = [];
  const d = details || {};
  if (typeof d.from === "string" && typeof d.to === "string")
    parts.push(`${CREATOR_STATUS_LABEL[d.from as CreatorStatus] ?? d.from} → ${CREATOR_STATUS_LABEL[d.to as CreatorStatus] ?? d.to}`);
  if (typeof d.reason === "string" && d.reason) parts.push(`«${d.reason.slice(0, 200)}»`);
  if (d.during_hold === true) parts.push(d.oob_confirmed ? "durante a espera, confirmado por outro canal" : "durante a espera");
  if (typeof d.version === "string") parts.push(`v${d.version}`);
  // Fase 3A: public.stop leva o motivo; public.error, o erro; privacy.withdrawal, se havia leitura para parar.
  if (typeof d.why === "string") parts.push(PUBLIC_STOP_WHY_LABEL[d.why] ?? d.why);
  if (d.error === "not_found") parts.push("conta não encontrada pela Meta");
  if (d.stopped === false) parts.push("não havia leitura para parar");
  return parts.join(" · ");
}

function Messages({ items }: { items: CrStaffMessage[] }) {
  if (!items.length) return <p className="muted">Ainda não há mensagens com este criador.</p>;
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((m) => (
        <li
          key={m.id}
          style={{
            border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", maxWidth: 720,
            marginLeft: m.author_kind === "staff" ? "auto" : 0, background: m.author_kind === "creator" ? "#fff" : "#f6f7f3",
          }}
        >
          <small className="muted block">
            {m.author_kind === "creator" ? "Criador" : m.author_kind === "system" ? "Plataforma" : m.author || "Equipa"} · {lisbonDateTime(m.created_at)}
            {m.author_kind === "staff" && (m.read_by_creator_at ? " · lida" : " · por ler")}
          </small>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "6px 0 0" }}>{m.body}</p>
        </li>
      ))}
    </ol>
  );
}

export default async function CreatorPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireCreatorsViewer("view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sp = await searchParams;
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "perfil";

  let data: CrCreatorGet;
  try {
    data = await crCreatorGet(viewer.session, id);
  } catch (e) {
    if (e instanceof SupabaseError && e.code === "P0002") notFound();
    throw e;
  }
  // Abrir a conversa marca as mensagens do criador como lidas (só no separador Mensagens).
  const messages = tab === "mensagens" ? await crStaffMessages(viewer.session, id).catch(() => data.messages) : data.messages;
  // Dados públicos do Instagram (fase 3A), só no separador Redes (antes da migração, a função não existe: sem bloco).
  const pub = tab === "redes" ? await crPublicCreator(viewer.session, id).catch(() => null) : null;
  const { creator: c, profile: p, finance: f } = data;
  const manage = data.viewer.level === "manage";
  const isSuper = data.viewer.super;
  const deleted = c.status === "deleted" || Boolean(c.deleted_at);
  const name = p?.display_name || p?.full_name || (deleted ? "Conta apagada" : "Sem nome");
  const unread = data.messages.filter((m) => m.author_kind === "creator" && !m.read_by_staff_at).length;
  const openRequests = data.privacy_requests.filter((r) => r.status === "open");
  const restrictionOpen = openRequests.some((r) => r.kind === "restriction");
  const exportRequests = openRequests.filter((r) => (r.kind === "access" || r.kind === "portability") && r.identity_checked);
  const erasureRequests = openRequests.filter((r) => r.kind === "erasure" && (r.identity_checked || r.channel === "self_service"));
  const withdrawalRequests = openRequests.filter((r) => r.kind === "withdrawal" && (r.identity_checked || r.channel === "self_service"));
  const docVersion = new Map(data.consents.history.filter((h) => h.document_id).map((h) => [h.document_id as string, h.document_version]));
  const now = Date.now();

  return (
    <CreatorsShell viewer={viewer} current="influenciadores-criadores" title="Criadores">
      <PageHeading
        eyebrow="CRIADOR"
        title={name}
        text={`${deleted ? "Conta anonimizada" : c.email} · registo ${lisbonDate(c.created_at)} · ${c.last_login_at ? `última entrada ${lisbonDateTime(c.last_login_at)}` : "ainda não entrou"}`}
      >
        <Link className="outline-button" href="/influenciadores/criadores">← Criadores</Link>
      </PageHeading>
      <Flash ok={creatorsMessage(sp)} error={creatorsError(sp)} />

      <div className="list-controls">
        <StatusPill status={c.status} />
        {c.changed_since_review && <span className="pill warn">Alterado desde a revisão</span>}
        {f?.iban_hold && <span className="pill warn">IBAN em espera</span>}
        {f?.iban_pending_last4 && <span className="pill warn">IBAN por confirmar</span>}
        {openRequests.length > 0 && <span className="pill warn">{openRequests.length === 1 ? "1 pedido RGPD aberto" : `${openRequests.length} pedidos RGPD abertos`}</span>}
      </div>

      <nav className="segmented ranking-tabs" aria-label="Separadores da ficha">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/influenciadores/criadores/${id}?tab=${k}`} className={tab === k ? "active" : ""} aria-current={tab === k ? "page" : undefined}>
            {label}
            {k === "mensagens" && unread > 0 ? ` (${unread})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "perfil" && (
        <>
          {manage && !deleted && (
            <Panel
              title="Decisão sobre o perfil"
              eyebrow="REVISÃO"
              note={c.status_at ? `Última decisão ${lisbonDateTime(c.status_at)}${c.status_by ? ` por ${c.status_by}` : ""}${c.status_reason ? `: «${c.status_reason}»` : ""}.` : undefined}
            >
              {c.status === "draft" && (
                <p className="field-help">
                  O criador ainda não submeteu o perfil. Faltam: {ONBOARDING_STEPS.filter((s) => !data.steps[s.key]).map((s) => s.label).join(", ") || "só submeter"}.
                </p>
              )}
              <div className="form-actions" style={{ alignItems: "flex-start" }}>
                {decisions(c.status, restrictionOpen).map((d) =>
                  d.reason ? (
                    <details key={d.to} style={{ flex: "1 1 280px" }}>
                      <summary className={d.danger ? "danger-button" : "secondary-button"} style={{ display: "inline-block", cursor: "pointer" }}>{d.label}</summary>
                      <form action={setCreatorStatus} className="form-grid">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="status" value={d.to} />
                        <label className="wide">
                          Motivo (pelo menos 10 caracteres)
                          <textarea name="reason" rows={3} required minLength={10} maxLength={1000} />
                        </label>
                        {d.help && <p className="field-help wide">{d.help}</p>}
                        <div className="wide form-actions">
                          <button type="submit" className={d.danger ? "danger-button" : undefined}>{d.label}</button>
                        </div>
                      </form>
                    </details>
                  ) : (
                    <form key={d.to} action={setCreatorStatus}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="status" value={d.to} />
                      <button type="submit">{d.label}</button>
                    </form>
                  ),
                )}
                {!decisions(c.status, restrictionOpen).length && <p className="muted">Sem decisões possíveis neste estado.</p>}
              </div>
              {c.status === "pending_review" && (
                <p className="field-help" style={{ marginTop: 12 }}>Aprovar ou recusar envia um email ao criador. Confirme os dados, as redes e as lojas antes de decidir.</p>
              )}
            </Panel>
          )}

          <div className="two-col">
            <Panel title="Perfil" eyebrow="DADOS">
              {p ? (
                <dl style={dl}>
                  <Field label="Nome civil">{p.full_name}</Field>
                  <Field label="Nome artístico">{p.display_name}</Field>
                  <Field label="Localidade">{[p.city, p.district, p.country].filter(Boolean).join(", ")}</Field>
                  <Field label="Apresentação">{p.bio && <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.bio}</span>}</Field>
                  <Field label="Idiomas">{p.languages.map((l) => LANGUAGE_LABEL[l as keyof typeof LANGUAGE_LABEL] ?? l).join(", ")}</Field>
                  <Field label="Temas">
                    {p.categories.length > 0 && p.categories.map((k) => <span key={k} className="tag">{CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k}</span>)}
                  </Field>
                  <Field label="Formatos">
                    {p.formats.length > 0 && p.formats.map((k) => <span key={k} className="tag">{FORMAT_LABEL[k as keyof typeof FORMAT_LABEL] ?? k}</span>)}
                  </Field>
                  <Field label="Desloca-se até">{p.travel_radius_km ? `${num(p.travel_radius_km)} km` : null}</Field>
                  <Field label="Portefólio">
                    {p.portfolio_url && (
                      <a href={p.portfolio_url} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: "anywhere" }}>{p.portfolio_url}</a>
                    )}
                  </Field>
                  <Field label="Submetido">{p.submitted_at ? lisbonDateTime(p.submitted_at) : null}</Field>
                  <Field label="Atualizado">{lisbonDateTime(p.updated_at)}</Field>
                </dl>
              ) : (
                <p className="muted">{deleted ? "Os dados do perfil foram apagados." : "O criador ainda não preencheu o perfil."}</p>
              )}
              <p className="field-help" style={{ marginTop: 14 }}>
                Passos: {ONBOARDING_STEPS.map((s) => `${s.label} ${data.steps[s.key] ? "✓" : "✗"}`).join(" · ")}
              </p>
            </Panel>

            <div>
              <Panel title="Contactos e lojas" eyebrow="CONTACTO">
                <dl style={dl}>
                  <Field label="Email">{deleted ? null : c.email}</Field>
                  <Field label="Telemóvel">{data.contacts?.phone}</Field>
                  <Field label="WhatsApp">{data.contacts ? (data.contacts.whatsapp ? "Sim" : "Não") : null}</Field>
                  <Field label="Prefere">
                    {data.contacts?.preferred ? CONTACT_PREFERENCE_LABEL[data.contacts.preferred as keyof typeof CONTACT_PREFERENCE_LABEL] ?? data.contacts.preferred : null}
                  </Field>
                  <Field label="Lojas">
                    {data.stores.length > 0 && data.stores.map((s) => <span key={s.id} className="tag gold">{s.name}</span>)}
                  </Field>
                </dl>
              </Panel>

              <Panel title="Conta" eyebrow="ESTADO">
                <dl style={dl}>
                  <Field label="Estado">{CREATOR_STATUS_LABEL[c.status]}</Field>
                  <Field label="Email confirmado">{c.email_verified_at ? lisbonDateTime(c.email_verified_at) : "Por confirmar"}</Field>
                  <Field label="Maioridade declarada">{c.adult_declared_at ? lisbonDateTime(c.adult_declared_at) : null}</Field>
                  <Field label="Aviso de inatividade">{c.inactivity_warned_at ? lisbonDateTime(c.inactivity_warned_at) : null}</Field>
                  {deleted && (
                    <Field label="Apagada">
                      {lisbonDateTime(c.deleted_at)} · {DELETE_REASON_LABEL[c.delete_reason as keyof typeof DELETE_REASON_LABEL] ?? c.delete_reason}
                    </Field>
                  )}
                </dl>
              </Panel>
            </div>
          </div>

          <Panel title="Consentimentos atuais" eyebrow="RGPD" note="Cada consentimento fica gravado com o texto mostrado e a versão do documento. O histórico completo está em «Notas e histórico».">
            <div className="table-scroll" tabIndex={0} aria-label="Consentimentos atuais">
              <table className="left-table">
                <thead>
                  <tr>
                    <th>Finalidade</th>
                    <th>Estado</th>
                    <th>Data</th>
                    <th>Versão</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.consents.current).map(([purpose, v]) =>
                    v ? (
                      <tr key={purpose}>
                        <td>{CONSENT_LABEL[purpose as ConsentPurpose] ?? purpose}</td>
                        <td>{v.granted ? <span className="pill ok">Dado</span> : <span className="pill">Retirado</span>}</td>
                        <td>{lisbonDateTime(v.at)}</td>
                        <td>{v.document_id ? `v${docVersion.get(v.document_id) ?? "?"}` : "—"}</td>
                      </tr>
                    ) : null,
                  )}
                  {!Object.keys(data.consents.current).length && (
                    <tr>
                      <td colSpan={4} className="muted">Sem consentimentos registados.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {tab === "redes" && (
        <Panel
          title={`${data.social_accounts.length} ${data.social_accounts.length === 1 ? "rede" : "redes"}`}
          eyebrow="REDES E NÚMEROS"
          note="Os números da tabela são declarados pelo criador; validar exige a captura das estatísticas (chega com o PR2). Os «Dados públicos» são lidos da Meta com a autorização do criador (PR 3A). «Instagram ligado» chega com o PR 3B."
        >
          {!data.social_accounts.length && <p className="muted">O criador ainda não indicou redes.</p>}
          {data.social_accounts.map((a) => (
            <section key={a.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 14 }}>
              <h3 style={{ margin: "0 0 6px" }}>
                {PLATFORM_LABEL[a.platform] ?? a.platform} @{a.handle} <VerificationTag v={a.verification} />
              </h3>
              <small className="muted block">
                {a.profile_url ? (
                  <a href={a.profile_url} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: "anywhere" }}>{a.profile_url}</a>
                ) : (
                  "Sem endereço do perfil"
                )}{" "}
                · indicada {lisbonDate(a.created_at)} · atualizada {lisbonDate(a.updated_at)}
              </small>
              {a.shared_with > 0 && (
                <p className="notice" style={{ marginTop: 8 }}>
                  <span>
                    Atenção: {a.shared_with === 1 ? "outra conta declarou" : `${a.shared_with} outras contas declararam`} o mesmo @ nesta rede. Confirme quem é o
                    titular antes de aprovar.
                  </span>
                </p>
              )}
              <div className="table-scroll" tabIndex={0} aria-label={`Números de @${a.handle}`}>
                <table className="left-table">
                  <thead>
                    <tr>
                      <th>Declarado em</th>
                      <th>Seguidores</th>
                      <th>Visualizações médias</th>
                      <th>Gostos médios</th>
                      <th>Comentários médios</th>
                      <th>Público em Portugal</th>
                      <th>Interação</th>
                      <th>Validação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.metrics.map((m) => (
                      <tr key={m.id}>
                        <td>{lisbonDate(m.declared_on)}</td>
                        <td>{num(m.followers)}</td>
                        <td>{num(m.avg_views)}</td>
                        <td>{num(m.avg_likes)}</td>
                        <td>{num(m.avg_comments)}</td>
                        <td>{pct(m.pt_audience_pct)}</td>
                        <td>{pct(m.engagement_pct)}</td>
                        <td>
                          {m.validated_at ? (
                            <>
                              <span className="pill ok">Validado</span>
                              <small className="muted block">{lisbonDate(m.validated_at)}{m.validated_by ? ` · ${m.validated_by}` : ""}</small>
                            </>
                          ) : (
                            <span className="muted">Declarado</span>
                          )}
                          {manage && !deleted && (m.validated_at || m.evidence_file_id) && (
                            <form action={validateCreatorMetric} style={{ marginTop: 4 }}>
                              <input type="hidden" name="id" value={c.id} />
                              <input type="hidden" name="metric_id" value={m.id} />
                              <input type="hidden" name="ok" value={m.validated_at ? "0" : "1"} />
                              <button type="submit" className="secondary-button">{m.validated_at ? "Retirar validação" : "Validar"}</button>
                            </form>
                          )}
                          {!m.validated_at && !m.evidence_file_id && <small className="muted block">Sem captura</small>}
                        </td>
                      </tr>
                    ))}
                    {!a.metrics.length && (
                      <tr>
                        <td colSpan={8} className="muted">Sem números declarados.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {a.platform === "instagram" && pub?.account?.account_id === a.id && pub.account.state && (
                <PublicBlock p={pub.account} creatorId={c.id} manage={manage && !deleted} requests={withdrawalRequests} />
              )}
              {a.platform === "instagram" && pub && !pub.account?.state && withdrawalRequests.length > 0 && (
                <p className="field-help" style={{ marginTop: 8 }}>Sem leitura dos dados públicos nesta conta: não há nada para parar.</p>
              )}
            </section>
          ))}
        </Panel>
      )}

      {tab === "pagamentos" && (
        <div className="two-col">
          <Panel
            title="Dados de pagamento"
            eyebrow="RESUMO (SEM DADOS COMPLETOS)"
            note="O IBAN e os dados fiscais estão cifrados. Só quem tem Finanças os revela, com motivo e palavra-passe; cada revelação fica registada. Os pagamentos registados chegam com o PR2."
          >
            {!f ? (
              <p className="muted">O criador ainda não indicou dados de pagamento.</p>
            ) : (
              <>
                <dl style={dl}>
                  <Field label="Dados fiscais">{f.fiscal_complete ? <span className="pill ok">Completos</span> : <span className="pill warn">Incompletos</span>}</Field>
                  <Field label="IBAN">{f.iban_last4 ? `${f.iban_country || ""} ${ibanTail(f.iban_last4)}` : "Sem IBAN confirmado"}</Field>
                  <Field label="IBAN mudado em">{f.iban_changed_at ? lisbonDateTime(f.iban_changed_at) : null}</Field>
                  <Field label="Titular">
                    {f.iban_last4 ? (f.iban_holder_mismatch ? <span className="pill warn">Diferente do nome fiscal</span> : "Igual ao nome fiscal") : null}
                  </Field>
                  <Field label="IBAN novo">
                    {f.iban_pending_last4
                      ? `${ibanTail(f.iban_pending_last4)}, por confirmar pelo titular desde ${lisbonDateTime(f.iban_pending_at)}${f.iban_pending_holder_mismatch ? " (titular diferente do nome fiscal)" : ""}`
                      : null}
                  </Field>
                  <Field label="Atualizado">{lisbonDateTime(f.updated_at)}</Field>
                </dl>
                {f.iban_hold && f.iban_hold_until && (
                  <div className="notice" role="status" style={{ marginTop: 14 }}>
                    <span>
                      IBAN alterado há {Math.max(0, Math.round((now - Date.parse(f.iban_changed_at || f.iban_hold_until)) / 3_600_000))} h: confirme-o com o criador por
                      telefone antes de pagar. A espera termina a {lisbonDateTime(f.iban_hold_until)}.
                    </span>
                  </div>
                )}
              </>
            )}
          </Panel>
          <Panel title="Revelar" eyebrow="FINANÇAS">
            {!data.viewer.finance ? (
              <p className="muted">Só quem tem a permissão Finanças revela o IBAN e os dados fiscais. Peça-a ao Super Admin, se precisar.</p>
            ) : !f ? (
              <p className="muted">Nada para revelar.</p>
            ) : (
              <RevealFinance creatorId={c.id} hold={f.iban_hold} holdUntil={f.iban_hold_until ? lisbonDateTime(f.iban_hold_until) : null} />
            )}
            <h3 style={{ marginTop: 18 }}>Histórico</h3>
            <ul style={{ paddingLeft: 18 }}>
              {data.audit
                .filter((a) => a.action.startsWith("finance."))
                .slice(0, 30)
                .map((a) => (
                  <li key={a.id}>
                    {lisbonDateTime(a.created_at)} · {AUDIT_ACTION_LABEL[a.action] ?? a.action}
                    {a.staff ? ` · ${a.staff}` : ""}
                    {auditSummary(a.details) ? <small className="muted"> · {auditSummary(a.details)}</small> : null}
                  </li>
                ))}
              {!data.audit.some((a) => a.action.startsWith("finance.")) && <li className="muted">Sem registos.</li>}
            </ul>
          </Panel>
        </div>
      )}

      {tab === "mensagens" && (
        <Panel title="Mensagens" eyebrow="CONVERSA" note="O criador vê estas mensagens na plataforma e recebe um aviso por email (sem o texto), no máximo um a cada 15 minutos.">
          <Messages items={messages} />
          {manage && !deleted ? (
            <form action={sendCreatorMessage} className="form-grid">
              <input type="hidden" name="id" value={c.id} />
              <label className="wide">
                Nova mensagem
                <textarea name="body" rows={4} required maxLength={4000} />
              </label>
              <div className="wide form-actions">
                <button type="submit">Enviar mensagem</button>
              </div>
            </form>
          ) : !manage ? (
            <p className="field-help" style={{ marginTop: 14 }}>Com «Consultar», pode ler as mensagens mas não responder.</p>
          ) : null}
        </Panel>
      )}

      {tab === "notas" && (
        <>
          <div className="two-col">
            <Panel title="Notas internas" eyebrow="EQUIPA" note="Atenção: o criador pode pedir acesso a estas notas (RGPD, art. 15.º). Escreva só factos, com respeito.">
              {manage && !deleted && (
                <form action={addCreatorNote} className="form-grid" style={{ marginTop: 0 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <label className="wide">
                    Nova nota
                    <textarea name="body" rows={3} required maxLength={4000} />
                  </label>
                  <div className="wide form-actions">
                    <button type="submit" className="secondary-button">Guardar nota</button>
                  </div>
                </form>
              )}
              <ul style={{ listStyle: "none", padding: 0, marginTop: 14 }}>
                {data.notes.map((n) => (
                  <li key={n.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
                    <small className="muted block">{lisbonDateTime(n.created_at)}{n.author ? ` · ${n.author}` : ""}</small>
                    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.body}</span>
                  </li>
                ))}
                {!data.notes.length && <li className="muted">Sem notas.</li>}
              </ul>
            </Panel>

            <Panel title="Pedidos RGPD" eyebrow="PRIVACIDADE" note="Os pedidos respondem-se em Privacidade. Prazo: um mês a contar da receção (prorrogável uma vez, com motivo).">
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {data.privacy_requests.map((r) => (
                  <li key={r.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
                    <strong>{PRIVACY_KIND_LABEL[r.kind] ?? r.kind}</strong> <PrivacyPill status={r.status} overdue={r.status === "open" && Date.parse(r.effective_due) < now} />
                    <small className="muted block">
                      {PRIVACY_CHANNEL_LABEL[r.channel] ?? r.channel} · recebido {lisbonDate(r.received_at)} ·{" "}
                      {r.status === "open" ? `prazo ${lisbonDate(r.effective_due)}${r.extended_until ? " (prorrogado)" : ""}` : `fechado ${lisbonDate(r.handled_at)}`} ·{" "}
                      {r.identity_checked ? "identidade confirmada" : "identidade por confirmar"}
                    </small>
                    {r.details && <small className="block" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.details}</small>}
                  </li>
                ))}
                {!data.privacy_requests.length && <li className="muted">Sem pedidos.</li>}
              </ul>
              <p style={{ marginTop: 12 }}>
                <Link href="/influenciadores/privacidade">Ver em Privacidade</Link>
                {manage && !deleted && (
                  <>
                    {" · "}
                    <Link href={`/influenciadores/privacidade?criador=${c.id}#registar`}>Registar um pedido recebido por email</Link>
                  </>
                )}
              </p>

              {manage && !deleted && (
                <div className="danger-zone" style={{ display: "block" }}>
                  <h3 style={{ margin: "0 0 6px" }}>Exportar os dados (pedido de acesso ou portabilidade)</h3>
                  {exportRequests.length ? (
                    <form action={`/api/influenciadores/export/${c.id}`} method="post" className="inline-form">
                      <label>
                        Pedido
                        <select name="request_id" required>
                          {exportRequests.map((r) => (
                            <option key={r.id} value={r.id}>
                              {PRIVACY_KIND_LABEL[r.kind]} · recebido {lisbonDate(r.received_at)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className="secondary-button">Descarregar JSON</button>
                    </form>
                  ) : (
                    <p className="field-help">
                      Precisa de um pedido de acesso ou portabilidade aberto e com a identidade confirmada. Peça primeiro à pessoa que use «Descarregar os meus dados» na
                      plataforma (tem reautenticação); se não conseguir entrar, registe o pedido e confirme a identidade.
                    </p>
                  )}
                  <p className="field-help">
                    O ficheiro não leva o IBAN, os dados fiscais nem moradas completos. Envie-o só para o email da conta ({c.email}) e feche o pedido com a resposta.
                  </p>
                </div>
              )}

              {isSuper && !deleted && (
                <div className="danger-zone" style={{ display: "block" }}>
                  <h3 style={{ margin: "0 0 6px" }}>Apagar a conta (Super Admin)</h3>
                  {data.delete_blocker && (
                    <p className="notice">
                      <span>Bloqueio: {data.delete_blocker}</span>
                    </p>
                  )}
                  {erasureRequests.length ? (
                    <form action={deleteCreatorAccount} className="form-grid">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="mode" value="request" />
                      <label className="wide">
                        Pedido de apagamento
                        <select name="request_id" required>
                          {erasureRequests.map((r) => (
                            <option key={r.id} value={r.id}>
                              {PRIVACY_CHANNEL_LABEL[r.channel]} · recebido {lisbonDate(r.received_at)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="wide">
                        Nota (opcional)
                        <input name="reason" maxLength={1000} />
                      </label>
                      <label className="check wide">
                        <input type="checkbox" name="confirm" required />
                        <span>Confirmo: anonimiza a conta, termina as sessões e não se pode desfazer. Ficam os pagamentos, as licenças em vigor e os consentimentos (prova).</span>
                      </label>
                      <div className="wide form-actions">
                        <button type="submit" className="danger-button">Apagar a conta</button>
                      </div>
                    </form>
                  ) : (
                    <p className="field-help">Para apagar, é preciso um pedido de apagamento aberto, feito na plataforma ou registado em Privacidade com a identidade confirmada.</p>
                  )}

                  <details style={{ marginTop: 14 }}>
                    <summary className="danger-button" style={{ display: "inline-block", cursor: "pointer" }}>Apagar (menor de idade)</summary>
                    <form action={deleteCreatorAccount} className="form-grid">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="mode" value="minor" />
                      <label className="wide">
                        Motivo (pelo menos 10 caracteres)
                        <textarea name="reason" rows={2} required minLength={10} maxLength={1000} placeholder="Ex.: documento mostra que tem 16 anos" />
                      </label>
                      <label className="check wide">
                        <input type="checkbox" name="confirm" required />
                        <span>
                          Confirmo que esta pessoa é menor de idade. Apaga já, sem esperar pelo fim de colaborações nem por um pedido, e fica registado como «menor de
                          idade».
                        </span>
                      </label>
                      <div className="wide form-actions">
                        <button type="submit" className="danger-button">Apagar por ser menor</button>
                      </div>
                    </form>
                  </details>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Histórico de consentimentos" eyebrow="PROVA" note="Só de acrescento: cada linha guarda o texto exato que a pessoa viu.">
            <div className="table-scroll" tabIndex={0} aria-label="Histórico de consentimentos">
              <table className="left-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Finalidade</th>
                    <th>Estado</th>
                    <th>Texto mostrado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.consents.history.map((h) => (
                    <tr key={h.id}>
                      <td>{lisbonDateTime(h.created_at)}</td>
                      <td>
                        {CONSENT_LABEL[h.purpose] ?? h.purpose}
                        {h.document_version && <small className="muted block">v{h.document_version}</small>}
                      </td>
                      <td>{h.granted ? "Dado" : "Retirado"}</td>
                      <td style={{ maxWidth: 520, overflowWrap: "anywhere" }}>{h.text_shown}</td>
                    </tr>
                  ))}
                  {!data.consents.history.length && (
                    <tr>
                      <td colSpan={4} className="muted">Sem registos.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Auditoria" eyebrow="HISTÓRICO" note="As últimas 100 ações sobre esta conta (sem as consultas da ficha). Só de acrescento.">
            <div className="table-scroll" tabIndex={0} aria-label="Auditoria">
              <table className="left-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Ação</th>
                    <th>Quem</th>
                    <th>Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((a) => (
                    <tr key={a.id}>
                      <td>{lisbonDateTime(a.created_at)}</td>
                      <td>{AUDIT_ACTION_LABEL[a.action] ?? a.action}</td>
                      <td>{a.actor_kind === "staff" ? a.staff || "Equipa" : a.actor_kind === "creator" ? "Criador" : "Sistema"}</td>
                      <td className="muted" style={{ maxWidth: 420, overflowWrap: "anywhere" }}>{auditSummary(a.details) || "—"}</td>
                    </tr>
                  ))}
                  {!data.audit.length && (
                    <tr>
                      <td colSpan={4} className="muted">Sem registos.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </CreatorsShell>
  );
}
