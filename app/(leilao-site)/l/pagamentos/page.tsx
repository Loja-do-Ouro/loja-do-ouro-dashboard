import Link from "next/link";
import { eur } from "@/lib/leilao-rules";
import { pubSettings, siteBase } from "@/lib/leilao/site";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pagamentos e caução" };

// Formas de pagamento e caução, explicadas ao cliente (valores das regras do backoffice).
export default async function Payments() {
  const [base, s] = await Promise.all([siteBase(), pubSettings()]);
  const methods = s?.payment_methods ?? ["mb", "mbw", "cc"];
  const hold = s?.hold_days ?? 5;
  const pct = s ? String(s.deposit_percent).replace(".", ",") : "10";
  return (
    <div className="lx-narrow lx-prose">
      <span className="lx-eyebrow">Pagamentos seguros</span>
      <h1>Pagamentos e caução</h1>
      <p className="lx-muted">
        Os pagamentos são processados pela easypay, instituição de pagamento portuguesa autorizada e supervisionada pelo Banco de Portugal. Nunca vemos nem
        guardamos os dados do seu cartão.
      </p>

      <h2>Como pode pagar um lote ganho</h2>
      <div className="lx-paygrid">
        {methods.includes("mb") && (
          <div className="lx-card lx-card-pad">
            <h3>Multibanco</h3>
            <p className="lx-small lx-muted" style={{ margin: 0 }}>Geramos uma referência (entidade, referência e montante) para pagar no multibanco ou no homebanking, válida até ao fim do prazo.</p>
          </div>
        )}
        {methods.includes("mbw") && (
          <div className="lx-card lx-card-pad">
            <h3>MB WAY</h3>
            <p className="lx-small lx-muted" style={{ margin: 0 }}>Recebe o pedido no telemóvel e aprova na app. Confirmação imediata.</p>
          </div>
        )}
        {methods.includes("cc") && (
          <div className="lx-card lx-card-pad">
            <h3>Cartão</h3>
            <p className="lx-small lx-muted" style={{ margin: 0 }}>Visa ou Mastercard, num formulário seguro da easypay aqui mesmo, sem sair do site, com 3-D Secure do seu banco.</p>
          </div>
        )}
      </div>
      <ul>
        <li>Paga só o preço final do lote: <strong>não há comissão do comprador</strong> nem taxas de pagamento.</li>
        <li>Prazo: {s?.payment_hours ?? 48} horas depois do fecho. O botão de pagamento aparece na página do lote e na sua conta.</li>
        <li>Também aceitamos transferência bancária ou pagamento numa das nossas lojas: fale connosco{s?.contact_email ? ` (${s.contact_email})` : ""}.</li>
        <li>{s ? `Licitações a partir de ${eur(s.verified_threshold)} exigem conta verificada. ` : ""}Pagamentos em numerário estão limitados por lei a 3 000 €.</li>
      </ul>

      <h2>Caução: o que é</h2>
      <p>
        Nos lotes de valor elevado{s ? ` (base a partir de ${eur(s.deposit_threshold)})` : ""} pedimos, antes da primeira licitação, uma caução de {pct}% da
        base{s ? `, com o mínimo de ${eur(s.deposit_min)}` : ""}. É uma <strong>cativação</strong>: o valor fica reservado no seu cartão ou na sua conta
        MB WAY, mas <strong>não é cobrado</strong>. Funciona como a reserva de um hotel ou de um aluguer de carro.
      </p>
      <table>
        <thead><tr><th>Se…</th><th>Acontece</th></tr></thead>
        <tbody>
          <tr><td>não ganhar o lote</td><td>A cativação é anulada logo depois do fecho. O valor volta a estar disponível (o banco pode demorar alguns dias a mostrá-lo).</td></tr>
          <tr><td>ganhar e pagar</td><td>A cativação é anulada quando o pagamento do lote é confirmado. Não paga a caução e o lote em duplicado.</td></tr>
          <tr><td>ganhar e não pagar no prazo</td><td>A caução é cobrada, a título de compensação pelos custos e pelo leilão perdido (regulamento, ponto 8).</td></tr>
          <tr><td>o lote durar mais de {hold} dias</td><td>Os bancos só mantêm a cativação alguns dias. Se caducar, pedimos para a renovar antes de voltar a licitar.</td></tr>
        </tbody>
      </table>

      <h2>Porque pedimos caução</h2>
      <ul>
        <li>
          <strong>Protege quem licita a sério.</strong> Num lote de vários milhares de euros, uma licitação sem intenção de compra faz perder o lote a quem
          licitou de boa-fé (que ficou em segundo lugar) e obriga a repetir o leilão. A caução afasta licitações falsas e contas criadas só para inflacionar preços.
        </li>
        <li>
          <strong>Garante um preço justo.</strong> Se todos os licitantes de um lote alto mostraram capacidade de pagamento, o preço final é real, e é esse o
          preço que o vencedor paga, sem comissão.
        </li>
        <li>
          <strong>Não lhe custa nada.</strong> Não há cobrança nem comissão: só uma reserva temporária, anulada automaticamente se não ganhar. Os lotes
          mais acessíveis não pedem caução.
        </li>
        <li>
          <strong>É prática comum.</strong> As leiloeiras de joias e relógios pedem habitualmente depósito ou pré-autorização em lotes de valor elevado; nós
          usamos a forma mais leve, a cativação no cartão ou no MB WAY, em vez de um depósito por transferência.
        </li>
        <li>
          <strong>Ajuda-nos a cumprir a lei.</strong> Em vendas de metais preciosos de valor elevado temos deveres de identificação dos compradores
          (prevenção do branqueamento de capitais); a cativação confirma que o meio de pagamento é válido e está em nome do licitante.
        </li>
      </ul>

      <h2>Segurança</h2>
      <p>
        Os pedidos de pagamento são criados no nosso servidor e confirmados diretamente na easypay. Os dados do cartão são escritos num formulário da
        easypay embutido nesta página: seguem diretamente para a easypay, com 3-D Secure, e nunca passam pelo nosso servidor. Se tiver dúvidas sobre uma cativação, escreva-nos{s?.contact_email ? ` para ${s.contact_email}` : ""}.
      </p>
      <p style={{ marginTop: 28 }}>
        <Link className="lx-btn" href={base || "/"}>Ver leilões</Link>{" "}
        <Link className="lx-btn lx-btn-ghost" href={`${base}/regulamento`}>Regulamento</Link>
      </p>
    </div>
  );
}
