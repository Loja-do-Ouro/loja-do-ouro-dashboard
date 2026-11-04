import { siteBase } from "@/lib/criadores/site";
import { Identity, LegalBody, LegalHead, loadLegal } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Termos de participação" };

export default async function TermsPage() {
  const [base, page] = await Promise.all([siteBase(), loadLegal("terms")]);
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <LegalHead title="Termos de participação" doc={page.document} />
          <LegalBody page={page} base={base} />
          <section className="cr-bloco" aria-labelledby="t-empresa">
            <div className="cr-bloco-cab"><h2 id="t-empresa" className="cr-d-s">Quem somos</h2></div>
            <Identity company={page.company} />
          </section>
        </div>
      </div>
    </div>
  );
}
