import { CONSENT_TEXT, VAT_REGIME_LABEL, lisbonDate, lisbonDateTime } from "@/lib/criadores-rules";
import { getMyFinance } from "@/lib/criadores/crypto";
import { requireCreator } from "@/lib/criadores/site";
import { FinanceForm, IbanResendForm } from "../forms";
import { Aviso, IbanTail, PageHead } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pagamentos" };

// Dados de pagamento (F3, §4.3 /pagamentos, rev. S-A1): dados fiscais (NIF validado) e IBAN, com a palavra-passe.
// O IBAN nunca é mostrado inteiro (só os 4 últimos). Um IBAN novo, também o primeiro, fica pendente até ser
// confirmado na ligação do email; depois, os pagamentos esperam 72 h. Histórico de pagamentos no PR2.
export default async function PaymentsPage() {
  const { session, me } = await requireCreator();
  const f = await getMyFinance(session, me.id);
  const holdFuture = f?.iban_hold_until && Date.parse(f.iban_hold_until) > Date.now();
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu="A sua conta" title="Pagamentos"
            lead="Os dados para receber as contrapartidas das campanhas. Ficam cifrados: só quem trata dos pagamentos os vê, com o motivo registado." />

          <dl className="cr-ficha">
            <dt>IBAN em uso</dt>
            <dd className="cr-num">
              {f?.iban_last4 ? <>{f.iban_country ? `${f.iban_country} ` : ""}<IbanTail last4={f.iban_last4} /></> : "Nenhum"}
              {f?.iban_changed_at && <span className="cr-meta" style={{ display: "block" }}>desde {lisbonDate(f.iban_changed_at)}</span>}
              {holdFuture && <span className="cr-meta" style={{ display: "block" }}>Os pagamentos para este IBAN esperam até {lisbonDateTime(f!.iban_hold_until)}.</span>}
            </dd>
            <dt>IBAN por confirmar</dt>
            <dd className="cr-num">
              {f?.iban_pending_last4 ? <>IBAN terminado em {f.iban_pending_last4.slice(-4)} à espera de confirmação{f.iban_pending_at && <span className="cr-meta" style={{ display: "block" }}>pedido a {lisbonDateTime(f.iban_pending_at)}</span>}</> : "Nenhum"}
            </dd>
            <dt>Dados fiscais</dt>
            <dd>{f?.fiscal_complete ? "Completos" : f?.fiscal ? "Incompletos" : "Por preencher"}{f?.fiscal?.vat_regime && <span className="cr-meta" style={{ display: "block" }}>{VAT_REGIME_LABEL[f.fiscal.vat_regime]}</span>}</dd>
          </dl>

          {f?.iban_pending_last4 && (
            <Aviso title={`IBAN terminado em ${f.iban_pending_last4} à espera de confirmação`}>
              <p>Enviámos um email para {me.email} com a ligação para confirmar. Até confirmar, continua a valer o anterior. Se não encontrar o email, veja a pasta de spam ou peça outro.</p>
              <IbanResendForm />
            </Aviso>
          )}
          {f?.fiscal_error && <Aviso tone="erro" title="Dados fiscais"><p>{f.fiscal_error}</p></Aviso>}
          {me.status === "suspended" && <Aviso tone="erro"><p>Com a conta suspensa não é possível mudar o IBAN.</p></Aviso>}

          <div className="cr-bloco">
            <FinanceForm
              data={{ fiscal: f?.fiscal ?? null, hasIban: Boolean(f?.iban_last4 || f?.iban_pending_last4), email: me.email }}
              texts={{ iban_owner: CONSENT_TEXT.iban_owner, vat_exempt: CONSENT_TEXT.vat_exempt, withholding_waiver: CONSENT_TEXT.withholding_waiver }} />
          </div>
        </div>
        <aside className="cr-c9-4" aria-label="Notas" style={{ marginTop: 56 }}>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">1</span>Quando é preciso</h2>
            <p>O IBAN e os dados fiscais só são obrigatórios quando for selecionado para uma campanha com pagamento. Numa permuta, só os dados fiscais.</p>
          </div>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">2</span>Porque confirmamos o IBAN</h2>
            <p>Se alguém entrar na sua conta e mudar o IBAN, o email de confirmação chega-lhe a si. «Não fui eu» cancela o pedido e termina todas as sessões.</p>
          </div>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">3</span>Faturas</h2>
            <p>A fatura-recibo é emitida por si no Portal das Finanças; a plataforma só regista o número.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
