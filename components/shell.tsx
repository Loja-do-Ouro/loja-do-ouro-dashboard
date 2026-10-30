import Link from "next/link";
import { cookies } from "next/headers";
import { Icon } from "@/components/dashboard/ui";
import { MenuToggle } from "@/components/menu-toggle";
import { NavScroll } from "@/components/nav-scroll";
import { MENU_COOKIE, menuCollapsed } from "@/lib/menu";
import { canCompareStores, canManageAuction, canManagePrivateSelection, canManageStores, canManageUsers, canSeeOnline, canSupport, initials } from "@/lib/permissions";
import type { Viewer } from "@/lib/viewer";

export const ONLINE_SECTIONS = [
  ["overview", "Visão geral", "grid"],
  ["sales", "Vendas e operação", "bag"],
  ["marketing", "Marketing e canais", "ads"],
  ["social", "Redes sociais", "heart"],
  ["audience", "Públicos e regiões", "globe"],
  ["quality", "Relatórios e qualidade", "check"],
] as const;

type Item = { key: string; label: string; href: string; icon: string; badge?: number };

// Sidebar and top bar shared by every page; each person only sees what they can open.
export async function AppShell({
  viewer,
  current,
  title,
  onlineHref = (section) => `/?section=${section}`,
  badges = {},
  children,
}: {
  viewer: Viewer;
  current: string;
  title: string;
  onlineHref?: (section: string) => string;
  badges?: Record<string, number>;
  children: React.ReactNode;
}) {
  const groups: { label: string; items: Item[] }[] = [];
  // With a temporary password, only the account page is reachable.
  const locked = viewer.mustChangePassword;
  if (!locked && canSeeOnline(viewer))
    groups.push({
      label: "LOJA ONLINE",
      items: [
        ...ONLINE_SECTIONS.map(([key, label, icon]) => ({ key, label, icon, href: onlineHref(key), badge: badges[key] })),
        // Página própria (não é uma secção de "/?section="): membros e senha da página reservada da loja.
        ...(canManagePrivateSelection(viewer) ? [{ key: "private-selection", label: "Private Selection", href: "/private-selection", icon: "key" }] : []),
      ],
    });
  if (!locked && canManageAuction(viewer))
    groups.push({
      label: "LEILÃO",
      items: [
        { key: "leilao", label: "Leilões e lotes", href: "/leilao", icon: "gavel" },
        { key: "leilao-clientes", label: "Clientes do leilão", href: "/leilao/clientes", icon: "people" },
        { key: "leilao-definicoes", label: "Regras do leilão", href: "/leilao/definicoes", icon: "list" },
      ],
    });
  if (!locked && canSupport(viewer))
    groups.push({
      label: "APOIO AO CLIENTE",
      items: [
        { key: "apoio", label: "Conversas", href: "/apoio", icon: "chat" },
        // Cada pessoa vê os seus resultados; o Super Admin, os de toda a equipa.
        { key: "apoio-desempenho", label: "Satisfação e desempenho", href: "/apoio/desempenho", icon: "star" },
        // Como funciona o apoio e o enquadramento legal, com pesquisa (docs/apoio); para toda a gente do apoio.
        { key: "apoio-docs", label: "Documentação", href: "/apoio/documentacao", icon: "list" },
        ...(viewer.isSuper ? [{ key: "apoio-config", label: "Configuração do apoio", href: "/apoio/configuracao", icon: "plug" }] : []),
      ],
    });
  if (!locked && viewer.stores.length)
    groups.push({
      label: "LOJAS FÍSICAS",
      items: [
        { key: "lojas", label: "Vendas e atendimentos", href: "/lojas", icon: "store" },
        { key: "ouro", label: "Compra de ouro", href: "/lojas/ouro", icon: "sales" },
        ...(canCompareStores(viewer)
          ? [
              { key: "ranking", label: "Ranking das lojas", href: "/lojas/ranking", icon: "trophy" },
              { key: "comparar", label: "Comparar lojas", href: "/lojas/comparar", icon: "compare" },
            ]
          : []),
      ],
    });
  if (!locked && canManageUsers(viewer))
    groups.push({
      label: "ADMINISTRAÇÃO",
      items: [
        { key: "utilizadores", label: "Utilizadores", href: "/admin/utilizadores", icon: "people" },
        ...(canManageStores(viewer)
          ? [
              { key: "admin-lojas", label: "Lojas", href: "/admin/lojas", icon: "pin" },
              { key: "opcoes", label: "Listas de opções", href: "/admin/opcoes", icon: "list" },
              ...(viewer.isSuper
                ? [
                    { key: "campanhas", label: "Campanhas", href: "/admin/campanhas", icon: "target" },
                    { key: "relatorios", label: "Relatórios por email", href: "/admin/relatorios", icon: "mail" },
                    { key: "folha-lojas", label: "Folha das lojas", href: "/admin/folha-lojas", icon: "sheet" },
                  ]
                : []),
            ]
          : []),
      ],
    });
  const name = viewer.fullName || viewer.username;
  // Estado inicial do botão do menu, o mesmo que o layout pôs no <html> (depois manda o <html>).
  const collapsed = menuCollapsed((await cookies()).get(MENU_COOKIE)?.value);
  return (
    <div className="app-shell">
      <aside className="sidebar" id="menu-lateral">
        <Link href="/" className="brand" aria-label="Loja do Ouro · início">
          <img
            className="official-logo"
            src="/logo-loja-do-ouro.png"
            alt="Loja do Ouro"
            width="160"
            height="92"
          />
          {/* Na coluna de ícones do tablet, o logótipo inteiro não cabe: fica só o emblema. */}
          <img className="brand-emblem" src="/emblema-loja-do-ouro.png" alt="" width="44" height="44" />
          <span className="brand-caption">ADMINISTRAÇÃO</span>
        </Link>
        <div className="nav-groups">
        {groups.map((g) => (
          <div className="nav-group" key={g.label}>
            <div className="nav-label">{g.label}</div>
            <nav aria-label={g.label}>
              {g.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-label={item.label}
                  title={item.label}
                  className={current === item.key ? "active" : ""}
                  aria-current={current === item.key ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {!!item.badge && <b>{item.badge}</b>}
                </Link>
              ))}
            </nav>
          </div>
        ))}
        </div>
        <NavScroll current={current} />
        <div className="sidebar-bottom">
          <Link href="/conta" className={`private-label${current === "conta" ? " active" : ""}`} title="A minha conta · mudar palavra-passe">
            <Icon name="user" />
            <span>
              {name}
              <small>A minha conta</small>
            </span>
          </Link>
          <form action="/api/auth/logout" method="post">
            <button className="logout">
              <Icon name="exit" />
              Terminar sessão
            </button>
          </form>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <MenuToggle collapsed={collapsed}>
            <Icon name="panel" />
          </MenuToggle>
          <span>
            Loja do Ouro <i>/</i> <strong>{title}</strong>
          </span>
          <div>
            <span className="status-dot" />
            <Link href="/conta" className="topbar-account" title="A minha conta">
              {name} <span className="avatar">{initials(viewer.fullName, viewer.username)}</span>
            </Link>
            <form action="/api/auth/logout" method="post" className="topbar-logout">
              <button aria-label="Terminar sessão" title="Terminar sessão">
                <Icon name="exit" />
              </button>
            </form>
          </div>
        </header>
        <main id="conteudo">{children}</main>
      </div>
    </div>
  );
}

export function PageHeading({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}

// Result message after a form action (?ok=... or ?erro=...).
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error)
    return (
      <div role="alert" className="notice error-notice">
        <Icon name="check" />
        <span>{error}</span>
      </div>
    );
  if (ok)
    return (
      <div role="status" className="notice ok-notice">
        <Icon name="check" />
        <span>{ok}</span>
      </div>
    );
  return null;
}
