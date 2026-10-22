import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eur, lisbonDateTime } from "@/lib/leilao-rules";
import { auctionSession, pubLot, siteBase } from "@/lib/leilao/site";
import { BidPanel, Gallery, WatchButton } from "../../live";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; pos: string }> };

const position = (p: string) => (/^[0-9]{1,4}$/.test(p) ? Number(p) : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, pos } = await params;
  const n = position(pos);
  const data = n ? await pubLot(slug, n, "").catch(() => null) : null;
  return { title: data ? `Lote ${data.lot.position}: ${data.lot.title}` : "Lote" };
}

export default async function AuctionLotPage({ params }: Props) {
  const { slug, pos } = await params;
  const n = position(pos);
  if (!n) notFound();
  const [base, session] = await Promise.all([siteBase(), auctionSession()]);
  const data = await pubLot(slug, n, session).catch(() => null);
  if (!data) notFound();
  const { lot, settings: s, history, me } = data;
  const loginHref = `${base}/conta/entrar?next=${encodeURIComponent(`${base}/${lot.event_slug}/${lot.position}`)}`;
  const facts: [string, string][] = [
    ["Metal", lot.metal || "—"],
    ["Toque", lot.fineness || "—"],
    ["Peso", lot.weight_g ? `${String(lot.weight_g).replace(".", ",")} g` : "—"],
    ...(lot.gems ? [["Pedras", lot.gems] as [string, string]] : []),
    ["Marca de contrastaria", lot.hallmarked ? "Sim" : "Não aplicável"],
    ["Estado", lot.condition === "new" ? "Nova" : "Usada"],
    ["Garantia", lot.warranty_months ? `${lot.warranty_months} meses` : "—"],
    ["Base de licitação", eur(lot.start_price)],
    ["Comissão do comprador", "Nenhuma"],
  ];

  return (
    <div className="lx-wrap">
      <nav className="lx-crumbs" aria-label="Caminho">
        <Link href={base || "/"}>Leilões</Link> / <Link href={`${base}/${lot.event_slug}`}>{lot.event_title}</Link> / Lote {lot.position}
      </nav>
      <div className="lx-lotpage">
        <div>
          <Gallery images={lot.images} title={lot.title} />
          <div className="lx-details">
            {lot.description && (
              <section>
                <h2>Descrição</h2>
                <p className="lx-desc">{lot.description}</p>
              </section>
            )}
            <section>
              <h2>Características</h2>
              <dl className="lx-facts">
                {facts.map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </section>
            {lot.condition_report && (
              <section>
                <h2>Relatório de estado</h2>
                <p className="lx-desc">{lot.condition_report}</p>
              </section>
            )}
            <section>
              <h2>Antes de licitar</h2>
              <ul className="lx-small" style={{ paddingLeft: 18, margin: 0 }}>
                <li>A licitação é vinculativa: quem liderar no fecho compra a peça pelo preço final, sem comissão.</li>
                <li>Pagamento em {s.payment_hours} horas depois do fecho (instruções por email). Entrega segura ou levantamento numa das nossas lojas.</li>
                <li>Tem 14 dias, a contar da entrega, para desistir sem indicar motivo (<Link href={`${base}/livre-resolucao`}>livre resolução</Link>).</li>
                <li>Garantia de {lot.warranty_months} meses{lot.condition === "used" ? " (peça usada, por acordo; aceite no registo)" : ""}.</li>
                <li>Regras completas no <Link href={`${base}/regulamento`}>regulamento do leilão</Link>.</li>
              </ul>
            </section>
          </div>
        </div>

        <aside className="lx-bidbox" aria-label="Licitar">
          <div className="lx-bidbox-head">
            <span className="lx-lot-num">Lote {lot.position} · {lot.event_title}</span>
            <h1>{lot.title}</h1>
            <WatchButton lotId={lot.id} initial={Boolean(me?.watch)} loggedIn={Boolean(me)} loginHref={loginHref} />
          </div>
          <BidPanel
            lot={lot} me={me} base={base} steps={s.increments} verifiedThreshold={s.verified_threshold}
            extendMinutes={s.extend_minutes} extendWindowSeconds={s.extend_window_seconds} paymentHours={s.payment_hours}
          />
          <div className="lx-card lx-card-pad">
            <h2 style={{ fontSize: "1.3rem" }}>Histórico</h2>
            {history.length === 0 ? (
              <p className="lx-small lx-muted" style={{ margin: 0 }}>Ainda sem licitações. Seja o primeiro.</p>
            ) : (
              <ul className="lx-history">
                {history.map((h, i) => (
                  <li key={`${h.created_at}-${i}`} className={h.mine ? "mine" : undefined}>
                    <span>{h.mine ? "Você" : h.alias}{h.kind === "auto" ? <span className="lx-muted"> · automática</span> : null}</span>
                    <span>{eur(h.amount)}</span>
                    <span className="lx-muted lx-small">{lisbonDateTime(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="lx-small lx-muted" style={{ margin: "10px 0 0" }}>Os licitantes aparecem com pseudónimo. Os máximos nunca são mostrados.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
