import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageAuction, homePath } from "@/lib/permissions";
import { aucOverview } from "@/lib/leilao/db";
import { EVENT_STATUS, eur, isoToLisbonInput, lisbonDateTime } from "@/lib/leilao-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveEvent } from "./actions";
import { auctionMessage } from "./messages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leilão · Loja do Ouro" };

export default async function AuctionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManageAuction(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const data = await aucOverview(viewer.session).catch(() => null);
  const s = data?.settings;
  // Sugestão para um leilão novo: abre amanhã às 10:00 e o primeiro lote fecha 7 dias depois às 21:00 (hora de Lisboa).
  const tomorrow = new Date(Date.now() + 86400000);
  const day = (d: Date) => isoToLisbonInput(d.toISOString()).slice(0, 10);
  const opensDefault = `${day(tomorrow)}T10:00`;
  const closeDefault = `${day(new Date(tomorrow.getTime() + 7 * 86400000))}T21:00`;

  return (
    <AppShell viewer={viewer} current="leilao" title="Leilão">
      <PageHeading eyebrow="LEILÃO" title="Leilões e lotes" text="Leilões por tempo em leilao.lojadoouro.pt: só peças da Loja do Ouro, com licitação automática, prolongamento no fim e caução nos lotes altos.">
        <Link className="outline-button" href="#novo">+ Novo leilão</Link>
      </PageHeading>
      <Flash ok={auctionMessage(q.ok)} error={typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined} />
      {!data || !s ? (
        <div className="notice error-notice">Leilão indisponível (falta a atualização da base de dados?).</div>
      ) : (
        <>
          <Panel title={`${data.events.length} ${data.events.length === 1 ? "leilão" : "leilões"}`} eyebrow="CALENDÁRIO" note={`${data.customers} clientes registados no site do leilão.`}>
            <div className="table-scroll" tabIndex={0} aria-label="Leilões">
              <table className="left-table">
                <thead>
                  <tr>
                    <th>Leilão</th>
                    <th>Estado</th>
                    <th>Abertura</th>
                    <th>Fecho dos lotes</th>
                    <th>Lotes</th>
                    <th>Licitações</th>
                    <th>Vendido</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/leilao/${e.id}`}><strong>{e.title}</strong></Link>
                        <small className="muted block">/{e.slug}</small>
                      </td>
                      <td>
                        <span className={`pill${e.status === "published" ? " ok" : e.status === "cancelled" ? " warn" : ""}`}>{EVENT_STATUS[e.status]}</span>
                      </td>
                      <td>{lisbonDateTime(e.opens_at)}</td>
                      <td>
                        {lisbonDateTime(e.first_close_at)}
                        {e.last_close_at && e.last_close_at !== e.first_close_at && <small className="muted block">até {lisbonDateTime(e.last_close_at)}</small>}
                      </td>
                      <td>
                        {e.lots}
                        <small className="muted block">{e.ready} prontos</small>
                      </td>
                      <td>{e.bids}</td>
                      <td>
                        {e.sold ? eur(e.sold_value) : "—"}
                        {!!e.sold && <small className="muted block">{e.sold} {e.sold === 1 ? "lote" : "lotes"}</small>}
                      </td>
                    </tr>
                  ))}
                  {!data.events.length && (
                    <tr>
                      <td colSpan={7} className="muted">Ainda não há leilões. Crie o primeiro abaixo.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Novo leilão" eyebrow="CRIAR" id="novo">
            <form action={saveEvent} className="form-grid">
              <label className="wide">
                Título
                <input name="title" required maxLength={160} placeholder="Joias de Outono" />
              </label>
              <label>
                Endereço (opcional)
                <input name="slug" maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="joias-de-outono" spellCheck={false} />
              </label>
              <label>
                Intervalo entre lotes (segundos)
                <input name="stagger_seconds" type="number" min={0} max={3600} defaultValue={s.default_stagger_seconds} />
              </label>
              <label>
                Abertura (hora de Lisboa)
                <input name="opens_at" type="datetime-local" required defaultValue={opensDefault} />
              </label>
              <label>
                Fecho do 1.º lote (hora de Lisboa)
                <input name="first_close_at" type="datetime-local" required defaultValue={closeDefault} />
              </label>
              <label className="wide">
                Apresentação
                <textarea name="intro" rows={3} maxLength={4000} placeholder="Texto curto que abre a página do leilão." />
              </label>
              <input type="hidden" name="status" value="draft" />
              <p className="field-help wide">
                O leilão nasce em rascunho. Cada lote fecha {s.default_stagger_seconds} s depois do anterior (configurável) e, se houver licitações nos últimos{" "}
                {Math.round(s.extend_window_seconds / 60)} min, prolonga {s.extend_minutes} min. Sem endereço, é criado a partir do título.
              </p>
              <div className="wide form-actions">
                <button type="submit">Criar leilão</button>
              </div>
            </form>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
