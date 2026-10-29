"use client";

import { useLayoutEffect } from "react";

// No telemóvel (barra inferior), no tablet e com o menu recolhido no computador (coluna de ícones) o menu desliza:
// a opção atual fica à vista, sem ser preciso procurá-la. Só mexe no próprio menu, nunca na página.
export function showCurrent() {
  const item = document.querySelector<HTMLElement>('.sidebar nav a[aria-current="page"]');
  if (!item) return;
  const r = item.getBoundingClientRect();
  const bar = item.closest<HTMLElement>(".nav-groups");
  if (bar && bar.scrollWidth > bar.clientWidth + 1) {
    const b = bar.getBoundingClientRect();
    if (r.left < b.left || r.right > b.right) bar.scrollLeft += r.left - b.left - (b.width - r.width) / 2;
    return;
  }
  const side = item.closest<HTMLElement>(".sidebar");
  if (side && side.scrollHeight > side.clientHeight + 1) {
    const s = side.getBoundingClientRect();
    if (r.top < s.top || r.bottom > s.bottom) side.scrollTop += r.top - s.top - (s.height - r.height) / 2;
  }
}

// Ao abrir uma página. Corre antes de o browser pintar, para a barra não aparecer no início e saltar depois.
export function NavScroll({ current }: { current: string }) {
  useLayoutEffect(() => showCurrent(), [current]);
  return null;
}
