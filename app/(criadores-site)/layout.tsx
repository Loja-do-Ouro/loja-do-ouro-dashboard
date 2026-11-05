import type { Metadata, Viewport } from "next";
import { Archivo, Fraunces } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { crLegalPublic, type CrCompany } from "@/lib/criadores/db";
import { creatorsReady, loadCreator, siteBase, type CreatorContext } from "@/lib/criadores/site";
import { logoutAction, privacyNoticeAction } from "./c/actions";
import { BottomBar, NavLinks, type NavItem } from "./c/nav";
import "./criadores.css";

// Site dos criadores (criadores.lojadoouro.pt; /c no endereço do dashboard só para testes internos). Root layout e
// CSS próprios, sem nada de app/(painel)/globals.css, como o leilão. Direção visual A, «Caderno de ouro» (§10).
// - Letras com next/font/google: descarregadas no build e servidas pelo próprio domínio (nenhum pedido à Google no
//   browser). Fraunces (títulos, com o eixo opsz e itálico) e Archivo (texto e todos os dados, eixo wdth). A Fraunces
//   substituiu a Bodoni Moda (05-11-2026): nos títulos grandes os traços finos da Bodoni desapareciam em ecrãs comuns.
//   O eixo WONK vem na letra só para ficar a 0 em criadores.css (sem ele a Fraunces troca h, l, m e n por formas
//   «tortas» nos corpos grandes). O SOFT fica de fora e vale 0 (cantos vivos).
// - CSP com nonce (proxy.ts): o Next lê o nonce do cabeçalho do pedido e põe-no nos seus scripts. Este site não tem
//   <Script> nem scripts inline; as páginas são dinâmicas (siteBase() e a sessão leem headers()/cookies()).
// - Fora dos motores de busca até o advogado aprovar os textos.

const serif = Fraunces({ subsets: ["latin", "latin-ext"], axes: ["opsz", "WONK"], style: ["normal", "italic"], display: "swap", variable: "--cr-serif" });
const grot = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], display: "swap", variable: "--cr-grot" });

export const metadata: Metadata = {
  title: { default: "Criadores · Loja do Ouro", template: "%s · Criadores Loja do Ouro" },
  description: "Programa de criadores da Loja do Ouro: campanhas pagas, permutas e peças para unboxing, com as condições por escrito e decisões de uma pessoa da equipa.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#FBF8F2" };

// Logótipo horizontal da Loja do Ouro, o do cabeçalho de lojadoouro.pt, recortado em CSS (§10.5 n.º 12). Servido
// pelo otimizador do próprio site (next/image, remotePatterns em next.config.mjs): o browser não fala com a Shopify.
// Quando a marca entregar o SVG, passa a ficheiro do próprio site.
const LOGO = "https://www.lojadoouro.pt/cdn/shop/files/logo_horizontal_f74be36a-8ff7-48e9-8e46-9c150f0d3c69.png?v=1763540816&width=840";

const PUBLIC_NAV: NavItem[] = [
  { path: "/", label: "Início" },
  { path: "/como-funciona", label: "Como funciona" },
];
const CREATOR_NAV = (unread: number): NavItem[] => [
  { path: "/painel", label: "Início", match: ["/bem-vindo"] },
  { path: "/perfil", label: "Perfil" },
  { path: "/redes", label: "Redes" },
  { path: "/mensagens", label: "Mensagens", count: unread },
  { path: "/pagamentos", label: "Pagamentos" },
  { path: "/definicoes", label: "Definições" },
];
// Barra inferior do telemóvel: 5 destinos; «Conta» junta pagamentos, definições e os documentos (§10.5 n.º 9).
const BAR_NAV = (unread: number): NavItem[] => [
  { path: "/painel", label: "Início", match: ["/bem-vindo"] },
  { path: "/perfil", label: "Perfil" },
  { path: "/redes", label: "Redes" },
  { path: "/mensagens", label: unread ? `Mensagens (${unread})` : "Mensagens" },
  { path: "/conta", label: "Conta", match: ["/pagamentos", "/definicoes"] },
];

// Identificação legal (rodapé) e se as inscrições estão abertas (o «Criar conta» do cabeçalho só aparece com elas).
async function publicInfo(): Promise<{ company: CrCompany | null; open: boolean }> {
  try {
    const r = await crLegalPublic(null);
    return { company: r.company, open: creatorsReady() && r.registrations_open };
  } catch {
    return { company: null, open: false };
  }
}

export default async function CreatorsLayout({ children }: { children: React.ReactNode }) {
  const [base, ctx, info] = await Promise.all([
    siteBase(),
    // Uma falha da BD não deita abaixo as páginas públicas: sem sessão lida, mostra o cabeçalho público.
    loadCreator().catch((): CreatorContext | null => null),
    publicInfo(),
  ]);
  const co = info.company;
  const me = ctx?.me ?? null;
  const home = me ? `${base}/painel` : base || "/";
  const who = me ? me.display_name || me.first_name || me.email : "";
  const notice = me?.privacy_notice_pending ?? null;

  return (
    <html lang="pt-PT" className={`cr-html ${serif.variable} ${grot.variable}`}>
      <body className={`cr-body${me ? " cr-com-barra" : ""}`}>
        <a className="cr-saltar" href="#conteudo">Saltar para o conteúdo</a>
        <header className={`cr-cab${me ? " cr-cab-criador" : ""}`}>
          <div className="cr-env cr-cab-linha">
            <Link className="cr-logo" href={home} aria-label="Loja do Ouro Criadores, início">
              <span className="cr-logo-recorte">
                <Image src={LOGO} alt="Loja do Ouro" width={709} height={177} sizes="260px" preload />
              </span>
              <span className="cr-logo-sub">Criadores</span>
            </Link>
            <nav className="cr-nav" aria-label="Principal">
              {me ? (
                <>
                  <NavLinks base={base} items={CREATOR_NAV(me.unread_messages)} />
                  <span className="cr-nav-conta">
                    <span className="cr-meta">{who}</span>
                    <form action={logoutAction}><button type="submit" className="cr-lig">Sair</button></form>
                  </span>
                </>
              ) : (
                <>
                  <NavLinks base={base} items={PUBLIC_NAV} />
                  <span className="cr-nav-conta">
                    <Link href={`${base}/conta/entrar`} className="cr-lig">Entrar</Link>
                    {info.open && <Link href={`${base}/conta/registo`} className="cr-bt cr-bt-pq">Criar conta</Link>}
                  </span>
                </>
              )}
            </nav>
            <details className="cr-menu">
              <summary>Menu</summary>
              <div className="cr-menu-lista">
                {me ? (
                  <>
                    <NavLinks base={base} items={CREATOR_NAV(me.unread_messages)} />
                    <form action={logoutAction}><button type="submit">Sair ({who})</button></form>
                  </>
                ) : (
                  <>
                    <NavLinks base={base} items={[...PUBLIC_NAV, { path: "/conta/entrar", label: "Entrar" }, ...(info.open ? [{ path: "/conta/registo", label: "Criar conta" }] : [])]} />
                  </>
                )}
              </div>
            </details>
          </div>
        </header>

        {notice && (
          <div className="cr-faixa-aviso" role="region" aria-label="Política de Privacidade atualizada">
            <div className="cr-env">
              <span>
                Atualizámos a Política de Privacidade (versão <span className="cr-num">{notice.version}</span>):{" "}
                <Link href={`${base}/privacidade`}>veja o que mudou</Link>. Não precisa de aceitar nada.
              </span>
              <form action={privacyNoticeAction}>
                <input type="hidden" name="doc" value={notice.id} />
                <button type="submit" className="cr-bt cr-bt-sec cr-bt-pq">Tomei conhecimento</button>
              </form>
            </div>
          </div>
        )}

        <main id="conteudo" className="cr-main">{children}</main>

        <footer className="cr-rodape">
          <div className="cr-env cr-grelha">
            <div className="cr-c1-4">
              <p className="cr-meta">Programa de criadores da Loja do Ouro, joalharia com lojas em Portugal.</p>
              <p className="cr-meta"><a href={`mailto:${co?.contact_email || "criadores@lojadoouro.pt"}`}>{co?.contact_email || "criadores@lojadoouro.pt"}</a></p>
            </div>
            <div className="cr-c5-4">
              <h2>Os seus dados</h2>
              <ul>
                <li><Link href={`${base}/privacidade`}>Política de Privacidade</Link></li>
                <li><Link href={`${base}/termos`}>Termos de participação</Link></li>
                <li><Link href={`${base}/cookies`}>Cookies</Link></li>
                <li><Link href={`${base}/dados-meta`}>Dados obtidos da Meta</Link></li>
              </ul>
            </div>
            <div className="cr-c9-4">
              <h2>Loja do Ouro</h2>
              <ul>
                <li><Link href={`${base}/como-funciona`}>Como funciona o programa</Link></li>
                <li><a href="https://www.lojadoouro.pt">lojadoouro.pt</a></li>
                <li><a href="https://www.livroreclamacoes.pt" target="_blank" rel="noopener noreferrer">Livro de Reclamações</a></li>
              </ul>
            </div>
          </div>
          <div className="cr-env cr-rodape-legal cr-meta">
            <p>
              {[co?.company_name, co?.company_nif && `NIF ${co.company_nif}`, co?.company_address, co?.company_registry].filter(Boolean).join(" · ") || "Loja do Ouro"}
            </p>
            <p>A Loja do Ouro não dá notas nem ordena criadores: cada decisão é de uma pessoa da equipa, com o motivo registado.</p>
          </div>
        </footer>

        {me && <BottomBar base={base} items={BAR_NAV(me.unread_messages)} />}
      </body>
    </html>
  );
}
