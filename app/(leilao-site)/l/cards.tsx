import Link from "next/link";
import { eur, lisbonDateTime } from "@/lib/leilao-rules";
import type { PubLot } from "@/lib/leilao/site";
import { Countdown } from "./live";

// Cartão de um lote (listas do leilão e da conta). Estado calculado com a hora do pedido; o relógio conta no browser.
export function LotCard({ lot, base, now, endingMinutes }: { lot: PubLot; base: string; now: number; endingMinutes: number }) {
  const close = lot.close_at ? new Date(lot.close_at).getTime() : 0;
  const notOpen = now < new Date(lot.opens_at).getTime();
  const closed = lot.status === "closed" || close <= now;
  const ending = !closed && !notOpen && close - now <= endingMinutes * 60_000;
  const img = lot.images[0];
  return (
    <Link href={`${base}/${lot.event_slug}/${lot.position}`} className="lx-card lx-lot">
      <div className="lx-lot-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img && <img src={img} alt={lot.title} loading="lazy" />}
        <div className="lx-lot-tags">
          {closed ? (
            <span className="lx-badge lx-badge-closed">{lot.result === "sold" ? "Vendido" : "Terminado"}</span>
          ) : notOpen ? (
            <span className="lx-badge">Abre {lisbonDateTime(lot.opens_at)}</span>
          ) : ending ? (
            <span className="lx-badge lx-badge-ending">A terminar</span>
          ) : (
            <span className="lx-badge lx-badge-live">Aberto</span>
          )}
          {lot.me_leading && !closed && <span className="lx-badge lx-badge-me">Lidera</span>}
          {lot.me_leading && closed && lot.result === "sold" && <span className="lx-badge lx-badge-me">Ganhou</span>}
          {lot.me_bid && !lot.me_leading && !closed && <span className="lx-badge lx-badge-ending">Ultrapassado</span>}
        </div>
      </div>
      <div className="lx-lot-body">
        <span className="lx-lot-num">Lote {lot.position}</span>
        <span className="lx-lot-title">{lot.title}</span>
        <span className="lx-small lx-muted">{[lot.metal, lot.fineness, lot.weight_g ? `${String(lot.weight_g).replace(".", ",")} g` : null].filter(Boolean).join(" · ")}</span>
        <div className="lx-lot-foot">
          <div>
            <div className="lx-price-label">{lot.bid_count ? `${lot.bid_count} ${lot.bid_count === 1 ? "licitação" : "licitações"}` : "Base"}</div>
            <div className="lx-price">{eur(lot.current_price ?? lot.start_price)}</div>
          </div>
          {!closed && !notOpen && <Countdown closeAt={lot.close_at} />}
        </div>
      </div>
    </Link>
  );
}
