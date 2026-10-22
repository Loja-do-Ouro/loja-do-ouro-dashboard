import Link from "next/link";
import { pubSettings, siteBase } from "@/lib/leilao/site";
import { DraftNote, Identity } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Termos e condições" };

export default async function Terms() {
  const [base, s] = await Promise.all([siteBase(), pubSettings()]);
  return (
    <div className="lx-narrow lx-prose">
      <span className="lx-eyebrow">Leilão Loja do Ouro</span>
      <h1>Termos e condições de utilização</h1>
      <DraftNote version={s?.terms_version} />

      <h2>1. Quem somos</h2>
      <Identity s={s} />

      <h2>2. A conta</h2>
      <ul>
        <li>A conta é pessoal e intransmissível. É responsável por manter a palavra-passe em segredo e pelas licitações feitas com a sua conta.</li>
        <li>Os dados do registo devem ser verdadeiros e atualizados. Podemos pedir a confirmação da identidade antes de aceitar licitações de valor elevado.</li>
        <li>Pode apagar a conta a qualquer momento na área «A minha conta», salvo se liderar um lote aberto ou tiver uma compra por concluir.</li>
      </ul>

      <h2>3. Licitar e comprar</h2>
      <p>
        As regras das licitações, do fecho, da reserva, da caução, do pagamento e da entrega estão no <Link href={`${base}/regulamento`}>regulamento do
        leilão</Link>, que faz parte destes termos. O contrato de compra e venda fica celebrado com a adjudicação do lote no fecho.
      </p>

      <h2>4. Informação pré-contratual</h2>
      <p>
        Antes de licitar, a página de cada lote indica as características essenciais da peça, o preço (sem comissão), os meios de pagamento, a entrega, a
        garantia e o direito de livre resolução, nos termos do Decreto-Lei n.º 24/2014. Enviamos a confirmação do contrato por email.
      </p>

      <h2>5. Garantia e livre resolução</h2>
      <p>
        Garantia legal de {s ? Math.round(s.new_warranty_months / 12) : 3} anos nas peças novas e de {s?.used_warranty_months ?? 18} meses nas usadas
        (acordo aceite no registo). Direito de livre resolução de 14 dias a contar da entrega: <Link href={`${base}/livre-resolucao`}>como exercer</Link>.
      </p>

      <h2>6. Utilização do site</h2>
      <ul>
        <li>Não é permitido usar programas automáticos para licitar ou consultar o site, nem tentar perturbar o seu funcionamento.</li>
        <li>As fotografias e textos dos lotes pertencem à Loja do Ouro e não podem ser reutilizados sem autorização.</li>
        <li>Fazemos o possível para manter o site sempre disponível. Se uma falha técnica afetar o fecho de um lote, podemos prolongá-lo ou repeti-lo, avisando os licitantes.</li>
      </ul>

      <h2>7. Reclamações e litígios</h2>
      <p>
        Pode reclamar para {s?.contact_email || "apoiocliente@lojadoouro.pt"} ou no{" "}
        <a href="https://www.livroreclamacoes.pt" target="_blank" rel="noopener noreferrer">Livro de Reclamações Eletrónico</a>. Em caso de litígio de
        consumo, pode recorrer à entidade de resolução alternativa de litígios: {s?.ral_entity || "[entidade a indicar]"}. Mais informação no Portal do
        Consumidor (<a href="https://www.consumidor.gov.pt" target="_blank" rel="noopener noreferrer">consumidor.gov.pt</a>). Aplica-se a lei portuguesa.
      </p>
    </div>
  );
}
