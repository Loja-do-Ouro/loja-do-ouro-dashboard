import Link from "next/link";
import { siteBase } from "@/lib/criadores/site";
import { PageHead } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Como funciona" };

// Explicação longa (§4.3): os passos, as regras de publicidade (#PUB/#OFERTA no início, guia da DGC), como a equipa
// decide (uma pessoa, sem pontuação) e o que acontece aos números e aos dados.
export default async function HowItWorks() {
  const base = await siteBase();
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu="O programa de criadores" title="Como funciona"
            lead="O que acontece desde o registo até à publicação, quem decide e com que regras." />
        </div>
      </div>

      <div className="cr-grelha cr-secao" style={{ paddingTop: 56 }}>
        <nav className="cr-c1-3" aria-label="Nesta página">
          <ul className="cr-lista cr-lista-ligacoes" style={{ borderTop: "1px solid var(--cr-tinta)" }}>
            <li><a href="#conta">A conta e o perfil</a></li>
            <li><a href="#decisoes">Como a equipa decide</a></li>
            <li><a href="#numeros">Os seus números</a></li>
            <li><a href="#publicidade">Publicidade bem identificada</a></li>
            <li><a href="#pagamentos">Pagamentos</a></li>
            <li><a href="#dados">Os seus dados</a></li>
          </ul>
        </nav>
        <div className="cr-c4-9 cr-prosa">
          <h2 id="conta" style={{ marginTop: 0 }}>A conta e o perfil</h2>
          <p>
            Crie a conta com o email e uma palavra-passe. Enviamos uma ligação para confirmar o endereço; ao abri-la, escreve a palavra-passe que escolheu.
            Depois preenche o perfil em quatro passos: sobre si, contactos, conteúdo e lojas, e as redes onde publica. Pode parar a meio: cada passo fica guardado.
          </p>
          <p>
            No fim, declara que os dados são verdadeiros e envia o perfil para revisão. Enquanto a equipa o revê, pode continuar a editar; se mudar algo
            importante depois da aprovação, a equipa vê que houve alterações.
          </p>

          <h2 id="decisoes">Como a equipa decide</h2>
          <p>
            Cada perfil, candidatura e pedido é lido por uma pessoa da equipa de marketing da Loja do Ouro, que decide e regista o motivo. Não há nota
            automática, pontuação nem ordenação de criadores. Se o perfil não for aprovado, recebe o motivo por email e pode corrigir e enviar de novo.
          </p>
          <p>
            As campanhas mostram os requisitos e o motivo de cada um (por exemplo, «a campanha é para o público de Lisboa»). Nenhuma candidatura é excluída
            de forma automática: pode candidatar-se a qualquer campanha aberta.
          </p>

          <h2 id="numeros">Os seus números</h2>
          <p>
            Os números das redes que indica (seguidores, visualizações, interação) ficam marcados como <strong>declarado por si, não verificado</strong>.
            A equipa pode validá-los a partir de capturas das estatísticas. Os números servem para a equipa conhecer o seu trabalho, nunca para notas ou rankings.
          </p>
          <p>
            Quando a opção estiver disponível em Redes, também pode autorizar a leitura dos números públicos da sua conta profissional do Instagram
            (seguidores, publicações e, por publicação, gostos, comentários e visualizações de reels). É opcional, tem uma autorização própria e pode parar
            quando quiser: os números lidos são apagados nesse momento. Ligar a conta pela Meta chega mais tarde.
          </p>

          <h2 id="publicidade">Publicidade bem identificada</h2>
          <p>
            Quando publica sobre uma peça ou uma campanha da Loja do Ouro, a publicação é publicidade, mesmo sem pagamento. As regras, de acordo com o guia da
            Direção-Geral do Consumidor sobre a comunicação comercial nas redes sociais, são:
          </p>
          <ul>
            <li>escrever <strong>#PUB</strong> (campanha paga ou permuta) ou <strong>#OFERTA</strong> (peça oferecida) logo no início da publicação, antes do «ver mais»;</li>
            <li>usar o rótulo de parceria da rede («Parceria paga com…»), quando a rede o tiver;</li>
            <li>nos vídeos, dizer ou mostrar a identificação no início;</li>
            <li>dizer a verdade sobre o material, os quilates, a contrastaria e o preço; em dúvida, pergunte à equipa em Mensagens;</li>
            <li>não mostrar menores de 18 anos nos conteúdos.</li>
          </ul>
          <p>Antes de publicar, mostra o conteúdo à equipa, que confirma estes pontos.</p>

          <h2 id="pagamentos">Pagamentos</h2>
          <p>
            Cada campanha diz, por escrito e antes de começar, o que recebe: um valor, uma peça, ou os dois. O pagamento é feito por transferência para o IBAN
            que indicar em Pagamentos, contra a fatura-recibo que emitir. Os dados fiscais e o IBAN ficam cifrados e só quem trata dos pagamentos os vê.
          </p>
          <p>
            Por segurança, um IBAN novo só passa a valer depois de o confirmar na ligação que enviamos para o email da conta, e os pagamentos esperam 72 horas
            depois da confirmação.
          </p>

          <h2 id="dados">Os seus dados</h2>
          <p>
            Pode descarregar todos os seus dados ou apagar a conta em Definições. A <Link href={`${base}/privacidade`}>Política de Privacidade</Link> explica
            que dados tratamos, para quê e durante quanto tempo, e os <Link href={`${base}/termos`}>Termos de participação</Link> dizem as regras do programa.
          </p>

          <div className="cr-acoes" style={{ marginTop: 40 }}>
            <Link className="cr-bt" href={`${base}/conta/registo`}>Criar conta</Link>
            <Link className="cr-lig" href={`${base}/conta/entrar`}>Entrar</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
