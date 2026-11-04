import { PLATFORM_LABEL, lisbonDate } from "@/lib/criadores-rules";
import { crProfileGet } from "@/lib/criadores/db";
import { requireCreator } from "@/lib/criadores/site";
import { NewSocialForm, SocialAccountForm } from "../forms";
import { PageHead, VerificationTag, formatInt, formatPct } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Redes" };

// Redes (§4.3 /redes, PR1): as contas declaradas (editar e apagar as não verificadas), com os números declarados e a
// interação média. O Instagram em dois blocos chega nas fases 3A (dados públicos) e 3B (ligação pela Meta): aqui
// aparecem como «em breve». A captura para validar os números junta-se no PR2 (ficheiros), só depois de enviar o
// perfil para revisão [rev. S-M6].
export default async function NetworksPage() {
  const { session } = await requireCreator();
  const p = await crProfileGet(session);
  const accounts = p.social_accounts;
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu="A sua conta" title="Redes"
            lead="As contas onde publica e os números que quiser partilhar. Ficam como declarados por si até a equipa os validar." />

          <section className="cr-rede" aria-labelledby="t-ig">
            <div className="cr-rede-cab">
              <h2 id="t-ig" className="cr-d-m">Instagram pela Meta</h2>
              <span className="cr-etq cr-anl">Em breve</span>
            </div>
            <p>
              Numa fase seguinte vai poder autorizar a leitura dos números públicos da sua conta profissional do Instagram e, se quiser, ligar a conta pela
              Meta. As duas são opcionais, cada uma com uma autorização própria, e podem ser paradas a qualquer momento: os dados lidos são apagados nesse momento.
            </p>
            <button type="button" className="cr-bt" disabled aria-disabled="true">Ligar o Instagram (em breve)</button>
          </section>

          <section className="cr-rede" aria-labelledby="t-contas">
            <div className="cr-rede-cab">
              <h2 id="t-contas" className="cr-d-m">Contas declaradas</h2>
              <span className="cr-etq cr-etq-dec">Declarado por si · não verificado</span>
            </div>
            {accounts.length ? (
              <table className="cr-tab cr-tab-pilha" style={{ marginBottom: 24 }}>
                <thead>
                  <tr><th scope="col">Rede</th><th scope="col" className="cr-n">Seguidores</th><th scope="col" className="cr-n">Interação média</th><th scope="col">Declarado a</th><th scope="col">Estado</th></tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td className="cr-tit">{PLATFORM_LABEL[a.platform]} <span className="cr-meta">@{a.handle}</span></td>
                      <td data-r="Seguidores" className="cr-n">{formatInt(a.metrics?.followers)}</td>
                      <td data-r="Interação média" className="cr-n">{formatPct(a.metrics?.engagement_pct)}</td>
                      <td data-r="Declarado a" className="cr-num">{a.metrics ? lisbonDate(a.metrics.declared_on) : "—"}</td>
                      <td data-r="Estado">{a.metrics?.validated ? <span className="cr-etq cr-ok">Validado pela equipa</span> : <VerificationTag v={a.verification} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="cr-vazio">Ainda não indicou nenhuma rede.</p>
            )}
            {accounts.map((a) => (
              <details key={a.id} className="cr-conta-rede">
                <summary>
                  <span className="cr-d-xs">{PLATFORM_LABEL[a.platform]} · @{a.handle}</span>
                  <span className="cr-abrir">Editar</span>
                </summary>
                <div><SocialAccountForm a={a} /></div>
              </details>
            ))}
            <p className="cr-notas">Mudar os números volta a pô-los como «não verificado» até a equipa os validar outra vez.</p>
          </section>

          <section className="cr-rede" aria-labelledby="t-nova">
            <div className="cr-rede-cab"><h2 id="t-nova" className="cr-d-s">Juntar outra rede</h2></div>
            <NewSocialForm taken={accounts.map((a) => a.platform)} />
          </section>
        </div>
      </div>
    </div>
  );
}
