import Link from "next/link";
import { redirect } from "next/navigation";
import { consentText } from "@/lib/criadores-rules";
import { crLegalPublic } from "@/lib/criadores/db";
import { creatorsReady, loadCreator, siteBase } from "@/lib/criadores/site";
import { RegisterForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta" };

// Registo (F1, §4.3): três caixas separadas e desmarcadas (18+, Termos publicados, Política «li»), sem marketing
// [rev. R-B6]. Com as inscrições fechadas, ou o site ainda sem domínio e chaves (creatorsReady, rev. S-M4), mostra
// «em breve» e não recolhe nada, nem o email. Os textos das caixas saem de CONSENT_TEXT com as versões publicadas;
// a server action volta a calculá-los (nunca os lê do formulário, rev. R-B1).
export default async function RegisterPage() {
  const [base, ctx] = await Promise.all([siteBase(), loadCreator().catch(() => null)]);
  if (ctx) redirect(`${base}/painel`);
  const legal = creatorsReady() ? await crLegalPublic(null).catch(() => null) : null;
  const terms = legal?.documents.find((d) => d.kind === "terms");
  const privacy = legal?.documents.find((d) => d.kind === "privacy");
  const open = Boolean(legal?.registrations_open && terms && privacy);
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-7 cr-auth" style={{ maxWidth: "none" }}>
          <p className="cr-chapeu">Programa de criadores</p>
          <h1 className="cr-d-l">Criar conta</h1>
          {open && terms && privacy ? (
            <>
              <p className="cr-lead" style={{ marginBottom: 32 }}>Primeiro a conta; depois, o perfil em quatro passos curtos. Pode parar a meio.</p>
              <RegisterForm base={base} termsDoc={terms.id} privacyDoc={privacy.id}
                texts={{ adult: consentText("adult"), terms: consentText("terms", { versao: terms.version }), privacy: consentText("privacy_notice", { versao: privacy.version }) }} />
              <p className="cr-pequeno" style={{ marginTop: 24 }}>Já tem conta? <Link href={`${base}/conta/entrar`}>Entre aqui</Link>.</p>
            </>
          ) : (
            <>
              <p className="cr-lead">As inscrições abrem em breve.</p>
              <p>Estamos a preparar os Termos de participação e a Política de Privacidade com o nosso advogado. Quando estiverem publicados, abrimos as inscrições nesta página.</p>
              <div className="cr-acoes">
                <Link className="cr-lig" href={`${base}/como-funciona`}>Ver como funciona</Link>
                <Link className="cr-lig" href={`${base}/conta/entrar`}>Já tenho conta</Link>
              </div>
            </>
          )}
        </div>
        <aside className="cr-c9-4 cr-auth" aria-label="Notas" style={{ maxWidth: "none" }}>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">1</span>O que acontece a seguir</h2>
            <p>Enviamos um email para confirmar o endereço. Ao abrir a ligação, escreve a palavra-passe que escolheu aqui.</p>
          </div>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">2</span>O seu nome</h2>
            <p>O nome civil fica privado e serve para os contratos e os pagamentos. O nome artístico indica-se no perfil.</p>
          </div>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">3</span>Sem novidades por email</h2>
            <p>O registo não inclui marketing. Os avisos de campanhas novas são opcionais e ligam-se em Definições.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
