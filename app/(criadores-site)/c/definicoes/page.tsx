import Link from "next/link";
import { CONSENT_TEXT, lisbonDate } from "@/lib/criadores-rules";
import { requireCreator, siteBase } from "@/lib/criadores/site";
import { CampaignNewsForm, DeleteForm, PasswordForm, PrivacyRequestForm } from "../forms";
import { Aviso, PageHead } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Definições" };

// Definições (§4.3 /definicoes, §7.2): palavra-passe; comunicações (avisos de campanhas novas, rev. R-B6); os seus
// dados (descarregar com a palavra-passe → POST /api/c/export; pedidos de oposição, limitação, revisão humana e
// retificação); apagar a conta (palavra-passe + «APAGAR», com a lista do que fica e porquê, rev. R-M7). Também
// abre com Termos por aceitar (allowReaccept): quem não concorda pode exportar e apagar sem aceitar.

// Códigos com que POST /api/c/export volta a esta página (?dados=…#dados).
const EXPORT_ERROR: Record<string, string> = {
  senha: "Palavra-passe errada. O ficheiro não foi gerado.",
  bloqueado: "Demasiadas palavras-passe erradas. Aguarde 15 minutos e tente de novo.",
  limite: "Já descarregou os dados várias vezes nesta hora. Tente mais tarde.",
  erro: "Não foi possível gerar o ficheiro. Tente dentro de momentos.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, { me }, q] = await Promise.all([siteBase(), requireCreator({ allowReaccept: true }), searchParams]);
  const news = me.consents.campaign_news;
  const exportError = typeof q.dados === "string" ? EXPORT_ERROR[q.dados] : undefined;
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu={me.email} title="Definições" />

          <section className="cr-bloco" aria-labelledby="t-pp">
            <div className="cr-bloco-cab"><h2 id="t-pp" className="cr-d-m">Palavra-passe</h2></div>
            <PasswordForm />
          </section>

          <section className="cr-bloco" aria-labelledby="t-avisos">
            <div className="cr-bloco-cab">
              <h2 id="t-avisos" className="cr-d-m">Comunicações</h2>
              <span className="cr-meta">{news ? `${news.granted ? "Ligados" : "Desligados"} desde ${lisbonDate(news.at)}` : "Desligados"}</span>
            </div>
            <p className="cr-pequeno">Os emails sobre a sua conta, o perfil e as colaborações (decisões, mensagens, pagamentos) chegam sempre. Os avisos de campanhas novas são opcionais.</p>
            <CampaignNewsForm granted={Boolean(news?.granted)} text={CONSENT_TEXT.campaign_news} />
          </section>

          <section id="dados" className="cr-bloco" aria-labelledby="t-dados">
            <div className="cr-bloco-cab"><h2 id="t-dados" className="cr-d-m">Os seus dados</h2></div>
            <h3 className="cr-d-xs" style={{ marginBottom: 8 }}>Descarregar os meus dados</h3>
            <p className="cr-pequeno">
              Um ficheiro JSON com tudo o que guardamos sobre si: conta, perfil, redes e números, números públicos lidos do Instagram (se autorizou a
              leitura), consentimentos, mensagens, notas internas da equipa, pedidos e registo de ações. Os dados fiscais e o IBAN vão por inteiro, porque
              são seus.
            </p>
            {exportError && <Aviso tone="erro"><p>{exportError}</p></Aviso>}
            {/* Formulário normal (sem JavaScript): a resposta é o ficheiro. A rota confirma a origem e a sessão. */}
            <form method="post" action="/api/c/export" className="cr-form">
              <div className="cr-fim" style={{ borderTop: 0, marginTop: 0, paddingTop: 8 }}>
                <div className="cr-campo">
                  <label htmlFor="exportar-pp">A sua palavra-passe</label>
                  <input id="exportar-pp" className="cr-inp" type="password" name="password" autoComplete="current-password" required />
                </div>
                <button type="submit" className="cr-bt cr-bt-sec">Descarregar os meus dados</button>
              </div>
            </form>

            <h3 className="cr-d-xs" style={{ margin: "40px 0 8px" }}>Pedidos sobre os seus dados</h3>
            <p className="cr-pequeno">
              Para corrigir dados que não consegue editar, opor-se a um tratamento, limitar o tratamento ou pedir que uma pessoa reveja uma decisão.
              Respondemos no prazo de um mês. O perfil, as redes e os pagamentos editam-se nas próprias páginas.
            </p>
            <PrivacyRequestForm />
          </section>

          <section id="apagar" className="cr-bloco" aria-labelledby="t-apagar">
            <div className="cr-bloco-cab"><h2 id="t-apagar" className="cr-d-m">Apagar a conta</h2></div>
            <p>
              Ao apagar, deixa de poder entrar e apagamos o perfil, os contactos, as redes, os números (declarados e lidos do Instagram) e as mensagens. Fica só
              o que a lei ou a prova nos obrigam a guardar:
            </p>
            <table className="cr-tab cr-tab-pilha" style={{ marginBottom: 24 }}>
              <thead><tr><th scope="col">O que fica</th><th scope="col">Porquê</th><th scope="col">Até quando</th></tr></thead>
              <tbody>
                <tr><td className="cr-tit">Pagamentos registados</td><td data-r="Porquê">Obrigação fiscal</td><td data-r="Até quando">10 anos</td></tr>
                <tr><td className="cr-tit">Licenças de conteúdos em vigor</td><td data-r="Porquê">Contrato assinado nas Condições Particulares</td><td data-r="Até quando">Até ao fim de cada licença</td></tr>
                <tr><td className="cr-tit">Registo dos consentimentos</td><td data-r="Porquê">Prova do que aceitou e quando</td><td data-r="Até quando">5 anos</td></tr>
              </tbody>
            </table>
            <p className="cr-pequeno">
              Se tiver uma colaboração a decorrer, a conta fica até ela terminar: apagamos logo o que depende da sua autorização e dizemos-lhe o que fica e até quando.
              Pode reclamar à Comissão Nacional de Proteção de Dados (<a href="https://www.cnpd.pt" target="_blank" rel="noopener noreferrer">www.cnpd.pt</a>).
            </p>
            <DeleteForm />
          </section>

          <p className="cr-pequeno" style={{ marginTop: 40 }}>
            Mais informação na <Link href={`${base}/privacidade`}>Política de Privacidade</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
