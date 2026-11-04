import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import { Flash, PageHeading } from "@/components/shell";
import { crLegalList, crPrivacyList, type CrPrivacyRequestRow } from "@/lib/criadores/db";
import {
  LEGAL_KIND_LABEL, LEGAL_STATUS_LABEL, lisbonDate, lisbonDateTime, PRIVACY_CHANNEL_LABEL, PRIVACY_KIND_LABEL,
} from "@/lib/criadores-rules";
import { canManageCreators } from "@/lib/permissions";
import { requireCreatorsViewer } from "@/lib/viewer";
import { registerPrivacyRequest, updatePrivacyRequest } from "../actions";
import { creatorsError, creatorsMessage } from "../messages";
import { CreatorsShell, num, PrivacyPill } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacidade · Influenciadores · Loja do Ouro" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = [
  ["open", "Abertos"],
  ["all", "Todos"],
  ["done", "Respondidos"],
  ["refused", "Recusados"],
] as const;
type View = (typeof VIEWS)[number][0];
const lisbonDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(d);

function Requester({ r }: { r: CrPrivacyRequestRow }) {
  if (r.creator_id)
    return (
      <>
        <Link href={`/influenciadores/criadores/${r.creator_id}?tab=notas`}>
          <strong>{r.creator_deleted ? "Conta apagada" : r.creator_name || "Sem nome"}</strong>
        </Link>
        {!r.creator_deleted && r.creator_email && <small className="muted block">{r.creator_email}</small>}
        {r.requester && <small className="muted block">Pedido por: {r.requester}</small>}
      </>
    );
  return (
    <>
      <strong>Sem conta</strong>
      <small className="muted block">{r.requester || "—"}</small>
    </>
  );
}

function RequestActions({ r, back, now }: { r: CrPrivacyRequestRow; back: string; now: number }) {
  const canExtend = !r.extended_until && Date.parse(r.due_at) > now;
  return (
    <details>
      <summary className="secondary-button" style={{ display: "inline-block", cursor: "pointer" }}>Tratar</summary>
      <div style={{ minWidth: 300 }}>
        <form action={updatePrivacyRequest} className="inline-form" style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="op" value="identity" />
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="identity_ok" value={r.identity_checked ? "0" : "1"} />
          <button type="submit" className="secondary-button">{r.identity_checked ? "Desmarcar a identidade" : "Identidade confirmada"}</button>
        </form>
        <p className="field-help">
          Confirme a identidade quando o pedido vem do email da conta, ou quando a pessoa respondeu a uma mensagem enviada para esse email.
        </p>
        {canExtend && (
          <form action={updatePrivacyRequest} className="form-grid">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="op" value="extend" />
            <input type="hidden" name="back" value={back} />
            <label className="wide">
              Prorrogar até 2 meses (motivo, enviado ao titular)
              <textarea name="extend_reason" rows={2} required minLength={10} maxLength={1000} placeholder="Ex.: pedido complexo, com várias colaborações a rever" />
            </label>
            <div className="wide form-actions">
              <button type="submit" className="secondary-button">Prorrogar o prazo</button>
            </div>
          </form>
        )}
        <form action={updatePrivacyRequest} className="form-grid">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="op" value="close" />
          <input type="hidden" name="back" value={back} />
          <label className="wide">
            Resposta dada ao titular
            <textarea name="response" rows={3} required minLength={5} maxLength={4000} />
          </label>
          <label>
            Resultado
            <select name="status" defaultValue="done">
              <option value="done">Respondido</option>
              <option value="refused">Recusado (com fundamento)</option>
            </select>
          </label>
          <div className="wide form-actions">
            <button type="submit">Fechar o pedido</button>
            <small>Se tiver conta, o titular recebe a resposta por email.</small>
          </div>
        </form>
      </div>
    </details>
  );
}

export default async function CreatorsPrivacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireCreatorsViewer("view");
  const sp = await searchParams;
  const view: View = VIEWS.some(([k]) => k === sp.estado) ? (sp.estado as View) : "open";
  const creatorId = typeof sp.criador === "string" && UUID.test(sp.criador) ? sp.criador : "";
  const manage = canManageCreators(viewer);
  const [requests, docs] = await Promise.all([
    crPrivacyList(viewer.session, view === "all" ? "all" : view).catch(() => null),
    crLegalList(viewer.session).catch(() => null),
  ]);
  const now = Date.now();
  const back = `/influenciadores/privacidade${view === "open" ? "" : `?estado=${view}`}`;
  const today = new Date();
  const minDay = lisbonDay(new Date(today.getTime() - 29 * 86_400_000));

  return (
    <CreatorsShell viewer={viewer} current="influenciadores-privacidade" title="Privacidade">
      <PageHeading
        eyebrow="INFLUENCIADORES"
        title="Privacidade (RGPD)"
        text="Pedidos dos titulares: acesso, portabilidade, retificação, apagamento, oposição, limitação e revisão humana. Resposta em um mês a contar da receção, prorrogável uma vez por mais dois, com aviso."
      />
      <Flash ok={creatorsMessage(sp)} error={creatorsError(sp)} />

      <nav className="segmented" aria-label="Estado dos pedidos" style={{ marginBottom: 18 }}>
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={k === "open" ? "/influenciadores/privacidade" : `/influenciadores/privacidade?estado=${k}`} className={view === k ? "active" : ""} aria-current={view === k ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      <Panel
        title={requests ? `${num(requests.length)} ${requests.length === 1 ? "pedido" : "pedidos"}` : "Pedidos"}
        eyebrow="PEDIDOS"
        note="Exportar e apagar fazem-se na ficha do criador (separador «Notas e histórico»). Os pedidos ficam guardados 5 anos."
      >
        {!requests ? (
          <div className="notice error-notice">Pedidos indisponíveis (falta a atualização da base de dados?).</div>
        ) : (
          <div className="table-scroll" tabIndex={0} aria-label="Pedidos RGPD">
            <table className="left-table">
              <thead>
                <tr>
                  <th>Titular</th>
                  <th>Pedido</th>
                  <th>Recebido</th>
                  <th>Prazo</th>
                  <th>Estado</th>
                  {manage && <th />}
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const overdue = r.status === "open" && Date.parse(r.effective_due) < now;
                  return (
                    <tr key={r.id}>
                      <td><Requester r={r} /></td>
                      <td>
                        <strong>{PRIVACY_KIND_LABEL[r.kind] ?? r.kind}</strong>
                        <small className="muted block">{PRIVACY_CHANNEL_LABEL[r.channel] ?? r.channel}</small>
                        {r.details && <small className="block" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 360 }}>{r.details}</small>}
                        {r.response && (
                          <small className="muted block" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxWidth: 360 }}>
                            Resposta: {r.response}
                          </small>
                        )}
                      </td>
                      <td>{lisbonDate(r.received_at)}</td>
                      <td>
                        {lisbonDate(r.effective_due)}
                        {r.extended_until && (
                          <small className="muted block" title={r.extension_reason || undefined}>Prorrogado (era {lisbonDate(r.due_at)})</small>
                        )}
                      </td>
                      <td>
                        <PrivacyPill status={r.status} overdue={overdue} />
                        <small className="muted block">{r.identity_checked ? "Identidade confirmada" : "Identidade por confirmar"}</small>
                        {r.handled_at && <small className="muted block">{lisbonDateTime(r.handled_at)}{r.handled_by ? ` · ${r.handled_by}` : ""}</small>}
                      </td>
                      {manage && <td>{r.status === "open" && <RequestActions r={r} back={back} now={now} />}</td>}
                    </tr>
                  );
                })}
                {!requests.length && (
                  <tr>
                    <td colSpan={manage ? 6 : 5} className="muted">{view === "open" ? "Não há pedidos abertos." : "Sem pedidos."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {manage && (
        <Panel title="Registar um pedido recebido" eyebrow="POR EMAIL OU DE UM TERCEIRO" id="registar">
          <p className="field-help">
            Pedidos de acesso por email: responda primeiro a pedir que use «Descarregar os meus dados» na plataforma (tem reautenticação). Se a pessoa não
            conseguir entrar, registe aqui o pedido, confirme a identidade e exporte na ficha; envie o ficheiro só para o email da conta.
          </p>
          <form action={registerPrivacyRequest} className="form-grid">
            <input type="hidden" name="back" value={`${back}${creatorId ? `${back.includes("?") ? "&" : "?"}criador=${creatorId}` : ""}#registar`} />
            {creatorId ? (
              <p className="wide">
                <input type="hidden" name="creator_id" value={creatorId} />
                Titular: <Link href={`/influenciadores/criadores/${creatorId}?tab=notas`}>a conta da ficha de onde veio</Link> ·{" "}
                <Link href="/influenciadores/privacidade#registar">outra pessoa</Link>
              </p>
            ) : (
              <label>
                Email da conta (se a pessoa tiver conta)
                <input name="creator_email" type="email" maxLength={254} autoComplete="off" />
              </label>
            )}
            <label>
              Quem fez o pedido {creatorId ? "(se não foi o titular)" : "(obrigatório sem conta: nome e contacto)"}
              <input name="requester" maxLength={300} placeholder="Ex.: Maria Silva, maria@exemplo.pt" />
            </label>
            <label>
              Tipo de pedido
              <select name="kind" required defaultValue="">
                <option value="" disabled>Escolha…</option>
                {Object.entries(PRIVACY_KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Como chegou
              <select name="channel" defaultValue="email">
                <option value="email">Por email</option>
                <option value="staff">Por outro meio (loja, telefone, carta)</option>
              </select>
            </label>
            <label>
              Recebido em (até 30 dias atrás)
              <input name="received_on" type="date" min={minDay} max={lisbonDay(today)} defaultValue={lisbonDay(today)} required />
            </label>
            <label className="wide">
              O que foi pedido
              <textarea name="details" rows={3} maxLength={4000} />
            </label>
            <label className="check wide">
              <input type="checkbox" name="identity_ok" />
              <span>Identidade confirmada (o pedido veio do email da conta ou a pessoa respondeu a uma mensagem enviada para esse email).</span>
            </label>
            <div className="wide form-actions">
              <button type="submit">Registar pedido</button>
              <small>O prazo de um mês conta a partir da data de receção.</small>
            </div>
          </form>
        </Panel>
      )}

      <Panel title="Documentos aceites por versão" eyebrow="PROVA" note="Termos: aceitação. Política de Privacidade: tomada de conhecimento (não se aceita, é informação).">
        {!docs ? (
          <div className="notice error-notice">Documentos indisponíveis.</div>
        ) : (
          <div className="table-scroll" tabIndex={0} aria-label="Documentos aceites por versão">
            <table className="left-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Versão</th>
                  <th>Estado</th>
                  <th>Publicado</th>
                  <th>Pessoas</th>
                </tr>
              </thead>
              <tbody>
                {docs
                  .filter((d) => d.status !== "draft")
                  .map((d) => (
                    <tr key={d.id}>
                      <td>{LEGAL_KIND_LABEL[d.kind] ?? d.kind}</td>
                      <td>v{d.version}</td>
                      <td><span className={d.status === "published" ? "pill ok" : "pill"}>{LEGAL_STATUS_LABEL[d.status]}</span></td>
                      <td>{d.published_at ? lisbonDate(d.published_at) : "—"}</td>
                      <td>{num(d.accepted_count)}</td>
                    </tr>
                  ))}
                {!docs.some((d) => d.status !== "draft") && (
                  <tr>
                    <td colSpan={5} className="muted">Ainda não há documentos publicados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </CreatorsShell>
  );
}
