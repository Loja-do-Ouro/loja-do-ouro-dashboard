"use client";

import { useEffect, useState } from "react";

type Item = { kind: "product" | "collection" | "page"; title: string; url: string; image: string | null; photo: string | null; price: string | null; available: boolean | null };
const KIND = { product: "Produto", collection: "Coleção", page: "Página" } as const;

// Pesquisa na loja online (só produtos, coleções e páginas publicados) para inserir o link na resposta.
// "Link + foto" também anexa a fotografia do produto (canais que aceitam imagens).
export function CatalogPicker({ onInsert, onClose, canAttach }: {
  onInsert: (item: Item, withImage: boolean) => void;
  onClose: () => void;
  canAttach: boolean;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [state, setState] = useState<{ loading: boolean; error: string; pages: boolean | null }>({ loading: false, error: "", pages: null });

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      setState((s) => ({ ...s, loading: false, error: "" }));
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: "" }));
      try {
        const r = await fetch(`/api/support/shopify?${new URLSearchParams({ q: term })}`, { cache: "no-store" });
        const j = (await r.json()) as { items?: Item[]; pages?: boolean; error?: string };
        if (cancelled) return;
        setItems(j.items || []);
        setState((s) => ({ loading: false, error: j.error || (!r.ok ? "Pesquisa indisponível." : ""), pages: typeof j.pages === "boolean" && !j.error ? j.pages : s.pages }));
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: "Pesquisa indisponível." }));
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="catalog-picker" role="dialog" aria-label="Inserir produto ou página da loja">
      <div className="catalog-head">
        <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto, coleção ou página da loja online" aria-label="Procurar na loja" />
        <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
      </div>
      {state.error && <p className="support-error">{state.error}</p>}
      {state.loading && <small className="muted">A procurar…</small>}
      <ul>
        {items.map((it) => (
          <li key={it.url}>
            {it.image ? <img src={it.image} alt="" loading="lazy" /> : <span className="catalog-noimg">{KIND[it.kind][0]}</span>}
            <span className="catalog-text">
              <strong>{it.title}</strong>
              <small>
                {KIND[it.kind]}
                {it.price ? ` · ${it.price}` : ""}
                {it.available === false ? " · esgotado" : ""}
              </small>
            </span>
            <span className="catalog-actions">
              <button type="button" className="secondary-button" onClick={() => onInsert(it, false)}>Inserir link</button>
              {canAttach && it.kind === "product" && it.photo && (
                <button type="button" className="secondary-button" onClick={() => onInsert(it, true)}>Link + foto</button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {q.trim().length >= 2 && !state.loading && !items.length && !state.error && <small className="muted">Sem resultados publicados na loja online.</small>}
      {state.pages === false && <small className="muted block">Páginas da loja: disponíveis quando a app Shopify tiver a autorização read_online_store_pages.</small>}
    </div>
  );
}
