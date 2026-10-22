"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CHECKOUT_SDK } from "@/lib/easypay-rules";
import { eur, lisbonDateTime } from "@/lib/leilao-rules";
import type { CardCheckout, LotMoney } from "@/lib/leilao/money";
import { confirmCardAction, depositAction, payAction } from "./actions";

// Caução (cativação) antes de licitar e pagamento do lote ganho, pela easypay, sem sair do site: MB WAY (aprovação no
// telemóvel), Multibanco (referência mostrada aqui) e cartão (formulário embutido da easypay nesta página; os dados
// do cartão vão diretamente para a easypay). O estado vem do servidor, que o confirma na easypay.

function useLotMoney(lotId: string) {
  const [money, setMoney] = useState<LotMoney | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/l/money?lot=${lotId}`, { cache: "no-store" });
      if (r.ok) setMoney((await r.json()) as LotMoney | null);
    } catch {
      // Sem rede: tenta na próxima volta.
    }
  }, [lotId]);
  useEffect(() => { load(); }, [load]);
  const waiting = money?.deposit?.status === "pending" || money?.payment?.status === "pending";
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 4000);
    return () => clearInterval(t);
  }, [waiting, load]);
  return { money, load };
}

function Methods({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string, string][] }) {
  return (
    <div className="lx-methods" role="radiogroup">
      {options.map(([v, label, hint]) => (
        <label key={v} className="lx-method" data-on={value === v}>
          <input type="radio" name="lx-method" value={v} checked={value === v} onChange={() => onChange(v)} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- formulário do cartão (easypay Checkout, embutido)

type EasypayCheckout = {
  startCheckout: (manifest: unknown, options: Record<string, unknown>) => { unmount: () => void };
};
declare global {
  interface Window { easypayCheckout?: EasypayCheckout }
}

let sdk: Promise<EasypayCheckout> | null = null;
function loadSdk(): Promise<EasypayCheckout> {
  if (window.easypayCheckout) return Promise.resolve(window.easypayCheckout);
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_SDK;
    s.async = true;
    s.onload = () => (window.easypayCheckout ? resolve(window.easypayCheckout) : reject(new Error("sdk")));
    s.onerror = () => { sdk = null; reject(new Error("sdk")); };
    document.head.appendChild(s);
  });
  return sdk;
}

function CardForm({ card, onDone, onCancel }: { card: CardCheckout; onDone: () => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const elId = `lx-card-${card.id}`;
  useEffect(() => {
    let instance: { unmount: () => void } | null = null;
    let gone = false;
    loadSdk().then((ep) => {
      if (gone || !box.current) return;
      instance = ep.startCheckout(card.manifest, {
        id: elId, display: "inline", testing: card.testing, language: "pt_PT", hideDetails: true,
        accentColor: "#1d3e47", fontFamily: "Inter, system-ui, sans-serif", backgroundColor: "#ffffff", errorColor: "#a3402f",
        onSuccess: async (info: { payment?: { id?: string } }) => {
          setChecking(true);
          if (info?.payment?.id) await confirmCardAction(info.payment.id);
          onDone();
        },
        onError: (e: { code?: string }) => {
          setError(e?.code === "checkout-expired" ? "O formulário expirou. Comece de novo." : e?.code === "already-paid" ? "Este pagamento já foi feito." : "O pagamento com cartão não está disponível. Tente MB WAY ou mais tarde.");
        },
      });
    }).catch(() => setError("Não foi possível carregar o formulário seguro do cartão. Verifique a ligação e tente de novo."));
    return () => { gone = true; instance?.unmount(); };
  }, [card, elId, onDone]);
  return (
    <div className="lx-cardform">
      <p className="lx-small lx-muted" style={{ margin: 0 }}>
        Formulário seguro da easypay, com 3-D Secure do seu banco. Os dados do cartão não passam pelo nosso site.
      </p>
      <div id={elId} ref={box} className="lx-cardform-frame" aria-live="polite" />
      {checking && <div className="lx-alert lx-alert-info" role="status">A confirmar com a easypay…</div>}
      {error && <div className="lx-alert lx-alert-err" role="alert">{error}</div>}
      <button type="button" className="lx-linkbtn-dark" onClick={onCancel}>Escolher outra forma de pagamento</button>
    </div>
  );
}

// ---------------------------------------------------------------- caução

export function DepositBox({ lotId, amount, holdDays, methods, phone, base }: {
  lotId: string; amount: number; holdDays: number; methods: string[]; phone: string | null; base: string;
}) {
  const router = useRouter();
  const { money, load } = useLotMoney(lotId);
  const options = ([["mbw", "MB WAY", "Aprova na app, em segundos."], ["cc", "Cartão", "Visa ou Mastercard, com 3-D Secure."]] as [string, string, string][])
    .filter(([m]) => methods.includes(m));
  const [method, setMethod] = useState(options[0]?.[0] ?? "mbw");
  const [tel, setTel] = useState(phone?.replace(/^\+351/, "") ?? "");
  const [error, setError] = useState("");
  const [card, setCard] = useState<CardCheckout | null>(null);
  const [pending, start] = useTransition();
  const d = money?.deposit;

  useEffect(() => { if (d?.status === "held") router.refresh(); }, [d?.status, router]);
  const cardDone = useCallback(() => { setCard(null); load(); }, [load]);

  if (d?.status === "held") return <div className="lx-alert lx-alert-ok"><strong>Caução cativa</strong>Já pode licitar. A atualizar…</div>;

  const request = (m: string) => start(async () => {
    setError("");
    const r = await depositAction(lotId, m, tel);
    if (!r.ok) return setError(r.error);
    if (r.status === "held") return router.refresh();
    if (r.card) setCard(r.card);
    await load();
  });
  const waitingMbw = d?.status === "pending" && d.method === "mbw" && !card;

  return (
    <div className="lx-confirm">
      <div>
        <strong>Este lote pede uma caução de {eur(amount)}</strong>
        <p className="lx-small" style={{ margin: "6px 0 0" }}>
          É só uma <b>cativação</b>: o valor fica reservado, não é cobrado. Se não ganhar, é libertado logo após o fecho; se ganhar, é libertado quando
          pagar o lote. Dura até {holdDays} dias. <Link href={`${base}/pagamentos`} target="_blank">Porque pedimos caução?</Link>
        </p>
      </div>
      {card ? (
        <CardForm card={card} onDone={cardDone} onCancel={() => setCard(null)} />
      ) : waitingMbw ? (
        <div className="lx-alert lx-alert-info" role="status">
          <strong>Aprove no MB WAY</strong>Enviámos o pedido de {eur(amount)} para o seu telemóvel. Abra a app MB WAY e aceite (tem cerca de 5 minutos).
          <div style={{ marginTop: 10 }}>
            <button type="button" className="lx-linkbtn-dark" onClick={() => load()}>Já aprovei, verificar</button>
            {" · "}
            <button type="button" className="lx-linkbtn-dark" onClick={() => request("mbw")}>Enviar outro pedido</button>
          </div>
        </div>
      ) : (
        <>
          {d?.status === "failed" && <div className="lx-alert lx-alert-warn">O pedido anterior não foi aprovado. Pode tentar de novo.</div>}
          <Methods value={method} onChange={setMethod} options={options} />
          {method === "mbw" && (
            <label className="lx-field">Telemóvel MB WAY<input type="tel" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="912 345 678" /></label>
          )}
          <button type="button" className="lx-btn lx-btn-dark lx-btn-block" disabled={pending} onClick={() => request(method)}>
            {pending ? "A preparar…" : method === "cc" ? `Cativar ${eur(amount)} no cartão` : `Cativar ${eur(amount)}`}
          </button>
        </>
      )}
      {error && <div className="lx-alert lx-alert-err" role="alert">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- pagamento do lote ganho

export function PayBox({ lotId, amount, dueAt, methods, phone, base }: {
  lotId: string; amount: number; dueAt: string | null; methods: string[]; phone: string | null; base: string;
}) {
  const { money, load } = useLotMoney(lotId);
  const options = ([["mb", "Multibanco", "Referência para pagar no multibanco ou no homebanking."], ["mbw", "MB WAY", "Aprova na app, em segundos."], ["cc", "Cartão", "Visa ou Mastercard, com 3-D Secure."]] as [string, string, string][])
    .filter(([m]) => methods.includes(m));
  const [method, setMethod] = useState(options[0]?.[0] ?? "mb");
  const [tel, setTel] = useState(phone?.replace(/^\+351/, "") ?? "");
  const [error, setError] = useState("");
  const [card, setCard] = useState<CardCheckout | null>(null);
  const [pending, start] = useTransition();
  const [other, setOther] = useState(false);
  const cardDone = useCallback(() => { setCard(null); load(); }, [load]);
  const p = money?.payment;

  if (!money) return <div className="lx-alert lx-alert-info">A carregar o pagamento…</div>;
  if (p?.status === "paid") {
    return (
      <div className="lx-alert lx-alert-ok">
        <strong>Pagamento recebido{p.paid_at ? ` a ${lisbonDateTime(p.paid_at)}` : ""}</strong>
        Obrigado! Vamos contactá-lo para combinar a entrega ou o levantamento.
      </div>
    );
  }
  const go = () => start(async () => {
    setError("");
    const r = await payAction(lotId, method, tel);
    if (!r.ok) return setError(r.error);
    if (r.card) setCard(r.card);
    setOther(false);
    await load();
  });
  const mbRef = p?.status === "pending" && p.method === "mb" && p.entity && p.reference ? p : null;
  const mbwWaiting = p?.status === "pending" && p.method === "mbw";

  return (
    <div className="lx-confirm">
      <div>
        <strong>Pagar {eur(amount)}</strong>
        <p className="lx-small" style={{ margin: "6px 0 0" }}>
          Sem comissão. Prazo: {dueAt ? `até ${lisbonDateTime(dueAt)}` : "48 horas após o fecho"}. Levantamento grátis numa loja ou envio com seguro,
          combinado consigo depois do pagamento. <Link href={`${base}/pagamentos`} target="_blank">Formas de pagamento</Link>
        </p>
      </div>
      {card ? (
        <CardForm card={card} onDone={cardDone} onCancel={() => setCard(null)} />
      ) : (
        <>
          {mbRef && !other && (
            <div className="lx-mbref" role="status">
              <div><span>Entidade</span><strong>{mbRef.entity}</strong></div>
              <div><span>Referência</span><strong>{mbRef.reference!.replace(/(\d{3})(?=\d)/g, "$1 ")}</strong></div>
              <div><span>Montante</span><strong>{eur(mbRef.amount)}</strong></div>
              {mbRef.expires_at && <p className="lx-small lx-muted" style={{ gridColumn: "1 / -1", margin: 0 }}>Válida até {lisbonDateTime(mbRef.expires_at)}. A confirmação chega por email (pode demorar alguns minutos).</p>}
            </div>
          )}
          {mbwWaiting && !other && (
            <div className="lx-alert lx-alert-info" role="status">
              <strong>Aprove no MB WAY</strong>Enviámos o pedido de {eur(p!.amount)} para o seu telemóvel. Abra a app MB WAY e aceite.
            </div>
          )}
          {(mbRef || mbwWaiting) && !other ? (
            <button type="button" className="lx-linkbtn-dark" onClick={() => setOther(true)}>Pagar de outra forma</button>
          ) : (
            <>
              {p?.status === "failed" && <div className="lx-alert lx-alert-warn">O pagamento anterior não foi concluído. Pode tentar de novo.</div>}
              <Methods value={method} onChange={setMethod} options={options} />
              {method === "mbw" && (
                <label className="lx-field">Telemóvel MB WAY<input type="tel" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="912 345 678" /></label>
              )}
              <button type="button" className="lx-btn lx-btn-block" disabled={pending} onClick={go}>
                {pending ? "A preparar…" : method === "mb" ? "Gerar referência Multibanco" : method === "cc" ? `Pagar ${eur(amount)} com cartão` : `Pagar ${eur(amount)}`}
              </button>
            </>
          )}
        </>
      )}
      {error && <div className="lx-alert lx-alert-err" role="alert">{error}</div>}
    </div>
  );
}
