import Link from "next/link";
import { redirect } from "next/navigation";
import { consentText } from "@/lib/criadores-rules";
import { requireCreator, siteBase } from "@/lib/criadores/site";
import { LegalMarkdown, loadLegal } from "../../legal";
import { AcceptTermsForm } from "../../forms";
import { Aviso, PageHead } from "../../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Termos atualizados" };

// Termos publicados com «exige nova aceitação» (me.reaccept): o texto, o resumo das mudanças e «Aceito». As outras
// páginas da conta mandam para aqui até aceitar (requireCreator), salvo Definições (exportar e apagar) e Redes (parar
// a leitura dos dados públicos). Só os Termos bloqueiam; uma Política nova é só um aviso no topo [rev. R-M6].
export default async function NewTermsPage() {
  const [base, { me }] = await Promise.all([siteBase(), requireCreator({ allowReaccept: true })]);
  if (!me.reaccept.length) redirect(`${base}/painel`);
  const page = await loadLegal("terms");
  const doc = page.document;
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu="Antes de continuar" title="Atualizámos os Termos de participação"
            lead={doc ? `Versão ${doc.version}. Leia as mudanças e aceite para continuar a usar a conta.` : undefined} />
          {doc ? (
            <>
              {doc.changes_summary && <Aviso title="O que mudou">{<p>{doc.changes_summary}</p>}</Aviso>}
              <details className="cr-bloco" style={{ marginTop: 24 }}>
                <summary className="cr-lig">Ler os Termos completos</summary>
                <LegalMarkdown body={doc.body} base={base} />
              </details>
              <div className="cr-bloco">
                <AcceptTermsForm docId={doc.id} text={consentText("terms", { versao: doc.version })} />
              </div>
              <p className="cr-pequeno" style={{ marginTop: 24 }}>
                Se não concordar, pode descarregar os seus dados ou apagar a conta em Definições, sem aceitar. Se autorizou a leitura dos dados públicos do
                Instagram, também a pode parar em <Link href={`${base}/redes#t-ig`}>Redes</Link>, sem aceitar.
              </p>
            </>
          ) : (
            <Aviso tone="erro" title="Não foi possível abrir os Termos">
              <p>Recarregue a página dentro de momentos.</p>
            </Aviso>
          )}
        </div>
      </div>
    </div>
  );
}
