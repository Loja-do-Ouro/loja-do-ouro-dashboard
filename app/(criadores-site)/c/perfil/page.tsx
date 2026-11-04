import Link from "next/link";
import { crProfileGet } from "@/lib/criadores/db";
import { requireCreator, siteBase } from "@/lib/criadores/site";
import { AboutForm, ContactsForm, ContentForm } from "../forms";
import { Aviso, PageHead, StatusTag } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perfil" };

// Editar os passos 1–3 do perfil (§4.3 /perfil; avatar no PR2). Depois de aprovado, mudar o nome, as redes ou as
// lojas marca o perfil como «alterado desde a revisão» para a equipa, sem perder a aprovação.
export default async function ProfilePage() {
  const [base, { session, me }] = await Promise.all([siteBase(), requireCreator()]);
  const p = await crProfileGet(session);
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu="A sua conta" title="Perfil" lead="O que a equipa vê sobre si. Pode mudar quando quiser.">
            <p style={{ marginTop: 16 }}><StatusTag status={me.status} /></p>
          </PageHead>
          {(me.status === "draft" || me.status === "rejected") && (
            <Aviso title={me.onboarding.complete ? "Perfil completo, por enviar" : "Perfil por completar"}>
              <p>{me.onboarding.complete ? "Falta enviar o perfil para revisão." : "Complete os quatro passos e envie o perfil para revisão."} <Link href={`${base}/bem-vindo?passo=4#enviar`}>Ir para o envio</Link>.</p>
            </Aviso>
          )}
          {me.status === "approved" && (
            <p className="cr-pequeno">Se mudar o nome, as redes ou as lojas, a equipa vê que o perfil mudou desde a aprovação. A aprovação mantém-se.</p>
          )}

          <section className="cr-bloco" aria-labelledby="t-sobre">
            <div className="cr-bloco-cab"><h2 id="t-sobre" className="cr-d-m">Sobre si</h2></div>
            <AboutForm p={p} />
          </section>
          <section className="cr-bloco" aria-labelledby="t-contactos">
            <div className="cr-bloco-cab"><h2 id="t-contactos" className="cr-d-m">Contactos</h2><span className="cr-meta">Email da conta: {me.email}</span></div>
            <ContactsForm p={p} />
          </section>
          <section className="cr-bloco" aria-labelledby="t-conteudo">
            <div className="cr-bloco-cab"><h2 id="t-conteudo" className="cr-d-m">Conteúdo e lojas</h2></div>
            <ContentForm p={p} />
          </section>
          <p className="cr-pequeno" style={{ marginTop: 32 }}>
            As redes editam-se em <Link href={`${base}/redes`}>Redes</Link>. Para mudar o email da conta, escreva-nos em <Link href={`${base}/mensagens`}>Mensagens</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
