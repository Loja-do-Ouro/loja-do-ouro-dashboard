"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL, type DocCategory } from "@/lib/support/docs-format";
import { buildSearchIndex, searchDocs, type SearchRecord, type SearchResult, type Segment } from "@/lib/support/docs-search";
import { useSlashFocus } from "./docs-client";

export type DocCard = { slug: string; title: string; resumo: string; category: DocCategory; superOnly: boolean };

const CATEGORY_TEXT: Record<DocCategory, string> = {
  funcionamento: "Cada parte do Apoio ao Cliente, passo a passo.",
  legal: "O que a lei exige (RGPD, consumidor) e como o cumprimos no dia a dia.",
  referencia: "Consultas rápidas: glossário, limites e perguntas frequentes.",
};

function Marks({ s }: { s: Segment[] }) {
  return <>{s.map((x, i) => (x.hit ? <mark key={i}>{x.text}</mark> : x.text))}</>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const EMPTY: SearchResult = { hits: [], terms: 0, suggestion: null };

// suggestions: pesquisas sugeridas, já escolhidas no servidor (só as que encontram alguma coisa para esta pessoa).
export function DocsSearch({ records, articles, suggestions, initialQuery }: { records: SearchRecord[]; articles: DocCard[]; suggestions: string[]; initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // O índice só se constrói à primeira pesquisa (abrir a página sem pesquisar não o paga, num telemóvel lento); depois
  // fica, mesmo que se apague a pesquisa.
  const [active, setActive] = useState(() => Boolean(initialQuery.trim()));
  if (!active && q.trim()) setActive(true);
  const index = useMemo(() => (active ? buildSearchIndex(records) : null), [active, records]);
  const result = useMemo(() => (index && q.trim() ? searchDocs(index, q) : EMPTY), [index, q]);
  const starters = useMemo(() => articles.filter((a) => a.category === "funcionamento").slice(0, 4), [articles]);
  const query = q.trim();

  // A pesquisa fica no endereço (?q=…), para a partilhar ou voltar a ela; sem criar uma entrada no histórico por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      if ((url.searchParams.get("q") || "") === query) return;
      if (query) url.searchParams.set("q", query);
      else url.searchParams.delete("q");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Anúncio para leitores de ecrã, só quando se para de escrever.
  const message = !query
    ? ""
    : !result.terms
      ? "Escreva palavras com significado."
      : result.hits.length
        ? `${plural(result.hits.length, "resultado", "resultados")} para ${query}.`
        : `Nenhum resultado para ${query}.`;
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(message), 500);
    return () => clearTimeout(t);
  }, [message]);

  const focusSearch = useCallback(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useSlashFocus(focusSearch);

  const links = () => Array.from(list.current?.querySelectorAll<HTMLAnchorElement>("a[data-hit]") || []);
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      const first = links()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (result.hits[0]) router.push(result.hits[0].href);
    } else if (e.key === "Escape" && q) {
      e.preventDefault();
      setQ("");
    }
  };
  const onListKey = (e: React.KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Escape") return;
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    e.preventDefault();
    if (e.key === "Escape") return input.current?.focus();
    const next = e.key === "ArrowDown" ? Math.min(at + 1, all.length - 1) : at - 1;
    if (next < 0) input.current?.focus();
    else all[next].focus();
  };

  const suggestionChips = suggestions.length > 0 && (
    <div className="docs-suggestions">
      <p className="eyebrow" id="docs-sugestoes">Pesquisas sugeridas</p>
      <div className="chips" role="group" aria-labelledby="docs-sugestoes">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            onClick={() => {
              setQ(s);
              input.current?.focus();
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="docs-search">
      <div className="docs-search-box" role="search">
        <label htmlFor="docs-q">Procurar na documentação</label>
        <div className="docs-search-field">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M20 20l-4-4" />
          </svg>
          <input
            id="docs-q"
            ref={input}
            type="search"
            value={q}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="Escreva a sua dúvida: como passo uma conversa a uma colega?"
            aria-describedby="docs-q-dica"
            aria-controls={query && result.hits.length ? "docs-resultados" : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
          />
          <kbd aria-hidden="true" title="Carregue em / para procurar">/</kbd>
        </div>
        <p id="docs-q-dica" className="docs-hint">
          Escreva como perguntaria a uma colega: a pesquisa percebe sinónimos, plurais e erros de escrita. Setas para escolher um resultado, Enter para o abrir.
        </p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {result.suggestion && (
        <p className="docs-didyoumean">
          Quis dizer{" "}
          <button type="button" className="link-like" onClick={() => setQ(result.suggestion!)}>
            {result.suggestion}
          </button>
          ?
        </p>
      )}

      {query && result.hits.length > 0 ? (
        <section aria-label="Resultados da pesquisa">
          <p className="docs-count">{plural(result.hits.length, "resultado", "resultados")}</p>
          <ol id="docs-resultados" ref={list} className="docs-results" onKeyDown={onListKey}>
            {result.hits.map((h) => (
              <li key={h.href}>
                <Link href={h.href} className="docs-hit" data-hit="">
                  <span className="docs-hit-path">
                    <Marks s={h.title} />
                    {h.heading && (
                      <>
                        <span className="docs-sep" aria-hidden="true">
                          ›
                        </span>
                        {h.parent && (
                          <>
                            {h.parent}
                            <span className="docs-sep" aria-hidden="true">
                              ›
                            </span>
                          </>
                        )}
                        <Marks s={h.heading} />
                      </>
                    )}
                  </span>
                  {h.question && (
                    <span className="docs-hit-question">
                      Responde a: <Marks s={h.question} />
                    </span>
                  )}
                  {h.snippet.length > 0 && (
                    <span className="docs-hit-snippet">
                      <Marks s={h.snippet} />
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : query ? (
        <div className="docs-empty">
          <p>
            <strong>{result.terms ? `Nenhum resultado para «${query}».` : "Escreva palavras com significado."}</strong>{" "}
            {result.terms ? "Experimente outras palavras, mais curtas ou mais gerais." : "Por exemplo: transferir conversa, apagar dados, garantia."}
          </p>
          {suggestionChips}
          {starters.length > 0 && (
            <div className="docs-starters">
              <p className="eyebrow">Para começar</p>
              <ul>
                {starters.map((a) => (
                  <li key={a.slug}>
                    <Link href={`/apoio/documentacao/${a.slug}`}>{a.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <>
          {suggestionChips}
          {!articles.length && <p className="docs-empty">Ainda não há artigos publicados.</p>}
          {(["funcionamento", "legal", "referencia"] as const).map((cat) => {
            const items = articles.filter((a) => a.category === cat);
            if (!items.length) return null;
            return (
              <section key={cat} className="docs-group" aria-labelledby={`docs-cat-${cat}`}>
                <div className="docs-group-head">
                  <h2 id={`docs-cat-${cat}`}>{CATEGORY_LABEL[cat]}</h2>
                  <p>{CATEGORY_TEXT[cat]}</p>
                </div>
                <ul className="docs-cards">
                  {items.map((a) => (
                    <li key={a.slug}>
                      <Link href={`/apoio/documentacao/${a.slug}`} className="docs-card">
                        <strong>{a.title}</strong>
                        <span>{a.resumo}</span>
                        {a.superOnly && <span className="pill">Só Super Admin</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
