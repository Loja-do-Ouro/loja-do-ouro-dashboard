import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canManageAuction, homePath } from "@/lib/permissions";
import { aucEventGet, aucOverview } from "@/lib/leilao/db";
import {
  authorityNoticeDeadline, EVENT_STATUS, eur, isoToLisbonInput, lisbonDateTime, lotPhase, PHASE_LABEL,
} from "@/lib/leilao-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { importLot, saveEvent, setLotStatus } from "../actions";
import { auctionMessage } from "../messages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leilão · Loja do Ouro" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AuctionEventPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  if (!canManageAuction(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const q = await searchParams;
  const [data, overview] = await Promise.all([aucEventGet(viewer.session, id).catch(() => null), aucOverview(viewer.session).catch(() => null)]);
  if (!data) notFound();
  const { event: e, lots } = data;
  const s = overview?.settings;
  const now = new Date();
  const active = lots.filter((l) => l.status !== "withdrawn");
  const noticeNeeded = s && s.authority_notice_days > 0 && lots.some((l) => l.condition === "used");

  return (
    <AppShell viewer={viewer} current="leilao" title="Leilão">
      <PageHeading eyebrow="LEILÃO" title={e.title} text={`leilao.lojadoouro.pt/${e.slug} · ${EVENT_STATUS[e.status]} · abre ${lisbonDateTime(e.opens_at)}`}>
        <Link className="outline-button" href="/leilao">← Todos os leilões</Link>
      </PageHeading>
      <Flash ok={auctionMessage(q.ok)} error={typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined} />

      {noticeNeeded && !e.authority_notice_at && (
        <div className="notice">
          Leilão com peças usadas: se o advogado confirmar a obrigação (RJOC, art. 65.º), comunique-o à ASAE e à INCM até{" "}
          <strong>{authorityNoticeDeadline(e.opens_at, s!.authority_notice_days)}</strong> ({s!.authority_notice_days} dias antes da abertura) e registe a data abaixo.
        </div>
      )}

      <Panel title={`${active.length} ${active.length === 1 ? "lote" : "lotes"}`} eyebrow="LOTES" note="Fecho escalonado: cada lote fecha depois do anterior; licitações no fim prolongam só esse lote. O máximo secreto de cada líder só aparece aqui, para a equipa.">
        <div className="table-scroll" tabIndex={0} aria-label="Lotes do leilão">
          <table className="left-table">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Peça</th>
                <th>Base / reserva</th>
                <th>Licitação atual</th>
                <th>Fecho</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => {
                const phase = lotPhase(l, e, now, s?.ending_soon_minutes);
                return (
                  <tr key={l.id}>
                    <td>{l.position}</td>
                    <td>
                      <div className="product-cell">
                        {l.images[0] && <img className="product-thumb" src={`${l.images[0]}${l.images[0].includes("?") ? "&" : "?"}width=96`} alt="" width={48} height={48} />}
                        <span>
                          <Link href={`/leilao/${e.id}/lote/${l.id}`}><strong>{l.title}</strong></Link>
                          <small className="muted block">{[l.metal, l.fineness, l.weight_g ? `${String(l.weight_g).replace(".", ",")} g` : null, l.condition === "used" ? "usado" : "novo"].filter(Boolean).join(" · ")}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      {eur(l.start_price)}
                      <small className="muted block">{l.reserve_price ? `Reserva ${eur(l.reserve_price)}` : "Sem reserva"}</small>
                    </td>
                    <td>
                      {l.current_price !== null ? eur(l.current_price) : "—"}
                      {l.leader_alias && <small className="muted block">{l.leader_alias} · máx. {eur(l.leader_max)}</small>}
                      {!!l.bid_count && <small className="muted block">{l.bid_count} licitações · {l.bidder_count} pessoas</small>}
                    </td>
                    <td>
                      {lisbonDateTime(l.close_at)}
                      {!!l.extensions && <small className="muted block">Prolongado {l.extensions}×</small>}
                    </td>
                    <td>
                      <span className={`pill${phase === "open" || phase === "closed_sold" ? " ok" : phase === "ending" ? " warn" : ""}`}>{PHASE_LABEL[phase]}</span>
                    </td>
                    <td>
                      {l.status === "draft" && (
                        <form action={setLotStatus} className="row-action">
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="event_id" value={e.id} />
                          <input type="hidden" name="status" value="ready" />
                          <input type="hidden" name="from" value="event" />
                          <button type="submit" className="secondary-button">Marcar pronto</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!lots.length && (
                <tr>
                  <td colSpan={7} className="muted">Ainda sem lotes. Junte o primeiro a partir de um produto da loja.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="two-col admin-layout">
        <Panel title="Juntar lote" eyebrow="A PARTIR DA LOJA" id="lote">
          <form action={importLot} className="form-grid">
            <input type="hidden" name="event_id" value={e.id} />
            <label className="wide">
              Produto na loja (endereço ou handle)
              <input name="product" required maxLength={500} placeholder="https://www.lojadoouro.pt/products/…" spellCheck={false} />
            </label>
            <label>
              Base de licitação (€)
              <input name="start_price" required inputMode="decimal" placeholder="1500" />
            </label>
            <label>
              Estado da peça
              <select name="condition" defaultValue="used">
                <option value="used">Usada</option>
                <option value="new">Nova</option>
              </select>
            </label>
            <p className="field-help wide">
              Vem da loja: título, descrição e fotografias (CDN do Shopify) e, quando estão escritos, metal, toque e peso. O lote fica em rascunho para completar
              a informação obrigatória (marcação, gemas, estado), a reserva e a caução.
            </p>
            <div className="wide form-actions">
              <button type="submit">Juntar lote</button>
            </div>
          </form>
        </Panel>

        <Panel title="Leilão" eyebrow="DATAS E PUBLICAÇÃO">
          <form action={saveEvent} className="form-grid">
            <input type="hidden" name="id" value={e.id} />
            <label className="wide">
              Título
              <input name="title" required maxLength={160} defaultValue={e.title} />
            </label>
            <label>
              Endereço
              <input name="slug" required maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={e.slug} spellCheck={false} />
            </label>
            <label>
              Estado
              <select name="status" defaultValue={e.status}>
                <option value="draft">Rascunho (não aparece no site)</option>
                <option value="published">Publicado</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </label>
            <label>
              Abertura (hora de Lisboa)
              <input name="opens_at" type="datetime-local" required defaultValue={isoToLisbonInput(e.opens_at)} />
            </label>
            <label>
              Fecho do 1.º lote
              <input name="first_close_at" type="datetime-local" required defaultValue={isoToLisbonInput(e.first_close_at)} />
            </label>
            <label>
              Intervalo entre lotes (s)
              <input name="stagger_seconds" type="number" min={0} max={3600} defaultValue={e.stagger_seconds} />
            </label>
            <label>
              Comunicado à ASAE/INCM em
              <input name="authority_notice_at" type="date" defaultValue={e.authority_notice_at || ""} />
            </label>
            <label className="wide">
              Apresentação
              <textarea name="intro" rows={4} maxLength={4000} defaultValue={e.intro} />
            </label>
            <p className="field-help wide">
              Publicado: aparece no site e os lotes prontos abrem à hora de abertura. Mudar as datas move os fechos dos lotes que ainda não têm licitações.
            </p>
            <div className="wide form-actions">
              <button type="submit">Guardar leilão</button>
            </div>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
