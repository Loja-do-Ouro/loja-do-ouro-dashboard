import { IbanDecisionForms } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar o IBAN", referrer: "no-referrer" };

// Ligação do email de confirmação do IBAN: /conta/iban#t=… [rev. S-A1, S-B11]. O GET não chama a BD. Os 4 últimos
// caracteres do IBAN estão no email (não vão no endereço). Dois POST: «Confirmar este IBAN» e «Não fui eu».
export default function IbanConfirmPage() {
  return (
    <div className="cr-env">
      <div className="cr-auth">
        <p className="cr-chapeu">Dados de pagamento</p>
        <h1 className="cr-d-l">Confirmar o IBAN</h1>
        <p className="cr-lead" style={{ marginBottom: 16 }}>Confira os 4 últimos caracteres do IBAN no email que recebeu.</p>
        <p style={{ marginBottom: 24 }}>
          Se foi a pessoa que pediu, confirme. O IBAN passa a valer para os pagamentos 72 horas depois, por segurança. Se não reconhece este pedido, carregue em
          «Não fui eu».
        </p>
        <IbanDecisionForms />
      </div>
    </div>
  );
}
