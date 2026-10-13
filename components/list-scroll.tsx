"use client";

import { useLayoutEffect, useRef } from "react";

// Caixa com scroll da lista de atendimentos. O Next reaproveita a página ao mudar a ordem, o período ou o filtro
// (só mudam os parâmetros do endereço), por isso a caixa volta ao topo para se ver o início da nova lista. Ao repor a
// ordem habitual pelo teclado, o link desaparece: o foco passa para a lista em vez de se perder.
export function ListScroll({ listKey, sorted, label, children }: { listKey: string; sorted: boolean; label: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef({ listKey, sorted });
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { listKey, sorted };
    if (before.listKey === listKey || !box.current) return;
    box.current.scrollTop = 0;
    if (before.sorted && !sorted && (!document.activeElement || document.activeElement === document.body)) box.current.focus();
  }, [listKey, sorted]);
  return (
    <div className="table-scroll" tabIndex={0} aria-label={label} ref={box}>
      {children}
    </div>
  );
}
