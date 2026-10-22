import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canManageAuction, homePath } from "@/lib/permissions";
import { aucEventGet, aucLotBids, aucOverview } from "@/lib/leilao/db";
import { BID_KIND, depositFor, eur, lisbonDateTime, lotPhase, minNextBid, PHASE_LABEL } from "@/lib/leilao-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveLot, setLotStatus } from "../../../actions";
import { auctionMessage } from "../../../messages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lote · Leilão · Loja do Ouro" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (n: number | null) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

export default async function AuctionLotPage({
  params, searchParams,
}: {
  params: Promise<{ id: string; lotId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  if (!canManageAuction(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const { id, lotId } = await params;
  if (!UUID.test(id) || !UUID.test(lotId)) notFound();
  const q = await searchParams;
  const [data, overview, bids] = await Promise.all([
    aucEventGet(viewer.session, id).catch(() => null),
    aucOverview(viewer.session).catch(() => null),
    aucLotBids(viewer.session, lotId).catch(() => []),
  ]);
  const lot = data?.lots.find((l) => l.id === lotId);
  if (!data || !lot || !overview) notFound();
  const e = data.event;
  const s = overview.settings;
  const phase = lotPhase(lot, e, new Date(), s.ending_soon_minutes);
  const locked = lot.bid_count > 0;
  const closed = lot.status === "closed";
  const deposit = depositFor(lot, s);
  const base = (status: string, extra?: React.ReactNode) => (
    <>
      <input type="hidden" name="id" value={lot.id} />
      <input type="hidden" name="event_id" value={e.id} />
      <input type="hidden" name="status" value={status} />
      {extra}
    </>
  );

  return (
    <AppShell viewer={viewer} current="leilao" title="Leilão">
      <PageHeading eyebrow={`${e.title.toUpperCase()} · LOTE ${lot.position}`} title={lot.title} text={`${PHASE_LABEL[phase]} · fecha ${lisbonDateTime(lot.close_at)}${lot.extensions ? ` (prolongado ${lot.extensions}×)` : ""}`}>
        <Link className="outline-button" href={`/leilao/${e.id}`}>← {e.title}</Link>
      </PageHeading>
      <Flash ok={auctionMessage(q.ok)} error={typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined} />

      <div className="three-col">
        <article className="kpi">
          <div className="eyebrow">Licitação atual</div>
          <div className="kpi-value">{lot.current_price !== null ? eur(lot.current_price) : "—"}</div>
          <p>{lot.leader_alias ? `${lot.leader_alias} (${lot.leader_email}) · máximo secreto ${eur(lot.leader_max)}` : `Ainda sem licitações · base ${eur(lot.start_price)}`}</p>
        </article>
        <article className="kpi">
          <div className="eyebrow">Próxima licitação mínima</div>
          <div className="kpi-value">{closed ? "—" : eur(minNextBid(lot, s.increments))}</div>
          <p>{lot.reserve_price ? (lot.current_price !== null && lot.current_price >= lot.reserve_price ? "Reserva atingida" : `Reserva ${eur(lot.reserve_price)} (não divulgada)`) : "Sem preço de reserva"}</p>
        </article>
        <article className="kpi">
          <div className="eyebrow">{closed ? "Resultado" : "Caução"}</div>
          <div className="kpi-value">{closed ? (lot.result === "sold" ? "Vendido" : "Não vendido") : deposit ? eur(deposit) : "Sem caução"}</div>
          <p>{closed ? (lot.payment_due_at ? `Pagamento até ${lisbonDateTime(lot.payment_due_at)}` : "Sem vencedor") : `${lot.bid_count} licitações · ${lot.bidder_count} pessoas`}</p>
        </article>
      </div>

      {!closed && (
        <div className="form-actions">
          {lot.status === "draft" && (
            <form action={setLotStatus}>{base("ready")}<button type="submit">Marcar pronto a licitar</button></form>
          )}
          {lot.status === "ready" && !locked && (
            <form action={setLotStatus}>{base("draft")}<button type="submit" className="secondary-button">Voltar a rascunho</button></form>
          )}
          {lot.status !== "withdrawn" && (
            <form action={setLotStatus} className="row-action knowledge-row">
              {base("withdrawn")}
              <label className="checkbox-label"><input type="checkbox" name="confirm" required /> Confirmo</label>
              <button type="submit" className="danger-button">Retirar lote</button>
            </form>
          )}
        </div>
      )}

      <div className="two-col admin-layout">
        <Panel title="Ficha do lote" eyebrow={locked ? "COM LICITAÇÕES: SÓ TEXTOS E FOTOGRAFIAS" : "PEÇA E PREÇOS"}>
          <form action={saveLot} className="form-grid">
            <input type="hidden" name="id" value={lot.id} />
            <input type="hidden" name="event_id" value={e.id} />
            <input type="hidden" name="shopify_handle" value={lot.shopify_handle || ""} />
            <input type="hidden" name="shopify_product_id" value={lot.shopify_product_id || ""} />
            {locked && <input type="hidden" name="locked" value="1" />}
            <label className="wide">
              Título
              <input name="title" required maxLength={200} defaultValue={lot.title} disabled={closed} />
            </label>
            <label>
              N.º do lote
              <input name="position" type="number" min={1} max={9999} defaultValue={lot.position} disabled={locked || closed} />
            </label>
            <label>
              Referência (SKU)
              <input name="sku" maxLength={80} defaultValue={lot.sku || ""} disabled={locked || closed} />
            </label>
            <label>
              Metal
              <input name="metal" maxLength={80} defaultValue={lot.metal || ""} placeholder="Ouro amarelo" disabled={locked || closed} />
            </label>
            <label>
              Toque
              <input name="fineness" maxLength={40} defaultValue={lot.fineness || ""} placeholder="800‰ (19,2 kl)" disabled={locked || closed} />
            </label>
            <label>
              Peso (g)
              <input name="weight_g" inputMode="decimal" defaultValue={money(lot.weight_g)} disabled={locked || closed} />
            </label>
            <label>
              Estado
              <select name="condition" defaultValue={lot.condition} disabled={locked || closed}>
                <option value="used">Usada</option>
                <option value="new">Nova</option>
              </select>
            </label>
            <label className="wide">
              Gemas e materiais
              <input name="gems" maxLength={500} defaultValue={lot.gems || ""} placeholder="Diamantes lapidação brilhante, 0,12 ct" disabled={locked || closed} />
            </label>
            <label className="check wide">
              <input type="checkbox" name="hallmarked" defaultChecked={lot.hallmarked} disabled={locked || closed} />
              <span><strong>Legalmente marcada</strong> — com as marcas da contrastaria (obrigatório para venda, salvo peças com mais de 50 anos).</span>
            </label>
            <label>
              Base de licitação (€)
              <input name="start_price" required inputMode="decimal" defaultValue={money(lot.start_price)} disabled={locked || closed} />
            </label>
            <label>
              Preço de reserva (€, opcional)
              <input name="reserve_price" inputMode="decimal" defaultValue={money(lot.reserve_price)} disabled={locked || closed} />
            </label>
            <label>
              «Comprar já» (€, opcional)
              <input name="buy_now_price" inputMode="decimal" defaultValue={money(lot.buy_now_price)} disabled={locked || closed} />
            </label>
            <label>
              Caução
              <select name="deposit_mode" defaultValue={lot.deposit_mode} disabled={locked || closed}>
                <option value="auto">Automática (a partir de {eur(s.deposit_threshold)})</option>
                <option value="required">Sempre</option>
                <option value="none">Nunca</option>
              </select>
            </label>
            <label>
              Garantia (meses)
              <input name="warranty_months" type="number" min={0} max={120} defaultValue={lot.warranty_months} disabled={locked || closed} />
            </label>
            <label className="wide">
              Descrição
              <textarea name="description" rows={6} maxLength={20000} defaultValue={lot.description} disabled={closed} />
            </label>
            <label className="wide">
              Relatório de estado
              <textarea name="condition_report" rows={3} maxLength={4000} defaultValue={lot.condition_report} placeholder="Marcas de uso ligeiras no aro; fecho a funcionar; sem pedras em falta." disabled={closed} />
            </label>
            <label className="wide">
              Fotografias (um endereço por linha; a primeira é a principal)
              <textarea name="images" rows={4} defaultValue={lot.images.join("\n")} spellCheck={false} disabled={closed} />
            </label>
            {lot.images.length > 0 && (
              <div className="wide chips">
                {lot.images.slice(0, 8).map((src) => (
                  <img key={src} className="product-thumb" src={`${src}${src.includes("?") ? "&" : "?"}width=160`} alt="" width={80} height={80} />
                ))}
              </div>
            )}
            <p className="field-help wide">
              Informação obrigatória na venda de metais preciosos (RJOC, art. 64.º): metal, toque, peso, gemas e marcação. A reserva nunca aparece no site, só se
              foi atingida. Garantia de {s.new_warranty_months} meses nas peças novas e {s.used_warranty_months} nas usadas (redução a confirmar com o advogado).
            </p>
            {!closed && (
              <div className="wide form-actions">
                <button type="submit">Guardar lote</button>
              </div>
            )}
          </form>
        </Panel>

        <Panel title={`${bids.length} ${bids.length === 1 ? "registo" : "registos"} de licitação`} eyebrow="HISTÓRICO" note="Histórico imutável. «Automática» é o sistema a licitar pelo máximo do cliente; «Subiu o máximo» não é público.">
          <div className="table-scroll" tabIndex={0} aria-label="Licitações do lote">
            <table className="left-table">
              <thead>
                <tr>
                  <th>Hora</th>
                  <th>Licitante</th>
                  <th>Valor</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {bids.map((b) => (
                  <tr key={b.id}>
                    <td>{lisbonDateTime(b.created_at)}</td>
                    <td>
                      {b.alias}
                      <small className="muted block">{b.name} · {b.email}</small>
                    </td>
                    <td>
                      {eur(b.amount)}
                      {b.max_amount !== null && <small className="muted block">máx. {eur(b.max_amount)}</small>}
                    </td>
                    <td>{BID_KIND[b.kind] || b.kind}</td>
                  </tr>
                ))}
                {!bids.length && (
                  <tr>
                    <td colSpan={4} className="muted">Ainda sem licitações.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
