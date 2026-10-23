import Link from "next/link";
import { eur } from "@/lib/leilao-rules";
import { pubSettings, siteBase } from "@/lib/leilao/site";
import { DraftNote, Identity } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Regulamento" };

// Regulamento do leilão. Os valores (prolongamento, incrementos, caução, prazos, garantias) vêm das regras do
// backoffice, para o texto nunca divergir do que o sistema faz.
export default async function Rules() {
  const [base, s] = await Promise.all([siteBase(), pubSettings()]);
  const ext = s?.extend_minutes ?? 10;
  const win = s?.extend_window_seconds ?? 120;
  return (
    <div className="lx-narrow lx-prose">
      <span className="lx-eyebrow">Leilão Loja do Ouro</span>
      <h1>Regulamento do leilão</h1>
      <DraftNote version={s?.terms_version} />

      <h2>1. Organizador</h2>
      <p>Os leilões deste site são organizados pela entidade abaixo, que vende exclusivamente peças próprias (não é uma plataforma de terceiros).</p>
      <Identity s={s} />

      <h2>2. Natureza do leilão</h2>
      <p>
        Trata-se de uma venda à distância, online, em que o preço é formado por licitações sucessivas. Não é uma hasta pública: os compradores que sejam
        consumidores mantêm todos os direitos da venda à distância, incluindo o direito de livre resolução (ponto 10).
      </p>

      <h2>3. Quem pode licitar</h2>
      <ul>
        <li>Pessoas com 18 anos ou mais, com conta registada e email confirmado.</li>
        <li>
          Licitações a partir de {s ? eur(s.verified_threshold) : "um valor definido"} exigem conta verificada (identificação com documento), nos termos da
          Lei n.º 83/2017 (prevenção do branqueamento de capitais). Podemos pedir informação adicional em operações de valor elevado.
        </li>
        <li>Não podem licitar colaboradores do organizador nem os seus familiares diretos.</li>
        <li>Podemos suspender contas com uso abusivo, dados falsos ou licitações sem intenção de compra.</li>
      </ul>

      <h2>4. Lotes</h2>
      <p>
        Cada lote é descrito com fotografias, metal, toque, peso, pedras, marca de contrastaria, estado (nova ou usada) e relatório de estado, como exige o
        regime jurídico da ourivesaria (RJOC). As fotografias são das próprias peças. Antes do leilão, as peças podem ser vistas numa das nossas lojas, por
        marcação.
      </p>

      <h2>5. Licitações</h2>
      <ul>
        <li>
          Há dois tipos de licitação: <strong>direta</strong>, em que o preço do lote passa logo para o valor indicado; e <strong>máximo automático</strong>,
          em que o licitante indica o máximo que aceita pagar e o sistema licita por ele só o necessário para liderar, mantendo esse máximo secreto.
        </li>
        <li>Se o líder tiver um máximo automático igual ou superior a uma nova licitação, o sistema responde por ele com o incremento mínimo, até esse máximo.</li>
        <li>O preço sobe pelos incrementos publicados na página «Como funciona». Em caso de máximos iguais, ganha o que foi registado primeiro.</li>
        <li>As licitações são vinculativas e não podem ser retiradas, salvo erro manifesto comunicado de imediato e aceite pelo organizador.</li>
        <li>A hora oficial é a do servidor do leilão (hora de Lisboa), registada em cada licitação.</li>
      </ul>

      <h2>6. Fecho e prolongamento</h2>
      <p>
        Cada lote tem uma hora de fecho própria. Uma licitação feita nos últimos {win} segundos antes do fecho prolonga o lote, passando o fecho para {ext}
        {" "}minutos depois dessa licitação; o prolongamento repete-se as vezes necessárias. Os licitantes desse lote são avisados por email.
      </p>

      <h2>7. Preço de reserva</h2>
      <p>
        O organizador pode fixar um preço de reserva confidencial. Se não for atingido, o lote não é vendido e nenhuma das partes fica obrigada. A página do
        lote indica se existe reserva e se já foi atingida.
      </p>

      <h2>8. Caução</h2>
      <p>
        {s
          ? `Nos lotes com base a partir de ${eur(s.deposit_threshold)} é pedida uma caução de ${String(s.deposit_percent).replace(".", ",")}% da base, com o mínimo de ${eur(s.deposit_min)}. `
          : "Nos lotes de valor elevado é pedida uma caução. "}
        A caução é cativa no meio de pagamento (cartão ou MB WAY) através da easypay, sem cobrança. É libertada após o fecho se o licitante não ganhar e,
        se ganhar, quando o pagamento do lote for confirmado. Se o vencedor não pagar no prazo, a caução pode ser retida a título de compensação, na medida permitida por lei.
      </p>

      <h2>9. Adjudicação, preço e pagamento</h2>
      <ul>
        <li>O lote é adjudicado a quem liderar no fecho, se a reserva tiver sido atingida.</li>
        <li>Não há comissão do comprador. O preço final inclui IVA quando aplicável (as peças usadas podem estar sujeitas ao regime da margem).</li>
        <li>O pagamento é feito em {s?.payment_hours ?? 48} horas após o fecho, por Multibanco, MB WAY ou cartão (easypay), por transferência ou numa das nossas lojas (<Link href={`${base}/pagamentos`}>pagamentos e caução</Link>).</li>
        <li>Envio com seguro (portes indicados antes do pagamento) ou levantamento gratuito numa das nossas lojas, com identificação.</li>
        <li>Se o pagamento não for feito no prazo, o organizador pode anular a adjudicação e propor o lote ao licitante seguinte.</li>
      </ul>

      <h2>10. Direito de livre resolução</h2>
      <p>
        O consumidor pode desistir da compra no prazo de 14 dias a contar da entrega da peça, sem indicar motivo e sem custos além da devolução, nos termos do
        Decreto-Lei n.º 24/2014. Basta usar o <Link href={`${base}/livre-resolucao`}>formulário de livre resolução</Link> ou enviar-nos uma declaração
        inequívoca. O reembolso é feito em 14 dias pelo mesmo meio de pagamento.
      </p>

      <h2>11. Garantia</h2>
      <p>
        Peças novas: garantia de {s ? Math.round(s.new_warranty_months / 12) : 3} anos. Peças usadas: garantia de {s?.used_warranty_months ?? 18} meses,
        por acordo expresso aceite no registo (Decreto-Lei n.º 84/2021). A garantia não cobre desgaste normal nem danos por uso indevido.
      </p>

      <h2>12. Dados pessoais</h2>
      <p>Os dados são tratados de acordo com a <Link href={`${base}/privacidade`}>política de privacidade</Link>.</p>

      <h2>13. Alterações, lei e litígios</h2>
      <p>
        O organizador pode cancelar ou retirar lotes antes do fecho, avisando os licitantes. Alterações a este regulamento não se aplicam a leilões a decorrer.
        Aplica-se a lei portuguesa. Em caso de litígio, o consumidor pode recorrer a uma entidade de resolução alternativa de litígios
        ({s?.ral_entity || "entidade a indicar"}) e ao Livro de Reclamações Eletrónico.
      </p>
    </div>
  );
}
