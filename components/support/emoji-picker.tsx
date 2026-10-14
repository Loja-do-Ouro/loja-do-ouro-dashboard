"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { EMOJI_GROUPS, emojiByChar, pushRecent, searchEmoji, type Emoji } from "@/lib/support/emoji";

const RECENT_KEY = "ldo-support-emoji-recent";
const finePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && !!emojiByChar(c)) : [];
  } catch {
    return [];
  }
}

// Escolha com o rato (o cursor volta à mensagem) ou com o teclado/toque (fica no painel).
function byMouse(ev: MouseEvent<HTMLButtonElement>) {
  const type = (ev.nativeEvent as PointerEvent).pointerType;
  return type ? type === "mouse" : ev.detail > 0 && finePointer();
}

// Setas, Home e End movem o foco entre os botões de uma lista (separadores ou grelha de emojis).
function moveFocus(e: KeyboardEvent<HTMLElement>, grid: boolean): number | undefined {
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const cols = grid ? Math.max(1, buttons.filter((b) => b.offsetTop === buttons[0]?.offsetTop).length) : 1;
  const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ...(grid ? { ArrowDown: cols, ArrowUp: -cols } : {}) };
  if (at < 0 || !(e.key in step || e.key === "Home" || e.key === "End")) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : at + step[e.key];
  if (next < 0 || next >= buttons.length) return;
  buttons[next].focus();
  return next;
}

// Escolher emojis para a resposta ou para a nota. Fica aberto para se escolherem vários;
// os mais usados por esta pessoa (neste navegador) aparecem em "Recentes".
export function EmojiPicker({ onPick, onClose }: { onPick: (char: string, viaMouse: boolean) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  // "Recentes" mostra a lista de quando o painel abriu: não muda de ordem debaixo do rato.
  const [recent, setRecent] = useState<string[]>([]);
  const stored = useRef<string[]>([]);
  const [tab, setTab] = useState(EMOJI_GROUPS[0].id);
  const [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = loadRecent();
    stored.current = saved;
    setRecent(saved);
    if (saved.length) setTab("recentes");
    // Com rato e teclado, pode escrever logo a pesquisa. No telemóvel não se abre o teclado.
    if (finePointer()) search.current?.focus();
  }, []);

  const results = useMemo(() => searchEmoji(q), [q]);
  const searching = q.trim().length > 0;
  const recentItems = recent.map((c) => emojiByChar(c)).filter((e): e is Emoji => !!e);
  const tabs = [...(recentItems.length ? [{ id: "recentes", label: "Recentes", icon: "🕘", items: recentItems }] : []), ...EMOJI_GROUPS];
  const current = tabs.find((t) => t.id === tab) || tabs[0];
  const shown = searching ? results : current.items;
  const focusIndex = Math.min(active, Math.max(0, shown.length - 1));

  const pick = (e: Emoji, viaMouse: boolean) => {
    onPick(e.char, viaMouse);
    stored.current = pushRecent(stored.current, e.char);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(stored.current));
    } catch {
      // Sem armazenamento local os recentes ficam só nesta janela.
    }
  };
  const chooseTab = (id: string) => {
    setTab(id);
    setActive(0);
  };

  return (
    <div
      className="emoji-picker"
      role="dialog"
      aria-label="Inserir emoji"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="catalog-head">
        <input
          ref={search}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              pick(results[0], false);
              // A pesquisa fica selecionada: a seguinte substitui-a.
              e.currentTarget.select();
            }
          }}
          placeholder="Procurar emoji (ex.: obrigada, coração, anel, entrega)"
          aria-label="Procurar emoji"
        />
        <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
      </div>
      {!searching && (
        <div className="emoji-tabs" role="tablist" aria-label="Categorias de emojis" onKeyDown={(e) => {
          const i = moveFocus(e, false);
          if (i !== undefined) chooseTab(tabs[i].id);
        }}>
          {tabs.map((t) => (
            <button key={t.id} id={`emoji-tab-${t.id}`} type="button" role="tab" aria-selected={t.id === current.id} tabIndex={t.id === current.id ? 0 : -1} className={t.id === current.id ? "active" : ""} onClick={() => chooseTab(t.id)} title={t.label} aria-label={t.label}>
              <span aria-hidden="true">{t.icon}</span>
            </button>
          ))}
        </div>
      )}
      <p className="emoji-caption" aria-live="polite">{searching ? (results.length ? `${results.length} ${results.length === 1 ? "resultado" : "resultados"} para “${q.trim()}” · Enter insere o primeiro` : `Sem emojis para “${q.trim()}”.`) : ""}</p>
      <div
        className="emoji-grid"
        {...(searching ? { role: "group", "aria-label": "Resultados da pesquisa" } : { role: "tabpanel", "aria-labelledby": `emoji-tab-${current.id}` })}
        onKeyDown={(e) => {
          const i = moveFocus(e, true);
          if (i !== undefined) setActive(i);
        }}
      >
        {shown.map((e, i) => (
          <button key={e.char} type="button" tabIndex={i === focusIndex ? 0 : -1} onFocus={() => setActive(i)} onClick={(ev) => pick(e, byMouse(ev))} title={e.name} aria-label={e.name}>
            {e.char}
          </button>
        ))}
      </div>
    </div>
  );
}
