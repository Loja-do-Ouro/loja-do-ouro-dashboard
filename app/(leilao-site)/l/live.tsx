"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { eur, lisbonDateTime } from "@/lib/leilao-rules";
import { bidResultText, countdown, countdownText, parseBid, quickBids, type BidResult } from "@/lib/leilao-site-rules";
import type { LotLive, LotMe, PubLot } from "@/lib/leilao/site";
import { bidAction, watchAction } from "./actions";

// Partes do site que mexem no browser: contagem decrescente, galeria, painel de licitação (atualiza de poucos em
// poucos segundos) e favoritos. O preço e o fecho vêm sempre da BD; o relógio do browser só é usado para contar.

function useNow(offsetMs = 0) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() + offsetMs);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [offsetMs]);
  return now;
}

export function Countdown({ closeAt, className = "lx-clock" }: { closeAt: string | null; className?: string }) {
  const now = useNow();
  if (!closeAt) return null;
  // Antes de montar (servidor), a hora de fecho; depois, o tempo que falta.
  if (now === null) return <span className={className}>{lisbonDateTime(closeAt)}</span>;
  const c = countdown(closeAt, now);
  const urgent = !c.done && c.days === 0 && c.hours === 0 && c.minutes < 10;
  return (
    <span className={`${className}${urgent ? " lx-clock-urgent" : ""}`} title={`Fecha a ${lisbonDateTime(closeAt)} (hora de Lisboa)`}>
      {countdownText(c)}
    </span>
  );
}

export function Gallery({ images, title }: { images: string[]; title: string }) {
  const [i, setI] = useState(0);
  if (!images.length) return <div className="lx-gallery-main" />;
  return (
    <div>
      <div className="lx-gallery-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[i]} alt={`${title}, fotografia ${i + 1} de ${images.length}`} />
      </div>
      {images.length > 1 && (
        <div className="lx-thumbs" role="list">
          {images.map((src, n) => (
            <button key={src} type="button" className="lx-thumb" aria-current={n === i} aria-label={`Ver fotografia ${n + 1}`} onClick={() => setI(n)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WatchButton({ lotId, initial, loggedIn, loginHref }: { lotId: string; initial: boolean; loggedIn: boolean; loginHref: string }) {
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (!loggedIn) return <Link className="lx-watch" href={loginHref} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>☆ Guardar nos favoritos</Link>;
  return (
    <span>
      <button
        type="button" className="lx-watch" aria-pressed={on} disabled={pending}
        onClick={() => start(async () => {
          const r = await watchAction(lotId);
          if (r.ok) { setOn(Boolean(r.watching)); setMsg(""); } else setMsg(r.error || "");
        })}
      >
        {on ? "★ Nos favoritos" : "☆ Guardar nos favoritos"}
      </button>
      {msg && <small className="lx-muted"> {msg}</small>}
    </span>
  );
}

type PanelProps = {
  lot: PubLot; me: LotMe | null; base: string; steps: [number, number][]; verifiedThreshold: number; extendMinutes: number;
  extendWindowSeconds: number; paymentHours: number;
};

export function BidPanel({ lot, me, base, steps, verifiedThreshold, extendMinutes, extendWindowSeconds, paymentHours }: PanelProps) {
  const router = useRouter();
  const [live, setLive] = useState<LotLive>({
    current_price: lot.current_price, bid_count: lot.bid_count, bidder_count: lot.bidder_count, close_at: lot.close_at,
    extensions: lot.extensions, status: lot.status, result: lot.result, reserve_met: lot.reserve_met, leader_alias: lot.leader_alias,
    min_next: lot.min_next, me_leading: Boolean(me?.leading), me_max: me?.max ?? null, server_time: new Date().toISOString(),
  });
  const [offset, setOffset] = useState(0);
  const now = useNow(offset);
  const [value, setValue] = useState(String(lot.min_next));
  const [confirming, setConfirming] = useState<number | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "err"; title: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  const bids = useRef(lot.bid_count);

  const closeAt = live.close_at;
  const opensAt = new Date(lot.opens_at).getTime();
  const notOpen = now !== null && now < opensAt;
  const left = closeAt && now !== null ? new Date(closeAt).getTime() - now : null;
  const closed = live.status === "closed" || (left !== null && left <= 0);

  // Atualização: de 5 em 5 segundos (2 s no último minuto); parada com o separador escondido.
  useEffect(() => {
    if (live.status === "closed") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/l/live?lot=${lot.id}`, { cache: "no-store" });
          if (r.ok) {
            const d = (await r.json()) as LotLive | null;
            if (d && !stop) {
              setOffset(new Date(d.server_time).getTime() - Date.now());
              setLive(d);
              if (d.bid_count !== bids.current || d.status === "closed") {
                bids.current = d.bid_count;
                router.refresh();
              }
            }
          }
        } catch {
          // Sem rede: tenta outra vez na próxima volta.
        }
      }
      if (stop) return;
      const ms = closeAt ? new Date(closeAt).getTime() - Date.now() : Infinity;
      timer = setTimeout(load, ms < 60_000 ? 2000 : 5000);
    };
    timer = setTimeout(load, 3000);
    return () => { stop = true; clearTimeout(timer); };
  }, [lot.id, live.status, closeAt, router]);

  // O valor sugerido acompanha o mínimo enquanto o cliente não escreveu outro maior.
  useEffect(() => {
    setValue((v) => {
      const n = parseBid(v);
      return n === null || n < live.min_next ? String(live.min_next) : v;
    });
  }, [live.min_next]);

  const loginHref = `${base}/conta/entrar?next=${encodeURIComponent(`${base}/${lot.event_slug}/${lot.position}`)}`;
  const priceLabel = live.bid_count ? "Licitação atual" : "Base de licitação";
  const price = live.current_price ?? lot.start_price;

  function review() {
    const n = parseBid(value);
    if (n === null) return setResult({ tone: "err", title: "Valor inválido", text: "Escreva o valor em euros, por exemplo 1250." });
    if (n < live.min_next && !live.me_leading) return setResult({ tone: "err", title: "Valor abaixo do mínimo", text: `A próxima licitação é de pelo menos ${eur(live.min_next)}.` });
    setResult(null);
    setConfirming(n);
  }

  function place(n: number) {
    start(async () => {
      const r = await bidAction(lot.id, String(n));
      setConfirming(null);
      if (!r.ok) {
        setResult({ tone: "err", title: "Licitação não aceite", text: r.error });
        if (r.login) router.push(loginHref);
        return;
      }
      const res: BidResult = r.result;
      setResult(bidResultText(res));
      setLive((l) => ({ ...l, current_price: res.price, close_at: res.close_at, min_next: res.min_next, reserve_met: res.reserve_met,
        me_leading: res.status === "leading", me_max: res.status === "leading" ? res.max : l.me_max }));
      router.refresh();
    });
  }

  return (
    <div className="lx-card lx-card-pad lx-bidform" aria-live="polite">
      <div className="lx-bidstats">
        <div className="lx-bidstat">
          <div className="lx-price-label">{priceLabel}</div>
          <div className="lx-price">{eur(price)}</div>
          <div className="lx-small lx-muted">
            {live.bid_count} {live.bid_count === 1 ? "licitação" : "licitações"} · {live.bidder_count} {live.bidder_count === 1 ? "licitante" : "licitantes"}
          </div>
        </div>
        <div className="lx-bidstat">
          <div className="lx-price-label">{notOpen ? "Abre em" : closed ? "Estado" : "Termina em"}</div>
          <div className="lx-bidstat-clock">
            {notOpen ? <Countdown closeAt={lot.opens_at} className="lx-bidstat-clock" /> : closed ? "Terminado" : <Countdown closeAt={closeAt} className="lx-bidstat-clock" />}
          </div>
          <div className="lx-small lx-muted">{closeAt ? `${lisbonDateTime(closeAt)} (Lisboa)` : ""}{live.extensions ? ` · prolongado ${live.extensions}×` : ""}</div>
        </div>
      </div>

      {lot.has_reserve && (
        <div className={`lx-alert ${live.reserve_met ? "lx-alert-ok" : "lx-alert-info"}`}>
          {live.reserve_met ? "Preço de reserva atingido: o lote vai ser vendido a quem liderar no fecho." : "Este lote tem preço de reserva, ainda não atingido. O valor da reserva é confidencial."}
        </div>
      )}

      {live.me_leading && !closed && (
        <div className="lx-alert lx-alert-ok">
          <strong>Lidera este lote</strong>
          O seu máximo secreto é {eur(live.me_max)}. Licitamos por si só o necessário. Pode subir o máximo quando quiser.
        </div>
      )}
      {me?.bid && !live.me_leading && !closed && (
        <div className="lx-alert lx-alert-warn"><strong>Foi ultrapassado</strong>Pode licitar de novo a partir de {eur(live.min_next)}.</div>
      )}

      {closed ? (
        <div className={`lx-alert ${me?.won ? "lx-alert-ok" : "lx-alert-info"}`}>
          {me?.won ? (
            <>
              <strong>Ganhou este lote por {eur(price)}</strong>
              Vamos enviar-lhe por email as instruções de pagamento (prazo de {paymentHours} horas{me.payment_due_at ? `, até ${lisbonDateTime(me.payment_due_at)}` : ""}).
            </>
          ) : live.result === "sold" ? (
            <>Lote vendido por {eur(price)}.</>
          ) : live.status === "closed" ? (
            <>Lote terminado sem venda.</>
          ) : (
            <>A apurar o resultado…</>
          )}
        </div>
      ) : notOpen ? (
        <div className="lx-alert lx-alert-info">As licitações abrem a {lisbonDateTime(lot.opens_at)} (hora de Lisboa). Guarde o lote nos favoritos para receber o aviso de fim.</div>
      ) : !me ? (
        <div className="lx-form">
          <p className="lx-small lx-muted" style={{ margin: 0 }}>Para licitar precisa de uma conta confirmada. O registo é gratuito e demora um minuto.</p>
          <Link className="lx-btn lx-btn-block" href={loginHref}>Entrar para licitar</Link>
          <Link className="lx-btn lx-btn-ghost lx-btn-block" href={`${base}/conta/registo`}>Criar conta</Link>
        </div>
      ) : me.is_staff ? (
        <div className="lx-alert lx-alert-info">Contas de colaboradores não podem licitar (regulamento, ponto 3).</div>
      ) : confirming !== null ? (
        <div className="lx-confirm">
          <div>
            <strong>Confirmar licitação máxima de {eur(confirming)}</strong>
            <p className="lx-small" style={{ margin: "6px 0 0" }}>
              Licitamos por si, automaticamente, só o necessário para continuar à frente, até este máximo. A licitação é vinculativa: se ganhar,
              compromete-se a comprar a peça pelo preço final (sem comissão), com 14 dias para desistir depois da entrega.
              {confirming >= verifiedThreshold && me.level === "registered" ? ` Licitações a partir de ${eur(verifiedThreshold)} pedem conta verificada: fale connosco.` : ""}
            </p>
          </div>
          <div className="lx-confirm-actions">
            <button type="button" className="lx-btn lx-btn-ghost" onClick={() => setConfirming(null)} disabled={pending}>Voltar</button>
            <button type="button" className="lx-btn lx-btn-dark" onClick={() => place(confirming)} disabled={pending}>{pending ? "A licitar…" : "Confirmar"}</button>
          </div>
        </div>
      ) : (
        <form className="lx-bidform" onSubmit={(e) => { e.preventDefault(); review(); }}>
          <label className="lx-field" htmlFor="lx-bid">
            {live.me_leading ? "Subir o meu máximo" : "A sua licitação máxima"}
            <small>Mínimo {eur(live.min_next)}. Pode indicar um valor mais alto: só o usamos se alguém licitar contra si.</small>
          </label>
          <div className="lx-bidinput">
            <input id="lx-bid" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby="lx-bid-help" />
            <span aria-hidden="true">€</span>
          </div>
          {!live.me_leading && (
            <div className="lx-quick" aria-label="Valores rápidos">
              {quickBids(live.min_next, steps).map((v) => (
                <button key={v} type="button" onClick={() => setValue(String(v))}>{eur(v)}</button>
              ))}
            </div>
          )}
          <button type="submit" className="lx-btn lx-btn-block">{live.me_leading ? "Subir máximo" : "Licitar"}</button>
          <p id="lx-bid-help" className="lx-small lx-muted" style={{ margin: 0 }}>
            Uma licitação nos últimos {Math.round(extendWindowSeconds / 60) || 1} min prolonga o lote para {extendMinutes} min, e avisamos todos os licitantes por email.
            {lot.deposit > 0 ? ` Este lote pede uma caução de ${eur(lot.deposit)}, cativa no cartão ou MB WAY e libertada se não ganhar.` : ""}
          </p>
        </form>
      )}

      {result && (
        <div className={`lx-alert ${result.tone === "ok" ? "lx-alert-ok" : result.tone === "warn" ? "lx-alert-warn" : "lx-alert-err"}`} role="status">
          <strong>{result.title}</strong>
          {result.text}
        </div>
      )}
    </div>
  );
}
