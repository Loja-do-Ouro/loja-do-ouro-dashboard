import Link from "next/link";
import { pubSettings, siteBase } from "@/lib/leilao/site";
import { DraftNote, Identity } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Política de privacidade" };

export default async function Privacy() {
  const [base, s] = await Promise.all([siteBase(), pubSettings()]);
  const contact = s?.contact_email || "apoiocliente@lojadoouro.pt";
  return (
    <div className="lx-narrow lx-prose">
      <span className="lx-eyebrow">Leilão Loja do Ouro</span>
      <h1>Política de privacidade</h1>
      <DraftNote version={s?.terms_version} />

      <h2>1. Responsável pelo tratamento</h2>
      <Identity s={s} />
      <p>Para qualquer questão sobre os seus dados: <a href={`mailto:${contact}`}>{contact}</a>.</p>

      <h2>2. Que dados tratamos, para quê e com que fundamento</h2>
      <table>
        <thead><tr><th>Dados</th><th>Finalidade</th><th>Fundamento (RGPD art. 6.º)</th></tr></thead>
        <tbody>
          <tr><td>Nome, email, palavra-passe (guardada cifrada), telemóvel</td><td>Criar e gerir a conta, permitir licitar, enviar avisos do leilão</td><td>Execução do contrato</td></tr>
          <tr><td>Licitações, máximos, favoritos, data e hora</td><td>Funcionamento do leilão e prova dos contratos</td><td>Execução do contrato; interesse legítimo (defesa em litígios)</td></tr>
          <tr><td>NIF, morada, data de nascimento</td><td>Faturação, entrega, confirmação da maioridade</td><td>Obrigação legal; execução do contrato</td></tr>
          <tr><td>Documento de identificação (conta verificada)</td><td>Prevenção do branqueamento de capitais</td><td>Obrigação legal (Lei n.º 83/2017)</td></tr>
          <tr><td>Impressão digital da ligação (hash do IP, sem o IP em claro)</td><td>Segurança: limitar tentativas de entrada e abusos</td><td>Interesse legítimo</td></tr>
          <tr><td>Email para novidades</td><td>Avisar dos próximos leilões</td><td>Consentimento (pode retirá-lo a qualquer momento)</td></tr>
        </tbody>
      </table>
      <p>Nos leilões o seu nome nunca é mostrado: aparece um pseudónimo atribuído automaticamente. Não fazemos decisões automatizadas nem perfis de publicidade.</p>

      <h2>3. Durante quanto tempo</h2>
      <ul>
        <li>Conta: enquanto estiver ativa. Se a apagar, retiramos logo os dados pessoais; as licitações ficam só com o pseudónimo.</li>
        <li>Faturas e registos de venda: 10 anos (obrigação fiscal).</li>
        <li>Identificação para prevenção do branqueamento de capitais: 7 anos após a operação (Lei n.º 83/2017).</li>
        <li>Registos de segurança (tentativas de entrada): 30 dias.</li>
      </ul>

      <h2>4. Com quem partilhamos</h2>
      <p>Só com prestadores que tratam os dados por nossa conta, com contrato e garantias adequadas:</p>
      <ul>
        <li>Supabase (base de dados, alojada na União Europeia) e Vercel (alojamento do site);</li>
        <li>Resend (envio dos emails do leilão);</li>
        <li>easypay (cauções e pagamentos; instituição de pagamento autorizada pelo Banco de Portugal);</li>
        <li>Klaviyo (emails de novidades, só com o seu consentimento);</li>
        <li>transportadoras, para a entrega das peças compradas.</li>
      </ul>
      <p>
        Alguns destes prestadores podem tratar dados fora do Espaço Económico Europeu, sempre com as cláusulas contratuais-tipo da Comissão Europeia ou outra
        garantia prevista no RGPD. Comunicamos dados às autoridades quando a lei o exige.
      </p>

      <h2>5. Os seus direitos</h2>
      <p>
        Pode pedir o acesso, a retificação, o apagamento, a limitação, a portabilidade e opor-se ao tratamento baseado em interesse legítimo. Na área{" "}
        <Link href={`${base}/conta?tab=privacidade`}>A minha conta → Privacidade</Link> pode descarregar os seus dados e apagar a conta sozinho. Para os
        restantes pedidos escreva para {contact}; respondemos no prazo de um mês. Pode também apresentar reclamação à Comissão Nacional de Proteção de Dados
        (<a href="https://www.cnpd.pt" target="_blank" rel="noopener noreferrer">cnpd.pt</a>).
      </p>

      <h2>6. Segurança</h2>
      <p>
        Ligações cifradas (HTTPS), palavras-passe guardadas com bcrypt, sessões guardadas só como impressão digital, acesso da equipa limitado e registado.
        Cookies: veja a <Link href={`${base}/cookies`}>política de cookies</Link>.
      </p>
    </div>
  );
}
