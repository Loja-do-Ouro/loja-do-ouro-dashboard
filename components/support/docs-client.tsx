"use client";

import { useEffect, useState } from "react";

// Atalho "/" para ir à pesquisa (fora de campos de texto). No teclado português é Shift+7: o Shift não conta.
export function useSlashFocus(focus: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);
}

// Na página de um artigo: "/" leva ao campo de pesquisa da coluna lateral.
export function DocsSlashFocus({ target }: { target: string }) {
  const [focus] = useState(() => () => {
    const el = document.getElementById(target) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  });
  useSlashFocus(focus);
  return null;
}

// Copia a ligação direta para uma secção (o endereço do artigo com #secção).
export function DocsCopyLink({ id, label }: { id: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
    } catch {
      // Sem acesso à área de transferência: pelo menos a barra de endereço fica com a ligação da secção.
      window.location.hash = id;
    }
  };
  return (
    <button type="button" className={`docs-anchor${done ? " done" : ""}`} onClick={copy} aria-label={`Copiar a ligação para a secção «${label}»`} title="Copiar a ligação para esta secção">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {done ? <path d="M5 12l5 5 9-10" /> : <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />}
      </svg>
      <span className="sr-only" role="status">{done ? "Ligação copiada" : ""}</span>
    </button>
  );
}
