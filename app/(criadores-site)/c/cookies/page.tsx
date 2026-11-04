import Link from "next/link";
import { siteBase } from "@/lib/criadores/site";
import { LegalBody, LegalHead, loadLegal } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cookies" };

// Só cookies essenciais (§7.1, rev. S-B1): sem analítica nem publicidade, logo sem banner (Lei 41/2004, art. 5.º).
// O texto de recurso lista-os enquanto a política não está publicada.
export default async function CookiesPage() {
  const [base, page] = await Promise.all([siteBase(), loadLegal("cookies")]);
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <LegalHead title="Cookies" doc={page.document} />
          <LegalBody page={page} base={base} fallback={
            <div className="cr-prosa">
              <p>
                Este site usa só cookies estritamente necessários. Não usamos cookies de estatística, de publicidade nem de terceiros, por isso não pedimos
                consentimento (Lei n.º 41/2004, art. 5.º).
              </p>
              <table>
                <thead><tr><th>Cookie</th><th>Para quê</th><th>Duração</th></tr></thead>
                <tbody>
                  <tr><td>__Host-ldo_criador</td><td>Manter a sessão depois de entrar na conta (identificador aleatório; no servidor fica só a impressão digital).</td><td>Até sair ou até a sessão terminar (14 dias por omissão)</td></tr>
                  <tr><td>__Host-ldo_cr_oauth</td><td>Ligar o Instagram pela Meta, quando essa opção existir: protege o regresso da Meta ao site.</td><td>10 minutos</td></tr>
                </tbody>
              </table>
              <p>
                As imagens e os tipos de letra são servidos pelo próprio site: o seu browser não contacta outros serviços ao abrir estas páginas. Mais informação na{" "}
                <Link href={`${base}/privacidade`}>Política de Privacidade</Link>.
              </p>
            </div>
          } />
        </div>
      </div>
    </div>
  );
}
