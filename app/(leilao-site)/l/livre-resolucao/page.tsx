import { aucMe, auctionSession, pubSettings } from "@/lib/leilao/site";
import { WithdrawalForm } from "../forms";
import { DraftNote, Identity } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Livre resolução" };

// Direito de livre resolução (DL 24/2014) com o botão/formulário de desistência online e o modelo do anexo.
export default async function Withdrawal() {
  const [s, session] = await Promise.all([pubSettings(), auctionSession()]);
  const me = session ? await aucMe(session).catch(() => null) : null;
  return (
    <div className="lx-narrow lx-prose">
      <span className="lx-eyebrow">Os seus direitos</span>
      <h1>Desistir da compra (livre resolução)</h1>
      <DraftNote version={s?.terms_version} />
      <p>
        Tem 14 dias, a contar do dia em que recebe a peça (ou a levanta na loja), para desistir da compra sem indicar motivo. Basta enviar-nos a declaração
        abaixo dentro desse prazo. Recebe logo uma cópia por email, com a data e a hora.
      </p>
      <div className="lx-card lx-card-pad" style={{ margin: "24px 0 32px" }}>
        <h2 style={{ marginTop: 0 }}>Formulário de livre resolução</h2>
        <WithdrawalForm name={me?.name} email={me?.email} />
      </div>

      <h2>O que acontece a seguir</h2>
      <ul>
        <li>Devolve a peça no prazo de 14 dias a contar da declaração, numa das nossas lojas (sem custos) ou por envio com seguro (custo a seu cargo).</li>
        <li>Reembolsamos o valor pago, incluindo os portes de envio normais, em 14 dias a contar da declaração, pelo mesmo meio de pagamento. Podemos esperar pela receção da peça.</li>
        <li>A peça deve ser devolvida no estado em que a recebeu, com o certificado e a embalagem, se existirem.</li>
      </ul>

      <h2>Modelo de declaração</h2>
      <p>Também pode enviar esta declaração por email ou carta para:</p>
      <Identity s={s} />
      <blockquote className="lx-card lx-card-pad" style={{ margin: 0 }}>
        Pela presente comunico que resolvo o meu contrato de compra e venda do seguinte bem: [lote e descrição]. Recebido em [data]. Nome: [nome]. Morada:
        [morada]. Assinatura (só no envio em papel). Data: [data].
      </blockquote>
    </div>
  );
}
