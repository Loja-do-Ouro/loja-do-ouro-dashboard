import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { logoutAction } from "./l/actions";
import { aucMe, auctionSession, pubSettings, siteBase } from "@/lib/leilao/site";
import "./leilao.css";

// Site público do leilão: layout próprio (sem os estilos nem a sessão do dashboard). Fora dos motores de busca até
// ao lançamento (textos legais por validar com o advogado).
export const metadata: Metadata = {
  title: { default: "Leilão · Loja do Ouro", template: "%s · Leilão Loja do Ouro" },
  description: "Leilões online de joias e relógios da coleção Loja do Ouro. Sem comissão do comprador, com garantia e 14 dias para desistir.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#14272c" };

export default async function AuctionLayout({ children }: { children: React.ReactNode }) {
  const [base, session, settings] = await Promise.all([siteBase(), auctionSession(), pubSettings()]);
  const me = session ? await aucMe(session).catch(() => null) : null;
  const home = base || "/";
  return (
    <html lang="pt-PT">
      <body className="lx">
        <a className="lx-skip" href="#conteudo">Saltar para o conteúdo</a>
        <header className="lx-header">
          <div className="lx-wrap lx-header-row">
            <Link href={home} className="lx-brand" aria-label="Leilão Loja do Ouro, início">
              <span className="lx-brand-name">Loja do Ouro</span>
              <span className="lx-brand-sub">Leilões</span>
            </Link>
            <nav className="lx-nav" aria-label="Principal">
              <Link href={home}>Leilões</Link>
              <Link href={`${base}/como-funciona`}>Como funciona</Link>
              {me ? (
                <>
                  <Link href={`${base}/conta`} className="lx-nav-account">{me.first_name}</Link>
                  <form action={logoutAction}>
                    <button type="submit" className="lx-linkbtn">Sair</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href={`${base}/conta/entrar`}>Entrar</Link>
                  <Link href={`${base}/conta/registo`} className="lx-btn lx-btn-small">Registar</Link>
                </>
              )}
            </nav>
          </div>
        </header>

        <main id="conteudo" className="lx-main">{children}</main>

        <footer className="lx-footer">
          <div className="lx-wrap lx-footer-grid">
            <div>
              <div className="lx-brand lx-brand-footer">
                <span className="lx-brand-name">Loja do Ouro</span>
                <span className="lx-brand-sub">Leilões</span>
              </div>
              <p className="lx-footer-text">
                Só peças da nossa coleção, verificadas pelos nossos joalheiros. Sem comissão do comprador: o preço final é o que paga.
              </p>
            </div>
            <div>
              <h2 className="lx-footer-title">Leilão</h2>
              <ul className="lx-footer-links">
                <li><Link href={`${base}/como-funciona`}>Como funciona</Link></li>
                <li><Link href={`${base}/pagamentos`}>Pagamentos e caução</Link></li>
                <li><Link href={`${base}/regulamento`}>Regulamento</Link></li>
                <li><Link href={`${base}/termos`}>Termos e condições</Link></li>
                <li><Link href={`${base}/livre-resolucao`}>Livre resolução (desistir da compra)</Link></li>
              </ul>
            </div>
            <div>
              <h2 className="lx-footer-title">Privacidade e apoio</h2>
              <ul className="lx-footer-links">
                <li><Link href={`${base}/privacidade`}>Política de privacidade</Link></li>
                <li><Link href={`${base}/cookies`}>Cookies</Link></li>
                <li><a href="https://www.livroreclamacoes.pt" target="_blank" rel="noopener noreferrer">Livro de Reclamações Eletrónico</a></li>
                {settings?.contact_email && <li><a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a></li>}
              </ul>
            </div>
          </div>
          <div className="lx-wrap lx-footer-legal">
            <p>
              {[settings?.company_name, settings?.company_nif && `NIF ${settings.company_nif}`, settings?.company_address, settings?.company_registry,
                settings?.rjoc_title && `Título RJOC ${settings.rjoc_title}`].filter(Boolean).join(" · ") || "Loja do Ouro"}
            </p>
            <p>
              Resolução alternativa de litígios: {settings?.ral_entity || "entidade de RAL a indicar"} · mais informação em{" "}
              <a href="https://www.consumidor.gov.pt" target="_blank" rel="noopener noreferrer">consumidor.gov.pt</a>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
