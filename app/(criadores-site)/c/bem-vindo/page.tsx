import Link from "next/link";
import { redirect } from "next/navigation";
import { CONSENT_TEXT, ONBOARDING_STEPS } from "@/lib/criadores-rules";
import { crProfileGet } from "@/lib/criadores/db";
import { requireCreator, siteBase } from "@/lib/criadores/site";
import { AboutForm, ContactsForm, ContentForm, NetworksForm, SubmitProfileForm } from "../forms";
import { Aviso } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "O seu perfil" };

// Onboarding (F2, §4.3 /bem-vindo?passo=1..4): sobre si, contactos, conteúdo e lojas, redes. Cada passo grava com
// ldo_cr_profile_save e pode ficar a meio. No passo 4: declarar as redes («não verificado»), «Ligar o Instagram» em
// breve (meta_mode = 'off' no PR1) e a declaração de veracidade → «Enviar para revisão».

const STEP_TEXT: Record<string, { title: string; lead: string; hint: string }> = {
  about: { title: "Sobre si", lead: "O seu nome, onde vive e em que idiomas publica.", hint: "Nome, cidade, idiomas" },
  contacts: { title: "Contactos", lead: "Como a equipa o pode contactar quando houver uma colaboração.", hint: "Telemóvel e preferência" },
  content: { title: "Conteúdo e lojas", lead: "Os temas e os formatos que faz, e as lojas onde pode ir.", hint: "Temas, formatos, lojas" },
  networks: { title: "As suas redes", lead: "Indique as redes onde publica. Os números ficam como declarados por si até a equipa os validar.", hint: "Instagram, TikTok, YouTube" },
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, { session, me }, q] = await Promise.all([siteBase(), requireCreator(), searchParams]);
  if (!["draft", "rejected"].includes(me.status)) redirect(`${base}/perfil`);
  const p = await crProfileGet(session);
  const n = Math.min(4, Math.max(1, Number(typeof q.passo === "string" ? q.passo : "1") || 1));
  const step = ONBOARDING_STEPS[n - 1];
  const text = STEP_TEXT[step.key];
  const done = p.steps;
  const back = n > 1 ? `${base}/bem-vindo?passo=${n - 1}` : undefined;
  const missing = ONBOARDING_STEPS.filter((s) => !done[s.key]);

  return (
    <div className="cr-env">
      <nav className="cr-passos" aria-label="Passos do perfil">
        <ol>
          {ONBOARDING_STEPS.map((s) => (
            <li key={s.key} className={done[s.key] ? "cr-feito" : undefined} aria-current={s.n === n ? "step" : undefined}>
              <Link href={`${base}/bem-vindo?passo=${s.n}`}>
                <span className="cr-pn">{s.n}</span>
                <span className="cr-pt">{s.label}</span>
                {/* No telemóvel a dica esconde-se; «Feito» fica sempre visível (o estado não depende só do filete). */}
                <span className={done[s.key] ? "cr-ps cr-ps-feito" : "cr-ps"}>{done[s.key] ? "Feito" : STEP_TEXT[s.key].hint}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <div className="cr-grelha" style={{ marginTop: 48 }}>
        <div className="cr-c1-7">
          <p className="cr-chapeu">Passo {n} de 4</p>
          <h1 className="cr-d-l" style={{ marginBottom: 16 }}>{text.title}</h1>
          <p className="cr-lead" style={{ marginBottom: 32 }}>{text.lead}</p>
          {me.status === "rejected" && n === 1 && (
            <Aviso title="O perfil não foi aprovado">
              {me.status_reason && <p>Motivo indicado pela equipa: «{me.status_reason}»</p>}
              <p>Pode corrigir o perfil e enviá-lo de novo no passo 4.</p>
            </Aviso>
          )}
          {step.key === "about" && <AboutForm p={p} onboarding back={back} />}
          {step.key === "contacts" && <ContactsForm p={p} onboarding back={back} />}
          {step.key === "content" && <ContentForm p={p} onboarding back={back} />}
          {step.key === "networks" && (
            <>
              <section className="cr-rede" aria-labelledby="t-ig" style={{ marginTop: 0 }}>
                <div className="cr-rede-cab">
                  <h2 id="t-ig" className="cr-d-s">Ligar o Instagram</h2>
                  <span className="cr-etq cr-anl">Em breve</span>
                </div>
                <p>
                  Numa fase seguinte vai poder ligar o Instagram pela Meta, para os números serem lidos diretamente. É opcional e tem uma autorização própria.
                  Por agora, indique o seu @ em baixo.
                </p>
                <button type="button" className="cr-bt" disabled aria-disabled="true">Ligar o Instagram (em breve)</button>
              </section>

              <section className="cr-rede" aria-labelledby="t-redes">
                <div className="cr-rede-cab">
                  <h2 id="t-redes" className="cr-d-s">Redes onde publica</h2>
                  <span className="cr-etq cr-etq-dec">Declarado por si · não verificado</span>
                </div>
                <NetworksForm p={p} back={back} />
              </section>

              <section id="enviar" className="cr-rede" aria-labelledby="t-enviar">
                <h2 id="t-enviar" className="cr-d-m" style={{ marginBottom: 12 }}>Enviar para revisão</h2>
                {q.m === "guardado" && <Aviso tone="ok"><p>Redes guardadas.</p></Aviso>}
                {missing.length ? (
                  <>
                    <p>Antes de enviar, falta completar:</p>
                    <ul className="cr-lista">
                      {missing.map((s) => (
                        <li key={s.key}><span>{s.label}</span><Link className="cr-lig" href={`${base}/bem-vindo?passo=${s.n}`}>Completar o passo {s.n}</Link></li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <SubmitProfileForm text={CONSENT_TEXT.data_truth} />
                )}
              </section>
            </>
          )}
        </div>
        <aside className="cr-c9-4" aria-label="Notas">
          <div className="cr-nota-l">
            <h2><span className="cr-nn">1</span>Pode parar a meio</h2>
            <p>Cada passo fica guardado. Volte quando quiser: o painel mostra o que falta.</p>
          </div>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">2</span>Quem vê o seu perfil</h2>
            <p>Só a equipa de marketing da Loja do Ouro. O nome civil, o telemóvel e os contactos não são mostrados a mais ninguém.</p>
          </div>
          <div className="cr-nota-l">
            <h2><span className="cr-nn">3</span>Sem notas nem rankings</h2>
            <p>Uma pessoa da equipa lê o perfil e decide. Os números que indica não servem para dar notas nem ordenar criadores.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
