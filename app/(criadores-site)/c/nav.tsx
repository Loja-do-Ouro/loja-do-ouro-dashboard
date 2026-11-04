"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";

// Navegação do site com a página atual marcada (aria-current). Os caminhos comparam-se sem o prefixo /c, que só
// existe no endereço do dashboard (testes internos antes do DNS). Sem ícones: só palavras (§10.5 n.º 9).

export type NavItem = { path: string; label: string; count?: number; match?: string[] };

const relative = (p: string) => (p === "/c" ? "/" : p.startsWith("/c/") ? p.slice(2) : p) || "/";

function isCurrent(pathname: string, item: NavItem) {
  const here = relative(pathname);
  return [item.path, ...(item.match || [])].some((p) => (p === "/" ? here === "/" : here === p || here.startsWith(`${p}/`)));
}

// Fecha o <details> do menu do telemóvel depois de escolher um destino.
function closeMenu(e: MouseEvent<HTMLElement>) {
  const d = e.currentTarget.closest("details");
  if (d) d.open = false;
}

export function NavLinks({ base, items }: { base: string; items: NavItem[] }) {
  const pathname = usePathname() || "/";
  return (
    <>
      {items.map((item) => (
        <Link key={item.path} href={`${base}${item.path === "/" ? "" : item.path}` || "/"} aria-current={isCurrent(pathname, item) ? "page" : undefined} onClick={closeMenu}>
          {item.label}
          {item.count ? <><span className="cr-contador" aria-hidden="true">{item.count}</span><span className="cr-sr"> ({item.count} por ler)</span></> : null}
        </Link>
      ))}
    </>
  );
}

// Barra inferior do telemóvel na área do criador: 5 destinos.
export function BottomBar({ base, items }: { base: string; items: NavItem[] }) {
  return (
    <nav className="cr-barra" aria-label="Área do criador">
      <NavLinks base={base} items={items} />
    </nav>
  );
}
