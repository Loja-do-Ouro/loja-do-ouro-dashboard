import Link from "next/link";
import { instagramHandle } from "@/lib/criadores-meta-rules";
import { PLATFORM_LABEL, consentText, lisbonDate } from "@/lib/criadores-rules";
import { crProfileGet, crPublicGetIfReady, type CrPublicGet } from "@/lib/criadores/db";
import { metaPublicConfigured } from "@/lib/criadores/meta";
import { requireCreator, siteBase } from "@/lib/criadores/site";
import { NewSocialForm, SocialAccountForm } from "../forms";
import { Aviso, PageHead, VerificationTag, formatInt, formatPct } from "../ui";
import { PublicLoadError, PublicSection } from "./publico";

export const dynamic = "force-dynamic";
export const metadata = { title: "Redes" };

// Redes (§4.3 /redes): os dados públicos do Instagram (fase 3A: autorizar, confirmar a conta com o código na biografia,
// ver os números lidos e parar), a ligação pela Meta (em breve, 3B) e as contas declaradas (editar e apagar as não
// verificadas), com os números declarados e a interação média. A captura para validar os números junta-se no PR2
// (ficheiros), só depois de enviar o perfil para revisão [rev. S-M6]. Antes da migração 3A, a função da camada pública
// não existe e o bloco mostra «Em breve»; outra falha mostra o erro.
// Abre também com Termos por aceitar (allowReaccept), só com o bloco dos dados públicos: retirar o consentimento não
// pode depender de aceitar os Termos novos (art. 7.º, n.º 3; a Política e os Termos mandam parar «em Redes»).
export default async function NetworksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ session, me }, base, q] = await Promise.all([requireCreator({ allowReaccept: true }), siteBase(), searchParams]);
  const reaccept = me.reaccept.length > 0;
  const [p, loaded] = await Promise.all([
    crProfileGet(session),
    crPublicGetIfReady(session).then((pub): { pub: CrPublicGet | null; failed: boolean } => ({ pub, failed: false }), () => ({ pub: null, failed: true })),
  ]);
  const pub = loaded.pub;
  const accounts = p.social_accounts;
  const ig = accounts.find((a) => a.platform === "instagram") ?? null;
  const available = pub?.mode === "on" && metaPublicConfigured();
  // O texto exato da caixa, com o @ guardado (rev. R-B1); a action volta a calculá-lo a partir da BD.
  const consent = ig && instagramHandle(ig.handle) ? consentText("platform_public", { handle: ig.handle }) : null;
  const publicLayer = Boolean(ig && pub?.account?.account_id === ig.id && pub.account.state);
  const section = loaded.failed ? <PublicLoadError /> : (
    <PublicSection pub={pub} ig={ig} status={me.status} base={base} available={available} consent={consent} reaccept={reaccept}
      done={typeof q.m === "string" ? q.m : undefined} />
  );

  if (reaccept) {
    return (
      <div className="cr-env">
        <div className="cr-grelha">
          <div className="cr-c1-8">
            <PageHead chapeu="A sua conta" title="Redes" />
            <Aviso title="Atualizámos os Termos de participação">
              <p>
                Até aceitar a versão nova, aqui só pode ver e parar a leitura dos dados públicos do Instagram, sem aceitar.{" "}
                <Link href={`${base}/conta/novos-termos`}>Ler e aceitar os Termos</Link>
              </p>
            </Aviso>
            {section}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu="A sua conta" title="Redes"
            lead="As contas onde publica e os números que quiser partilhar. Ficam como declarados por si até a equipa os validar." />

          {section}

          <section className="cr-rede" aria-labelledby="t-meta">
            <div className="cr-rede-cab">
              <h2 id="t-meta" className="cr-d-s">Ligar o Instagram pela Meta</h2>
              <span className="cr-etq cr-anl">Em breve</span>
            </div>
            <p>
              Numa fase seguinte vai poder ligar a conta do Instagram pela Meta, para a equipa ver também as estatísticas da conta. É opcional, tem uma
              autorização própria e pode desligar quando quiser: os dados obtidos são apagados nesse momento.
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
                <div><SocialAccountForm a={a} publicLayer={a.platform === "instagram" && publicLayer} /></div>
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
