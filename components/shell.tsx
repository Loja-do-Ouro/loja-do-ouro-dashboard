import Link from "next/link";
import { Icon } from "@/components/dashboard/ui";
import { canCompareStores, canManageStores, canManageUsers, canSeeOnline, initials } from "@/lib/permissions";
import type { Viewer } from "@/lib/viewer";

export const ONLINE_SECTIONS = [
  ["overview", "Visão geral", "grid"],
  ["sales", "Vendas e operação", "bag"],
  ["marketing", "Marketing e canais", "ads"],
  ["audience", "Públicos e regiões", "people"],
  ["quality", "Relatórios e qualidade", "check"],
] as const;

type Item = { key: string; label: string; href: string; icon: string; badge?: number };

// Sidebar and top bar shared by every page; each person only sees what they can open.
export function AppShell({
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
      items: ONLINE_SECTIONS.map(([key, label, icon]) => ({ key, label, icon, href: onlineHref(key), badge: badges[key] })),
    });
  if (!locked && viewer.stores.length)
    groups.push({
      label: "LOJAS FÍSICAS",
      items: [
        { key: "lojas", label: "Vendas e atendimentos", href: "/lojas", icon: "bag" },
        { key: "ouro", label: "Compra de ouro", href: "/lojas/ouro", icon: "sales" },
        ...(canCompareStores(viewer) ? [{ key: "comparar", label: "Comparar lojas", href: "/lojas/comparar", icon: "grid" }] : []),
      ],
    });
  if (!locked && canManageUsers(viewer))
    groups.push({
      label: "ADMINISTRAÇÃO",
      items: [
        { key: "utilizadores", label: "Utilizadores", href: "/admin/utilizadores", icon: "people" },
        ...(canManageStores(viewer)
          ? [
              { key: "admin-lojas", label: "Lojas", href: "/admin/lojas", icon: "bag" },
              { key: "opcoes", label: "Listas de opções", href: "/admin/opcoes", icon: "check" },
            ]
          : []),
      ],
    });
  const name = viewer.fullName || viewer.username;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Loja do Ouro · início">
          <img
            className="official-logo"
            src="https://res.cloudinary.com/vbnyvvyq/image/upload/e_trim:10,q_100,f_png/v1788866860/Logo_LojaOuro_Vector1_1.png"
            alt="Loja do Ouro"
            width="160"
            height="60"
          />
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
        <div className="sidebar-bottom">
          <Link href="/conta" className={`private-label${current === "conta" ? " active" : ""}`} title="A minha conta · mudar palavra-passe">
            <Icon name="check" />
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
