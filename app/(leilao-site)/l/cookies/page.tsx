import Link from "next/link";
import { pubSettings, siteBase } from "@/lib/leilao/site";
import { DraftNote } from "../legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cookies" };

export default async function Cookies() {
  const [base, s] = await Promise.all([siteBase(), pubSettings()]);
  return (
    <div className="lx-narrow lx-prose">
      <span className="lx-eyebrow">Leilão Loja do Ouro</span>
      <h1>Cookies</h1>
      <DraftNote version={s?.terms_version} />
      <p>
        Este site usa apenas um cookie, estritamente necessário para manter a sua sessão depois de entrar na conta. Não usamos cookies de publicidade, de
        estatística nem de terceiros, por isso não pedimos consentimento (Lei n.º 41/2004, art. 5.º).
      </p>
      <table>
        <thead><tr><th>Cookie</th><th>Finalidade</th><th>Duração</th></tr></thead>
        <tbody>
          <tr><td>ldo_leilao</td><td>Manter a sessão da conta (identificador aleatório; só a impressão digital fica guardada no servidor).</td><td>{s?.session_days ?? 30} dias ou até sair</td></tr>
        </tbody>
      </table>
      <p>
        As fotografias das peças são servidas pelo CDN da Shopify e os tipos de letra pelo Google Fonts; estes serviços recebem o endereço IP do browser para
        entregar os ficheiros, sem cookies deste site. Mais informação na <Link href={`${base}/privacidade`}>política de privacidade</Link>.
      </p>
    </div>
  );
}
