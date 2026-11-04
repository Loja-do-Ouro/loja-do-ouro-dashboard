import { siteBase } from "@/lib/criadores/site";
import { Identity, LegalBody, LegalHead, loadLegal } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Política de Privacidade" };

// Política de Privacidade publicada no backoffice (versionada; render seguro do Markdown) e a identificação legal.
export default async function PrivacyPage() {
  const [base, page] = await Promise.all([siteBase(), loadLegal("privacy")]);
  const contact = page.company?.privacy_email || "privacidade@lojadoouro.pt";
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <LegalHead title="Política de Privacidade" doc={page.document} />
          <LegalBody page={page} base={base} fallback={
            <div className="cr-prosa">
              <p>
                Enquanto a versão final não é publicada, pode escrever para <a href={`mailto:${contact}`}>{contact}</a> com qualquer pergunta sobre os seus
                dados. Pode também apresentar reclamação à Comissão Nacional de Proteção de Dados (<a href="https://www.cnpd.pt" target="_blank" rel="noopener noreferrer">www.cnpd.pt</a>).
              </p>
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
