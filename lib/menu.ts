// Menu lateral recolhido no computador (fica só a coluna de ícones, como no tablet). É uma preferência de cada
// browser, num cookie sem dados pessoais que o servidor lê: a página chega já no estado certo, sem saltar.
export const MENU_COOKIE = "ldo_menu";
export const MENU_COLLAPSED = "recolhido";

export const menuCollapsed = (value?: string | null) => value === MENU_COLLAPSED;

// Cookie escrito pelo browser: recolhido fica um ano; aberto apaga-o (max-age=0).
export function menuCookie(collapsed: boolean, secure: boolean) {
  return `${MENU_COOKIE}=${collapsed ? MENU_COLLAPSED : ""}; path=/; max-age=${collapsed ? 31536000 : 0}; samesite=lax${secure ? "; secure" : ""}`;
}

export const menuTitle = (collapsed: boolean) => `${collapsed ? "Mostrar" : "Recolher"} o menu (Ctrl+\\)`;

// Atalho Ctrl+\ (Cmd+\ no Mac). No teclado português o "\" é a tecla à esquerda do 1 (e.code "Backquote"), por isso
// conta a tecla escrita (e.key). Com Alt (o AltGr do Windows é Ctrl+Alt) ou Shift, ou com a tecla mantida, não conta.
export function isMenuShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }) {
  return e.key === "\\" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.repeat;
}
