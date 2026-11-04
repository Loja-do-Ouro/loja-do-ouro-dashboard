import { siteBase } from "@/lib/criadores/site";
import { Identity, LegalBody, LegalHead, loadLegal } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dados obtidos da Meta" };

// Instruções de eliminação exigidas pela Meta para as duas camadas (§7.1, rev. META-4), publicadas no backoffice
// (seed meta_data). O estado de um pedido de eliminação (?codigo=) chega com o PR 3B.
export default async function MetaDataPage() {
  const [base, page] = await Promise.all([siteBase(), loadLegal("meta_data")]);
  const contact = page.company?.privacy_email || "privacidade@lojadoouro.pt";
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <LegalHead title="Dados obtidos da Meta" doc={page.document} />
          <LegalBody page={page} base={base} fallback={
            <div className="cr-prosa">
              <h2>Como apagar os dados que obtivemos através da Meta</h2>
              <ul>
                <li><em>Dados públicos do Instagram:</em> em Redes, «Parar a leitura e apagar os dados públicos». Apagamos tudo de imediato.</li>
                <li>
                  <em>Instagram ligado:</em> em Redes, «Desligar e apagar os dados». Apagamos tudo de imediato. Também pode remover a app «Loja do Ouro Criadores» na
                  Meta: se ligou pelo Facebook, em Facebook → Definições e privacidade → Definições → Apps e sites (ou Integrações empresariais); se ligou pelo
                  portefólio de negócios, em Definições do negócio → Integrações → Apps ligadas.
                </li>
                <li>
                  <em>Pedido de eliminação feito na Meta:</em> recebemo-lo automaticamente, apagamos os dados das duas formas e damos-lhe um código para acompanhar o
                  pedido nesta página.
                </li>
                <li>Também pode escrever para <a href={`mailto:${contact}`}>{contact}</a>.</li>
              </ul>
              <p>Nesta fase a plataforma ainda não lê dados da Meta: estas opções aparecem em Redes quando estiverem disponíveis.</p>
            </div>
          } />
          <section className="cr-bloco" aria-labelledby="t-resp">
            <div className="cr-bloco-cab"><h2 id="t-resp" className="cr-d-s">Responsável pelo tratamento</h2></div>
            <Identity company={page.company} />
          </section>
        </div>
      </div>
    </div>
  );
}
