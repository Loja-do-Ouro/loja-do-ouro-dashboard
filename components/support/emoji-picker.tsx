"use client";

import { useEffect, useMemo, useState } from "react";
import { EMOJI_GROUPS, emojiByChar, pushRecent, searchEmoji, type Emoji } from "@/lib/support/emoji";

const RECENT_KEY = "ldo-support-emoji-recent";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && !!emojiByChar(c)) : [];
  } catch {
    return [];
  }
}

// Escolher emojis para a resposta ou para a nota. Fica aberto para se escolherem vários;
// os mais usados por esta pessoa (neste navegador) aparecem em "Recentes".
export function EmojiPicker({ onPick, onClose }: { onPick: (char: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [tab, setTab] = useState(EMOJI_GROUPS[0].id);

  useEffect(() => {
    const saved = loadRecent();
    setRecent(saved);
    if (saved.length) setTab("recentes");
  }, []);

  const results = useMemo(() => searchEmoji(q), [q]);
  const searching = q.trim().length > 0;
  const recentItems = recent.map((c) => emojiByChar(c)).filter((e): e is Emoji => !!e);
  const tabs = [...(recentItems.length ? [{ id: "recentes", label: "Recentes", icon: "🕘", items: recentItems }] : []), ...EMOJI_GROUPS];
  const current = tabs.find((t) => t.id === tab) || tabs[0];
  const shown = searching ? results : current.items;

  const pick = (e: Emoji) => {
    onPick(e.char);
    const next = pushRecent(recent, e.char);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Sem armazenamento local os recentes ficam só nesta janela.
    }
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
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              pick(results[0]);
            }
          }}
          placeholder="Procurar emoji (ex.: obrigado, coração, anel, entrega)"
          aria-label="Procurar emoji"
        />
        <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
      </div>
      {!searching && (
        <div className="emoji-tabs" role="tablist" aria-label="Categorias de emojis">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === current.id} className={t.id === current.id ? "active" : ""} onClick={() => setTab(t.id)} title={t.label} aria-label={t.label}>
              <span aria-hidden="true">{t.icon}</span>
            </button>
          ))}
        </div>
      )}
      <p className="emoji-caption">{searching ? (results.length ? `Resultados para “${q.trim()}”` : `Sem emojis para “${q.trim()}”.`) : current.label}</p>
      <div className="emoji-grid" role="group" aria-label={searching ? "Resultados da pesquisa" : current.label}>
        {shown.map((e) => (
          <button key={e.char} type="button" onClick={() => pick(e)} title={e.name} aria-label={e.name}>
            {e.char}
          </button>
        ))}
      </div>
    </div>
  );
}
