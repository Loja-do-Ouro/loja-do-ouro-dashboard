"use client";

import { useEffect, useRef, useState } from "react";
import type { Item, Option } from "@/lib/store-records";

type Row = { key: number; item: Item | null };

// Artigos vendidos num atendimento: começa com as linhas habituais (ou as do registo a corrigir) e a pessoa
// acrescenta mais com "Adicionar artigo", até ao máximo que a base de dados aceita. As linhas vazias são ignoradas
// ao gravar; os nomes dos campos (item_N_…) seguem a ordem das linhas que ficam.
export function ItemRows({ initial, rows, max, materials, types }: { initial: Item[]; rows: number; max: number; materials: Option[]; types: Option[] }) {
  const next = useRef(0);
  const make = (item: Item | null): Row => ({ key: next.current++, item });
  const [list, setList] = useState<Row[]>(() => Array.from({ length: Math.min(max, Math.max(rows, initial.length)) }, (_, i) => make(initial[i] || null)));
  const focusKey = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusKey.current === null) return;
    box.current?.querySelector<HTMLInputElement>(`[data-row="${focusKey.current}"] input`)?.focus();
    focusKey.current = null;
  }, [list]);

  const add = () => {
    if (list.length >= max) return;
    const row = make(null);
    focusKey.current = row.key;
    setList((l) => [...l, row]);
  };
  const remove = (key: number) => setList((l) => (l.length > 1 ? l.filter((r) => r.key !== key) : l));

  return (
    <div className="item-rows" ref={box}>
      {list.map((r, i) => (
        <div className="item-row" key={r.key} data-row={r.key}>
          <input name={`item_${i}_reference`} maxLength={40} placeholder="Referência" aria-label={`Referência do artigo ${i + 1}`} defaultValue={r.item?.reference || ""}
            onKeyDown={(e) => {
              // Enter (ou o leitor de códigos) passa ao material da mesma linha, em vez de gravar o atendimento.
              if (e.key !== "Enter") return;
              e.preventDefault();
              (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
            }} />
          <OptionSelect name={`item_${i}_material`} options={materials} value={r.item?.material} empty="Material…" label={`Material do artigo ${i + 1}`} />
          <OptionSelect name={`item_${i}_type`} options={types} value={r.item?.product_type} empty="Tipo de artigo…" label={`Tipo do artigo ${i + 1}`} />
          <button type="button" className="item-remove" onClick={() => remove(r.key)} disabled={list.length <= 1}
            aria-label={`Retirar o artigo ${i + 1}`} title="Retirar esta linha">✕</button>
        </div>
      ))}
      <div className="item-rows-actions">
        <button type="button" className="secondary-button" onClick={add} disabled={list.length >= max}>+ Adicionar artigo</button>
        <small>{list.length >= max ? `Máximo de ${max} artigos por atendimento.` : "Linhas vazias não são gravadas."}</small>
      </div>
    </div>
  );
}

function OptionSelect({ name, options, value, empty, label }: { name: string; options: Option[]; value?: string | null; empty: string; label: string }) {
  const known = options.some((o) => o.code === value);
  return (
    <select name={name} defaultValue={value || ""} aria-label={label}>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>{o.label}</option>
      ))}
      {value && !known && <option value={value}>{value}</option>}
    </select>
  );
}
