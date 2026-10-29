"use client";

import { useEffect, useSyncExternalStore } from "react";
import { showCurrent } from "@/components/nav-scroll";
import { isMenuShortcut, MENU_COLLAPSED, menuCookie, menuTitle } from "@/lib/menu";

// Recolher e mostrar o menu lateral no computador. O estado vive no <html data-menu>, que o layout do painel desenha
// a partir do cookie e que não volta a desenhar ao navegar; este botão só o lê e o muda (e grava o cookie).
const subscribe = (onChange: () => void) => {
  const o = new MutationObserver(onChange);
  o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-menu"] });
  return () => o.disconnect();
};
const isCollapsed = () => document.documentElement.dataset.menu === MENU_COLLAPSED;
// Até 960 px o menu já é a coluna de ícones (tablet) ou a barra de baixo (telemóvel): o atalho não faz nada.
const desktop = () => window.matchMedia("(min-width: 960.02px)").matches;

function setMenu(collapsed: boolean) {
  if (collapsed) document.documentElement.dataset.menu = MENU_COLLAPSED;
  else delete document.documentElement.dataset.menu;
  document.cookie = menuCookie(collapsed, location.protocol === "https:");
  showCurrent();
}

export function MenuToggle({ collapsed: initial, children }: { collapsed: boolean; children: React.ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, isCollapsed, () => initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMenuShortcut(e) || !desktop()) return;
      e.preventDefault();
      setMenu(!isCollapsed());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button
      type="button"
      className="menu-toggle"
      aria-label="Menu lateral"
      aria-controls="menu-lateral"
      aria-expanded={!collapsed}
      aria-keyshortcuts={"Control+\\ Meta+\\"}
      title={menuTitle(collapsed)}
      onClick={() => setMenu(!isCollapsed())}
    >
      {children}
    </button>
  );
}
