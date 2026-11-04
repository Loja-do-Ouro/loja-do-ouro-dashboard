"use client";

import { useActionState, useEffect, useState } from "react";
import { revealCreatorFinance, type RevealState } from "../../actions";

// «Revelar» os dados de pagamento (F8, rev. S-M8, S-A1): motivo, a própria palavra-passe e, durante a espera de um
// IBAN novo, a confirmação por outro canal. Os dados chegam na resposta da ação (POST, sem cache) e ficam no ecrã
// 60 segundos; depois deixam de se mostrar e o formulário volta. Cada revelação fica na auditoria (finance.reveal).
const SECONDS = 60;

const VAT: Record<string, string> = { art53: "Isento (art. 53.º do CIVA)", normal: "Regime normal", outro: "Outro" };

type Revealed = NonNullable<RevealState["data"]>;

function Shown({ d, onDone }: { d: Revealed; onDone: () => void }) {
  const [left, setLeft] = useState(SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);
  return (
    <div className="notice ok-notice" role="status" style={{ display: "block" }}>
      <p style={{ marginBottom: 10 }}>
        <strong>Visível durante mais {left} s.</strong> Use estes dados só para o pagamento e não os guarde fora do processo.
      </p>
      {d.warning && <p className="notice error-notice">{d.warning}</p>}
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
        <dt>IBAN</dt>
        <dd style={{ margin: 0, fontFamily: "monospace", fontSize: 14 }}>{d.iban || "Sem IBAN confirmado"}</dd>
        <dt>Titular</dt>
        <dd style={{ margin: 0 }}>
          {d.holder || "—"} {d.holderMismatch && <span className="pill warn">Diferente do nome fiscal</span>}
        </dd>
        {d.fiscal ? (
          <>
            <dt>Nome fiscal</dt>
            <dd style={{ margin: 0 }}>{d.fiscal.fiscal_name || "—"}</dd>
            <dt>NIF</dt>
            <dd style={{ margin: 0, fontFamily: "monospace" }}>
              {d.fiscal.nif || "—"} {d.fiscal.tax_country ? `(${d.fiscal.tax_country})` : ""}
            </dd>
            <dt>Morada fiscal</dt>
            <dd style={{ margin: 0 }}>{d.fiscal.fiscal_address || "—"}</dd>
            <dt>IVA</dt>
            <dd style={{ margin: 0 }}>{VAT[d.fiscal.vat_regime] || d.fiscal.vat_regime || "—"}</dd>
            <dt>Retenção na fonte</dt>
            <dd style={{ margin: 0 }}>{d.fiscal.withholding_waiver ? "Dispensa declarada (art. 101.º-B do CIRS)" : "Sem dispensa"}</dd>
            {d.fiscal.activity_code && (
              <>
                <dt>Código de atividade</dt>
                <dd style={{ margin: 0 }}>{d.fiscal.activity_code}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>Dados fiscais</dt>
            <dd style={{ margin: 0 }}>Por preencher</dd>
          </>
        )}
        {d.pendingLast4 && (
          <>
            <dt>IBAN novo</dt>
            <dd style={{ margin: 0 }}>Por confirmar pelo titular (termina em {d.pendingLast4}): não o use.</dd>
          </>
        )}
      </dl>
      <button type="button" className="secondary-button" style={{ marginTop: 12 }} onClick={onDone}>Esconder já</button>
    </div>
  );
}

export function RevealFinance({ creatorId, hold, holdUntil }: { creatorId: string; hold: boolean; holdUntil: string | null }) {
  const [state, action, pending] = useActionState<RevealState, FormData>(revealCreatorFinance, {});
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  const d = state.data && state.data.at !== hiddenAt ? state.data : null;

  if (d) return <Shown key={d.at} d={d} onDone={() => setHiddenAt(d.at)} />;
  return (
    <form action={action} className="form-grid" autoComplete="off">
      <input type="hidden" name="id" value={creatorId} />
      {state.error && (
        <div role="alert" className="notice error-notice wide">
          <span>{state.error}</span>
        </div>
      )}
      <label className="wide">
        Motivo (fica registado)
        <input name="reason" required minLength={5} maxLength={300} placeholder="Ex.: pagamento da campanha de Natal" />
      </label>
      <label>
        A sua palavra-passe do dashboard
        <input name="password" type="password" required autoComplete="current-password" />
      </label>
      {hold && (
        <label className="check wide">
          <input type="checkbox" name="oob" required />
          <span>
            Confirmei o IBAN com o criador por telefone ou por outro canal. O IBAN mudou há pouco{holdUntil ? ` e está em espera até ${holdUntil}` : ""}.
          </span>
        </label>
      )}
      <p className="field-help wide">
        Máximo de 20 revelações por pessoa em 24 horas; à 10.ª, os Super Admin recebem um aviso. Cinco palavras-passe erradas bloqueiam a sua conta durante 15
        minutos.
      </p>
      <div className="wide form-actions">
        <button type="submit" disabled={pending}>{pending ? "A revelar…" : "Revelar IBAN e dados fiscais"}</button>
      </div>
    </form>
  );
}
