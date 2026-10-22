"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { eur, lisbonDateTime } from "@/lib/leilao-rules";
import type { LotMoney } from "@/lib/leilao/money";
import { depositAction, payAction } from "./actions";

// Caução (cativação) antes de licitar e pagamento do lote ganho, pela easypay. O estado vem do servidor, que o
// confirma na easypay; o ecrã pergunta de 4 em 4 segundos enquanto há um pedido à espera.

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
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const d = money?.deposit;

  useEffect(() => { if (d?.status === "held") router.refresh(); }, [d?.status, router]);
  useEffect(() => { if (d?.status === "pending" && d.checkout_url) setUrl(d.checkout_url); }, [d?.status, d?.checkout_url]);

  if (d?.status === "held") return <div className="lx-alert lx-alert-ok"><strong>Caução cativa</strong>Já pode licitar. A atualizar…</div>;

  const waiting = d?.status === "pending";
  return (
    <div className="lx-confirm">
      <div>
        <strong>Este lote pede uma caução de {eur(amount)}</strong>
        <p className="lx-small" style={{ margin: "6px 0 0" }}>
          É só uma <b>cativação</b>: o valor fica reservado, não é cobrado. Se não ganhar, é libertado logo após o fecho; se ganhar, é libertado quando
          pagar o lote. Dura até {holdDays} dias. <Link href={`${base}/pagamentos`} target="_blank">Porque pedimos caução?</Link>
        </p>
      </div>
      {waiting ? (
        <div className="lx-alert lx-alert-info" role="status">
          {d?.method === "mbw" ? (
            <><strong>Aprove no MB WAY</strong>Enviámos o pedido de {eur(amount)} para o seu telemóvel. Abra a app MB WAY e aceite (tem cerca de 5 minutos).</>
          ) : (
            <><strong>Conclua no cartão</strong>Abra a página segura da easypay, indique o cartão e confirme. Esta página atualiza sozinha.
              {url && <div style={{ marginTop: 10 }}><a className="lx-btn lx-btn-dark lx-btn-small" href={url} target="_blank" rel="noopener noreferrer">Abrir página do cartão</a></div>}</>
          )}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="lx-linkbtn-dark" onClick={() => load()}>Já aprovei, verificar</button>
            {" · "}
            <button type="button" className="lx-linkbtn-dark" onClick={() => start(async () => { setError(""); const r = await depositAction(lotId, method, tel); if (!r.ok) setError(r.error); else { setUrl(r.url ?? null); await load(); } })}>
              Enviar outro pedido
            </button>
          </div>
        </div>
      ) : (
        <>
          {d?.status === "failed" && <div className="lx-alert lx-alert-warn">O pedido anterior não foi aprovado. Pode tentar de novo.</div>}
          <Methods value={method} onChange={setMethod} options={options} />
          {method === "mbw" && (
            <label className="lx-field">Telemóvel MB WAY<input type="tel" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="912 345 678" /></label>
          )}
          <button
            type="button" className="lx-btn lx-btn-dark lx-btn-block" disabled={pending}
            onClick={() => start(async () => {
              setError("");
              const r = await depositAction(lotId, method, tel);
              if (!r.ok) return setError(r.error);
              if (r.status === "held") return router.refresh();
              setUrl(r.url ?? null);
              await load();
            })}
          >
            {pending ? "A pedir…" : `Cativar ${eur(amount)}`}
          </button>
        </>
      )}
      {error && <div className="lx-alert lx-alert-err" role="alert">{error}</div>}
    </div>
  );
}

export function PayBox({ lotId, amount, dueAt, methods, phone, base }: {
  lotId: string; amount: number; dueAt: string | null; methods: string[]; phone: string | null; base: string;
}) {
  const { money, load } = useLotMoney(lotId);
  const options = ([["mb", "Multibanco", "Referência para pagar no multibanco ou no homebanking."], ["mbw", "MB WAY", "Aprova na app, em segundos."], ["cc", "Cartão", "Visa ou Mastercard, com 3-D Secure."]] as [string, string, string][])
    .filter(([m]) => methods.includes(m));
  const [method, setMethod] = useState(options[0]?.[0] ?? "mb");
  const [tel, setTel] = useState(phone?.replace(/^\+351/, "") ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [other, setOther] = useState(false);
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
  const waiting = p?.status === "pending";
  const go = () => start(async () => {
    setError("");
    const r = await payAction(lotId, method, tel);
    if (!r.ok) return setError(r.error);
    await load();
  });

  return (
    <div className="lx-confirm">
      <div>
        <strong>Pagar {eur(amount)}</strong>
        <p className="lx-small" style={{ margin: "6px 0 0" }}>
          Sem comissão. Prazo: {dueAt ? `até ${lisbonDateTime(dueAt)}` : "48 horas após o fecho"}. Levantamento grátis numa loja ou envio com seguro,
          combinado consigo depois do pagamento. <Link href={`${base}/pagamentos`} target="_blank">Formas de pagamento</Link>
        </p>
      </div>
      {waiting && p?.method === "mb" && p.entity && p.reference ? (
        <div className="lx-mbref" role="status">
          <div><span>Entidade</span><strong>{p.entity}</strong></div>
          <div><span>Referência</span><strong>{p.reference.replace(/(\d{3})(?=\d)/g, "$1 ")}</strong></div>
          <div><span>Montante</span><strong>{eur(p.amount)}</strong></div>
          {p.expires_at && <p className="lx-small lx-muted" style={{ gridColumn: "1 / -1", margin: 0 }}>Válida até {lisbonDateTime(p.expires_at)}. A confirmação chega por email (pode demorar alguns minutos).</p>}
        </div>
      ) : waiting ? (
        <div className="lx-alert lx-alert-info" role="status">
          {p?.method === "mbw" ? (
            <><strong>Aprove no MB WAY</strong>Enviámos o pedido de {eur(p.amount)} para o seu telemóvel. Abra a app MB WAY e aceite.</>
          ) : (
            <><strong>Conclua no cartão</strong>Abra a página segura da easypay e confirme. Esta página atualiza sozinha.
              {p?.checkout_url && <div style={{ marginTop: 10 }}><a className="lx-btn lx-btn-dark lx-btn-small" href={p.checkout_url} target="_blank" rel="noopener noreferrer">Abrir página do cartão</a></div>}</>
          )}
        </div>
      ) : null}
      {(!waiting || p?.method !== "mb" || other) && (
        <>
          {p?.status === "failed" && <div className="lx-alert lx-alert-warn">O pagamento anterior não foi concluído. Pode tentar de novo.</div>}
          {waiting && <p className="lx-small lx-muted" style={{ margin: 0 }}>Preferir outra forma de pagamento:</p>}
          <Methods value={method} onChange={setMethod} options={options} />
          {method === "mbw" && (
            <label className="lx-field">Telemóvel MB WAY<input type="tel" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="912 345 678" /></label>
          )}
          <button type="button" className="lx-btn lx-btn-block" disabled={pending} onClick={go}>
            {pending ? "A preparar…" : method === "mb" ? "Gerar referência Multibanco" : `Pagar ${eur(amount)}`}
          </button>
        </>
      )}
      {waiting && p?.method === "mb" && !other && (
        <button type="button" className="lx-linkbtn-dark" onClick={() => { setOther(true); setMethod("mbw"); }}>Pagar de outra forma</button>
      )}
      {error && <div className="lx-alert lx-alert-err" role="alert">{error}</div>}
    </div>
  );
}
