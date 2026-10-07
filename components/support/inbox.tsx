"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHANNEL_LABEL,
  DELIVERY_LABEL,
  STATUSES,
  STATUS_LABEL,
  type Channel,
  type Delivery,
  type Kind,
  type Status,
} from "@/lib/support/rules";

type Source = { id: string; platform: string; channel: Channel; label: string; status: string; status_detail: string | null; last_success_at: string | null; last_attempt_at: string | null; last_error: string | null };
type Item = {
  id: string; channel: Channel; subject: string | null; status: Status; contact_name: string; contact_handle: string | null;
  assignee_id: string | null; assignee_name: string | null; last_message_at: string; last_preview: string | null; last_direction: Kind | null;
  unread: number; attention: boolean;
};
type List = { items: Item[]; counts: { all: number; mine: number; unassigned: number; unread: number }; sources: Source[]; poll_seconds: number };
type Message = {
  id: string; kind: Kind; author_name: string | null; author_user_id: string | null; body: string;
  attachments: { name: string; type: string | null; size: number | null; ref: string }[];
  created_at: string; inserted_at: string; deleted: boolean; delivery: Delivery | null; delivery_detail: string | null; external: boolean;
};
type User = { id: string; name: string; me: boolean; zendesk: boolean; zendesk_name: string | null; zendesk_status: string | null };
type Detail = {
  conversation: {
    id: string; source_id: string; channel: Channel; external_id: string; subject: string | null; status: Status; platform_status: string | null;
    assignee_id: string | null; assignee_name: string | null; external_assignee_id: string | null; external_assignee_name: string | null;
    via: string | null; platform: string; source_label: string; source_status: string; read_at: string | null; last_inbound_at: string | null;
    last_inbound_inserted_at: string | null;
  };
  contact: { id: string; name: string | null; email: string | null; phone: string | null; handle: string | null; linked_email: string | null; linked_by_name: string | null; linked_at: string | null } | null;
  related: { contact_id: string; channel: Channel; name: string | null; email: string | null; phone: string | null; conversation_id: string | null }[];
  messages: Message[];
  presence: { user_id: string; name: string; composing: boolean }[];
  audit: { action: string; details: Record<string, unknown>; created_at: string; actor: string }[];
  users: User[];
  me: string;
};
type Orders = { email: string | null; orders: { name: string; created_at: string; cancelled: boolean; financial: string | null; fulfillment: string | null; total: number | null; currency: string | null; admin_url: string }[]; error?: string; note?: string; linked?: boolean };

const FILTERS = [
  ["all", "Todas"],
  ["mine", "Minhas"],
  ["unassigned", "Sem responsável"],
  ["unread", "Não lidas"],
] as const;

const time = (iso: string | null | undefined, withDate = true) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short" }).format(new Date());
  const day = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short" }).format(d);
  const hm = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" }).format(d);
  return !withDate || day === today ? hm : `${day} ${hm}`;
};

const REASON: Record<string, string> = {
  running: "já está a sincronizar", recent: "sincronizou há instantes", backoff: "em espera depois de erros", not_due: "ainda não é a hora",
};

const AUDIT: Record<string, string> = {
  status: "mudou o estado", assign: "atribuiu", reply: "respondeu", note: "acrescentou uma nota", reopen: "reabriu (nova mensagem do cliente)",
  link_customer: "associou o cliente", "zendesk.connect": "ligou o Zendesk", "zendesk.disconnect": "desligou o Zendesk",
};

// Pedidos à API do Apoio ao Cliente. Uma sessão expirada devolve a página de login (não JSON).
async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(path, {
    method: init?.method || "GET",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const isJson = (r.headers.get("content-type") || "").includes("application/json");
  if (r.status === 401 || (r.redirected && new URL(r.url).pathname === "/login"))
    throw new Error("Sessão terminada. Atualize a página e entre novamente.");
  if (!isJson) throw new Error(`Sem resposta do servidor (HTTP ${r.status}). Tente de novo dentro de momentos.`);
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `Pedido recusado (${r.status}).`);
  return data as T;
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

function loadStored<T>(key: string): T | Record<string, never> {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}
function store(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem armazenamento da sessão o valor continua só em memória.
  }
}
// No telemóvel só uma área está visível; a conversa só conta como aberta quando é a que se vê.
const narrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;

export function SupportInbox({
  zendeskSubdomain,
  zendeskReady,
  myZendesk,
  flash,
}: {
  zendeskSubdomain: string;
  zendeskReady: boolean;
  myZendesk: { connected: boolean; name: string | null; status: string | null };
  flash: { ok?: string; error?: string };
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<List | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [pane, setPane] = useState<"list" | "conversation" | "info">("list");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [drafts, setDrafts] = useState<Record<string, { reply: string; note: string }>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  // Chave de cada envio pendente, ligada ao texto exato: um pedido perdido repete-se com a mesma chave
  // (sem duplicar); um texto diferente leva sempre uma chave nova.
  const pendingKey = useRef<Record<string, { key: string; body: string }>>({});
  const lastTyped = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
  const messagesBox = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const paneRef = useRef(pane);
  paneRef.current = pane;
  // Conversas marcadas como não lidas: não voltam a ficar lidas sozinhas enquanto não forem reabertas.
  const keepUnread = useRef(new Set<string>());
  const listSeq = useRef(0);
  const continuation = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDrafts(loadStored("ldo-support-drafts") as Record<string, { reply: string; note: string }>);
    pendingKey.current = loadStored("ldo-support-pending") as Record<string, { key: string; body: string }>;
    return () => {
      if (continuation.current) clearTimeout(continuation.current);
    };
  }, []);
  useEffect(() => store("ldo-support-drafts", drafts), [drafts]);
  const conversationShown = (id: string) => selectedRef.current === id && (!narrow() || paneRef.current === "conversation");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const loadList = useCallback(async () => {
    const p = new URLSearchParams({ filtro: filter, ...(channel ? { canal: channel } : {}), ...(status ? { estado: status } : {}), ...(query ? { q: query } : {}) });
    // Só a resposta do pedido mais recente atualiza a lista.
    const seq = ++listSeq.current;
    try {
      const data = await api<List>(`/api/support/conversations?${p}`);
      if (seq !== listSeq.current) return;
      setList(data);
      setListError("");
    } catch (e) {
      if (seq === listSeq.current) setListError(e instanceof Error ? e.message : "Lista indisponível.");
    }
  }, [filter, channel, status, query]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api<Detail>(`/api/support/conversations/${id}`);
      // Uma resposta atrasada de outra conversa nunca substitui a que está aberta.
      if (selectedRef.current !== id) return;
      setDetail(d);
      setDetailError("");
      // Ter a conversa aberta e visível marca-a como lida para mim, só no dashboard (pela hora de chegada).
      const lastIn = d.conversation.last_inbound_inserted_at;
      if (visible() && conversationShown(id) && !keepUnread.current.has(id) && lastIn && (!d.conversation.read_at || lastIn > d.conversation.read_at))
        await api(`/api/support/conversations/${id}`, { method: "POST", body: { action: "read", seen: lastIn } }).catch(() => undefined);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Conversa indisponível.");
    }
  }, []);

  const sync = useCallback(async (force: boolean) => {
    if (force) setSyncing(true);
    try {
      const r = await api<{ results: { source: string; ran: boolean; ok?: boolean; detail?: string; reason?: string; more?: boolean }[] }>("/api/support/sync", { method: "POST", body: { force } });
      if (force) {
        const name = (x: { source: string }) => x.source.replace("metricool-", "");
        const failed = r.results.filter((x) => x.ran && x.ok === false);
        const waiting = r.results.filter((x) => !x.ran && x.reason && x.reason !== "not_due");
        setSyncNote([
          failed.length ? `Falha em ${failed.map(name).join(", ")}; as restantes fontes foram atualizadas.` : "Atualizado.",
          waiting.length ? `Não correu: ${waiting.map((x) => `${name(x)} (${REASON[x.reason!] || x.reason})`).join(", ")}.` : "",
        ].filter(Boolean).join(" "));
      }
      // Importação longa: a passagem seguinte pode correr logo (o servidor só aceita após 15 s).
      if (r.results.some((x) => x.more)) {
        if (continuation.current) clearTimeout(continuation.current);
        continuation.current = setTimeout(() => sync(false), 16000);
      }
    } catch (e) {
      if (force) setSyncNote(e instanceof Error ? e.message : "Atualização indisponível.");
    } finally {
      if (force) setSyncing(false);
    }
  }, []);

  // Lista: recarrega quando os filtros mudam e a cada 20 s; sincronização com as plataformas com a
  // frequência definida na configuração (o servidor decide se já está na hora).
  useEffect(() => {
    loadList();
    const t = setInterval(() => visible() && loadList(), 20000);
    return () => clearInterval(t);
  }, [loadList]);
  const poll = list?.poll_seconds || 60;
  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;
  // Mudar filtros ou pesquisar não volta a sincronizar; só a frequência reinicia o ciclo.
  useEffect(() => {
    sync(false).then(() => loadListRef.current());
    const t = setInterval(() => visible() && sync(false).then(() => loadListRef.current()), poll * 1000);
    return () => clearInterval(t);
  }, [poll, sync]);

  useEffect(() => {
    if (!selected) return;
    loadDetail(selected);
    const t = setInterval(() => visible() && loadDetail(selected), 15000);
    return () => clearInterval(t);
  }, [selected, loadDetail]);

  // Presença: quem tem a conversa aberta e se está a escrever (últimos 60 s).
  useEffect(() => {
    if (!selected) return;
    const ping = () =>
      visible() &&
      conversationShown(selected) &&
      api<{ presence: Detail["presence"] }>(`/api/support/conversations/${selected}`, {
        method: "POST", body: { action: "presence", composing: lastTyped.current.id === selected && Date.now() - lastTyped.current.at < 30000 },
      })
        .then((r) => setDetail((d) => (d && d.conversation.id === selected ? { ...d, presence: r.presence } : d)))
        .catch(() => undefined);
    ping();
    const t = setInterval(ping, 20000);
    return () => clearInterval(t);
  }, [selected, pane]);

  // Só a lista de mensagens desce até ao fim (a página não se mexe, o campo de resposta fica à vista).
  useEffect(() => {
    const box = messagesBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [detail?.conversation.id, detail?.messages.length]);

  const open = (id: string) => {
    if (id !== selected) {
      setDetail(null);
      setSendError("");
      setActionError("");
      setActionNote("");
      setMode("reply");
    }
    keepUnread.current.delete(id);
    setSelected(id);
    setPane("conversation");
  };

  const c = detail?.conversation.id === selected ? detail : null;
  const isZendesk = c?.conversation.platform === "zendesk";
  const isWhatsapp = c?.conversation.platform === "whatsapp";
  const me = c?.users.find((u) => u.me);
  const draft = (selected && drafts[selected]) || { reply: "", note: "" };
  const text = mode === "reply" ? draft.reply : draft.note;
  const setDraft = (id: string, which: "reply" | "note", v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || { reply: "", note: "" }), [which]: v } }));
  const setText = (v: string) => {
    if (selected) setDraft(selected, mode, v);
  };
  // Só a escrita da própria pessoa conta como "a escrever" (e só nesta conversa).
  const typed = (v: string) => {
    if (!selected) return;
    lastTyped.current = { id: selected, at: Date.now() };
    setText(v);
  };
  const sending = sendingId === selected;

  const replyBlocked = !c
    ? "A carregar…"
    : isWhatsapp
      ? "WhatsApp por configurar: ainda não é possível responder por este canal."
      : isZendesk && !me?.zendesk
        ? "Ligue a sua conta Zendesk para responder com a sua autoria."
        : c.conversation.source_status === "blocked" && !isZendesk
          ? "A Metricool recusou o acesso a esta caixa de entrada. Ver a configuração do apoio."
          : "";
  const noteBlocked = !c ? "A carregar…" : isZendesk && !me?.zendesk ? "Ligue a sua conta Zendesk para escrever notas internas no ticket." : "";

  async function send() {
    if (!selected || !c || !text.trim() || sendingId) return;
    const blocked = mode === "reply" ? replyBlocked : noteBlocked;
    if (blocked) return;
    const id = selected, which = mode, body = text.trim();
    const slot = `${id}:${which}`;
    // A mesma chave só se reutiliza para o mesmo texto (pedido perdido): o servidor nunca envia duas vezes.
    const prev = pendingKey.current[slot];
    const key = prev && prev.body === body ? prev.key : crypto.randomUUID();
    pendingKey.current[slot] = { key, body };
    store("ldo-support-pending", pendingKey.current);
    const here = () => selectedRef.current === id;
    setSendingId(id);
    setSendError("");
    try {
      const r = await api<{ delivery: Delivery | null; detail?: string | null; repeated: boolean }>(`/api/support/conversations/${id}`, {
        method: "POST", body: { action: which === "reply" ? "reply" : "note", body, clientKey: key },
      });
      delete pendingKey.current[slot];
      store("ldo-support-pending", pendingKey.current);
      if (r.delivery === "failed") {
        // Falhou com certeza: o texto fica no rascunho para corrigir e voltar a enviar.
        if (here()) setSendError(r.detail || "O envio falhou. O texto ficou no rascunho.");
      } else {
        setDraft(id, which, "");
        if (r.delivery === "uncertain" && here()) setSendError("Resultado incerto: confirme com “Verificar” na mensagem antes de voltar a enviar.");
      }
      if (here()) await loadDetail(id);
      loadList();
    } catch (e) {
      // Sem resposta: rascunho e chave mantêm-se; voltar a carregar em Enviar com o mesmo texto não duplica.
      if (here()) setSendError(`${e instanceof Error ? e.message : "Sem resposta."} O texto ficou no rascunho; pode tentar de novo sem risco de duplicar.`);
    } finally {
      setSendingId(null);
    }
  }

  async function act(body: Record<string, unknown>, after?: () => void) {
    if (!selected) return;
    const id = selected;
    setActionError("");
    setActionNote("");
    try {
      const r = await api<{ note?: string | null }>(`/api/support/conversations/${id}`, { method: "POST", body });
      if (body.action === "unread") {
        keepUnread.current.add(id);
        if (narrow()) setPane("list");
      }
      if (r?.note && selectedRef.current === id) setActionNote(r.note);
      after?.();
      if (selectedRef.current === id) await loadDetail(id);
      loadList();
    } catch (e) {
      if (selectedRef.current === id) setActionError(e instanceof Error ? e.message : "Ação indisponível.");
    }
  }

  const sources = list?.sources || [];
  // Só fontes ativas contam: uma fonte por ligar não faz parecer que tudo está atualizado.
  const lastSync = sources.filter((s) => s.status === "active").map((s) => s.last_success_at).filter(Boolean).sort().at(-1) || null;
  const destination = useMemo(() => {
    if (!c) return "";
    const who = c.contact?.handle || c.contact?.name || c.contact?.email || "cliente";
    if (isZendesk) return `Resposta pública no ticket ${c.conversation.subject?.split(" · ")[0] || ""} — Zendesk notifica ${c.contact?.email || who}`;
    if (c.conversation.channel === "instagram") return `Instagram Direct · para ${who}`;
    if (c.conversation.channel === "facebook") return `Facebook Messenger · para ${who}`;
    return `${CHANNEL_LABEL[c.conversation.channel]} · por configurar`;
  }, [c, isZendesk]);

  return (
    <div className={`support-app show-${pane}`}>
      {flash.ok && <div role="status" className="notice ok-notice support-flash">{flash.ok}</div>}
      {flash.error && <div role="alert" className="notice error-notice support-flash">{flash.error}</div>}
      <div className="support-sources" aria-label="Estado dos canais">
        {sources.map((s) => (
          <span key={s.id} className={`source-chip ${s.status}`} title={s.last_error || s.status_detail || ""}>
            <b>{s.label}</b>
            {s.status === "not_configured" ? "Por configurar" : s.status === "active" ? `Sincronizado ${time(s.last_success_at)}` : s.status === "pending" ? s.status_detail || "A aguardar ligação" : s.status === "blocked" ? "Bloqueado" : "Erro"}
          </span>
        ))}
        <span className="support-sync">
          <small>Última sincronização: {time(lastSync)} · cada {poll < 120 ? `${poll} s` : `${Math.round(poll / 60)} min`} com o dashboard aberto</small>
          <button type="button" className="secondary-button" onClick={() => sync(true).then(loadList).then(() => { if (selected) return loadDetail(selected); })} disabled={syncing}>
            {syncing ? "A atualizar…" : "Atualizar"}
          </button>
        </span>
        {syncNote && <small className="support-sync-note" role="status">{syncNote}</small>}
      </div>
      {zendeskReady && !myZendesk.connected && (
        <form method="post" action="/api/support/zendesk/connect" className="notice support-connect">
          <span>
            <strong>Ligue a sua conta Zendesk</strong> para responder aos tickets com a sua autoria.
            {myZendesk.status === "reconnect" && " A ligação anterior expirou."}
          </span>
          <button type="submit" className="secondary-button">Ligar Zendesk</button>
        </form>
      )}

      <div className="support-grid">
        <section className="support-list" aria-label="Conversas">
          <div className="support-filters">
            <input type="search" placeholder="Procurar nome, email, texto ou n.º de ticket" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar conversas" />
            <div className="support-tabs" role="tablist">
              {FILTERS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
                  {label}
                  {list && <b>{list.counts[key]}</b>}
                </button>
              ))}
            </div>
            <div className="support-selects">
              <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal">
                <option value="">Todos os canais</option>
                {(Object.keys(CHANNEL_LABEL) as Channel[]).map((k) => <option key={k} value={k}>{CHANNEL_LABEL[k]}</option>)}
              </select>
              <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
                <option value="">Todos os estados</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          </div>
          {listError && <p className="support-error" role="alert">{listError}</p>}
          <ul>
            {list?.items.map((i) => (
              <li key={i.id}>
                <button type="button" className={`support-item${i.id === selected ? " selected" : ""}${i.unread ? " unread" : ""}`} onClick={() => open(i.id)}>
                  <span className="support-item-top">
                    <strong>{i.contact_name}</strong>
                    <time dateTime={i.last_message_at}>{time(i.last_message_at)}</time>
                  </span>
                  <span className="support-item-meta">
                    <span className={`channel-badge ${i.channel}`}>{CHANNEL_LABEL[i.channel]}</span>
                    <span className={`status-badge ${i.status}`}>{STATUS_LABEL[i.status]}</span>
                    {i.unread > 0 && <b className="unread-badge" aria-label={`${i.unread} não lidas`}>{i.unread}</b>}
                    {i.attention && <span className="attention" title="Envio falhado, incerto ou por concluir">!</span>}
                  </span>
                  <span className="support-item-preview">
                    {i.last_direction === "outbound" ? "Nós: " : ""}
                    {i.last_preview || i.subject || "Sem mensagens"}
                  </span>
                  <small>{i.assignee_name ? `Responsável: ${i.assignee_name}` : "Sem responsável"}</small>
                </button>
              </li>
            ))}
          </ul>
          {list && !list.items.length && <p className="support-empty">Sem conversas com estes filtros.</p>}
        </section>

        <section className="support-conversation" aria-label="Conversa">
          {!selected ? (
            <p className="support-empty">Escolha uma conversa.</p>
          ) : !c ? (
            <p className="support-empty">{detailError || "A carregar…"}</p>
          ) : (
            <>
              <header className="support-conv-head">
                <button type="button" className="support-back" onClick={() => setPane("list")} aria-label="Voltar à lista">←</button>
                <div>
                  <strong>{c.contact?.name || c.contact?.handle || c.contact?.email || "Cliente"}</strong>
                  <small>
                    {c.conversation.source_label}
                    {c.conversation.subject ? ` · ${c.conversation.subject}` : ""}
                  </small>
                </div>
                <span className={`status-badge ${c.conversation.status}`}>{STATUS_LABEL[c.conversation.status]}</span>
                <button type="button" className="secondary-button support-info-toggle" onClick={() => setPane("info")}>Cliente</button>
              </header>
              {c.presence.length > 0 && (
                <div className="notice support-presence" role="status">
                  {c.presence.map((p) => `${p.name} ${p.composing ? "está a escrever nesta conversa" : "tem esta conversa aberta"}`).join(" · ")}.
                </div>
              )}
              {detailError && <p className="support-error" role="alert">{detailError}</p>}
              {actionError && <p className="support-error" role="alert">{actionError}</p>}
              {actionNote && <p className="support-note" role="status">{actionNote}</p>}
              <div className="support-messages" ref={messagesBox}>
                {c.messages.map((m) => (
                  <article key={m.id} className={`msg ${m.kind}`}>
                    <header>
                      <strong>{m.kind === "note" ? `Nota interna · ${m.author_name || "Equipa"}` : m.author_name || (m.kind === "inbound" ? "Cliente" : "Loja do Ouro")}</strong>
                      <time dateTime={m.created_at}>{time(m.created_at)}</time>
                    </header>
                    {m.deleted ? <p className="msg-deleted">Mensagem apagada pelo cliente.</p> : m.body && <p>{m.body}</p>}
                    {m.attachments.length > 0 && (
                      <div className="msg-attachments">
                        {m.attachments.map((a, i) => {
                          const href = `/api/support/attachments?${new URLSearchParams({ c: c.conversation.id, m: m.id, i: String(i) })}`;
                          return a.type?.startsWith("image/") ? (
                            <a key={i} href={href} target="_blank" rel="noopener noreferrer"><img src={href} alt={a.name} loading="lazy" /></a>
                          ) : (
                            <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="attachment-link">📎 {a.name}</a>
                          );
                        })}
                      </div>
                    )}
                    {m.kind === "note" && <small className="note-flag">Visível só para a equipa · nunca enviada ao cliente</small>}
                    {m.delivery && (
                      <footer className={`delivery ${m.delivery}`} title={m.delivery_detail || ""}>
                        {DELIVERY_LABEL[m.delivery]}
                        {m.delivery_detail && m.delivery !== "accepted" ? ` — ${m.delivery_detail}` : ""}
                        {(m.delivery === "uncertain" || m.delivery === "sending") && (
                          <>
                            <button type="button" onClick={() => act({ action: "verify", messageId: m.id })}>Verificar</button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm("Confirma que verificou na plataforma e a mensagem NÃO foi enviada? O texto volta ao rascunho."))
                                  act({ action: "not_sent", messageId: m.id }, () => {
                                    setMode(m.kind === "note" ? "note" : "reply");
                                    setDraft(selected, m.kind === "note" ? "note" : "reply", m.body);
                                  });
                              }}
                            >
                              Não foi enviada
                            </button>
                          </>
                        )}
                        {m.delivery === "failed" && m.author_user_id === c.me && (
                          <button type="button" onClick={() => { setMode(m.kind === "note" ? "note" : "reply"); setText(m.body); }}>Copiar para o rascunho</button>
                        )}
                      </footer>
                    )}
                  </article>
                ))}
                {!c.messages.length && <p className="support-empty">Sem mensagens sincronizadas.</p>}
              </div>

              <div className={`support-composer ${mode}`}>
                <div className="composer-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={mode === "reply"} className={mode === "reply" ? "active" : ""} onClick={() => setMode("reply")}>Responder ao cliente</button>
                  <button type="button" role="tab" aria-selected={mode === "note"} className={mode === "note" ? "active" : ""} onClick={() => setMode("note")}>Nota interna</button>
                </div>
                <p className="composer-target">
                  {mode === "reply" ? <>Envia por: <strong>{destination}</strong></> : <>Nota interna — <strong>visível só para a equipa</strong>{isZendesk ? " (comentário privado no Zendesk)" : ""}.</>}
                </p>
                {(mode === "reply" ? replyBlocked : noteBlocked) ? (
                  <div className="composer-blocked">
                    {mode === "reply" ? replyBlocked : noteBlocked}
                    {isZendesk && !me?.zendesk && zendeskReady && (
                      <form method="post" action="/api/support/zendesk/connect"><button type="submit" className="secondary-button">Ligar Zendesk</button></form>
                    )}
                  </div>
                ) : (
                  <>
                    <textarea
                      value={text}
                      onChange={(e) => typed(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
                      rows={4}
                      maxLength={20000}
                      placeholder={mode === "reply" ? "Escreva a resposta ao cliente…" : "Nota para a equipa (o cliente não a vê)…"}
                      aria-label={mode === "reply" ? "Resposta ao cliente" : "Nota interna"}
                    />
                    <div className="composer-actions">
                      {sendError && <span className="support-error" role="alert">{sendError}</span>}
                      <small>Ctrl+Enter para enviar</small>
                      <button type="button" onClick={send} disabled={sending || !text.trim()}>
                        {sending ? "A enviar…" : mode === "reply" ? "Enviar ao cliente" : "Guardar nota"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="support-info" aria-label="Informação do cliente">
          {c ? (
            <CustomerPanel
              key={c.conversation.id}
              d={c}
              zendeskSubdomain={zendeskSubdomain}
              actionError={actionError}
              onBack={() => setPane("conversation")}
              onAct={act}
              onReload={() => loadDetail(c.conversation.id)}
              onOpen={(id) => open(id)}
            />
          ) : (
            <p className="support-empty">Informação do cliente.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function CustomerPanel({
  d, zendeskSubdomain, actionError, onBack, onAct, onReload, onOpen,
}: {
  d: Detail;
  zendeskSubdomain: string;
  actionError: string;
  onBack: () => void;
  onAct: (body: Record<string, unknown>, after?: () => void) => Promise<void>;
  onReload: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const conv = d.conversation;
  const contact = d.contact;
  const [orders, setOrders] = useState<Orders | null>(null);
  const [email, setEmail] = useState(contact?.linked_email || "");
  const [linkError, setLinkError] = useState("");
  const isZendesk = conv.platform === "zendesk";
  const contactId = contact?.id, linkedEmail = contact?.linked_email, contactEmail = contact?.email;
  const loadOrders = useCallback(() => {
    if (!contactId) return;
    api<Orders>(`/api/support/contacts/${contactId}?conversa=${conv.id}`)
      .then(setOrders)
      .catch((e) => setOrders({ email: null, orders: [], error: e instanceof Error ? e.message : "Indisponível." }));
    // linkedEmail/contactEmail: procurar de novo quando a associação muda.
  }, [contactId, linkedEmail, contactEmail, conv.id]);
  useEffect(loadOrders, [loadOrders]);

  async function link(value: string) {
    if (!contact) return;
    setLinkError("");
    try {
      await api(`/api/support/contacts/${contact.id}`, { method: "POST", body: { email: value } });
      setOrders(null);
      loadOrders();
      await onReload();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Não foi possível associar.");
    }
  }

  // No Zendesk só se atribui a quem ligou a conta Zendesk (o responsável é o agente Zendesk).
  const assignable = d.users.filter((u) => !isZendesk || u.zendesk || u.id === conv.assignee_id);
  const current = conv.assignee_id && !assignable.some((u) => u.id === conv.assignee_id) ? conv.assignee_id : null;
  return (
    <div className="customer-panel">
      <button type="button" className="support-back" onClick={onBack}>← Conversa</button>
      <section>
        <span className="eyebrow">Atendimento</span>
        <label>
          Estado
          <select value={conv.status} onChange={(e) => onAct({ action: "update", status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s} disabled={isZendesk && s === "novo" && conv.status !== "novo"}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label>
          Responsável
          <select value={conv.assignee_id || ""} onChange={(e) => onAct({ action: "update", assigneeId: e.target.value || null })}>
            <option value="">{conv.external_assignee_name && !conv.assignee_id ? `${conv.external_assignee_name} (Zendesk)` : "Sem responsável"}</option>
            {current && <option value={current}>{conv.assignee_name || "Responsável atual"}</option>}
            {assignable.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.me ? " (eu)" : ""}{isZendesk && !u.zendesk ? " (Zendesk por religar)" : ""}</option>
            ))}
          </select>
        </label>
        {isZendesk && <small className="muted">Estado e responsável são gravados no Zendesk (fonte de verdade) com a sua conta. Estado no Zendesk: {conv.platform_status || "—"}.</small>}
        {!isZendesk && <small className="muted">Estado e responsável pertencem ao dashboard; uma nova mensagem do cliente reabre uma conversa resolvida.</small>}
        <div className="customer-actions">
          <button type="button" className="secondary-button" onClick={() => onAct({ action: "unread" })}>Marcar como não lida</button>
          {isZendesk && (
            <a className="outline-button" href={`https://${zendeskSubdomain}.zendesk.com/agent/tickets/${encodeURIComponent(conv.external_id)}`} target="_blank" rel="noopener noreferrer">Abrir no Zendesk</a>
          )}
        </div>
        {actionError && <p className="support-error" role="alert">{actionError}</p>}
      </section>

      <section>
        <span className="eyebrow">Contactos conhecidos</span>
        <dl>
          <dt>Nome</dt><dd>{contact?.name || "—"}</dd>
          {contact?.handle && contact.handle !== contact.name && (<><dt>Perfil</dt><dd>{contact.handle}</dd></>)}
          <dt>Email</dt><dd>{contact?.email || "—"}</dd>
          <dt>Telefone</dt><dd>{contact?.phone || "—"}</dd>
          <dt>Canal</dt><dd>{conv.source_label}</dd>
        </dl>
      </section>

      <section>
        <span className="eyebrow">Cliente da loja online</span>
        <p className="muted small">A associação é manual, por email. Nunca se juntam clientes pelo nome.</p>
        <form className="link-form" onSubmit={(e) => { e.preventDefault(); link(email); }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={contact?.email || "email do cliente na loja"} aria-label="Email do cliente na loja online" />
          <button type="submit" className="secondary-button">Associar</button>
          {contact?.linked_email && <button type="button" className="secondary-button" onClick={() => { setEmail(""); link(""); }}>Remover</button>}
        </form>
        {contact?.linked_email && <small className="muted">Associado por {contact.linked_by_name || "—"} em {time(contact.linked_at)}.</small>}
        {linkError && <p className="support-error" role="alert">{linkError}</p>}
        {d.related.length > 0 && (
          <div className="related">
            <small className="muted">Sugestões (mesmo email ou telefone noutros canais) — conversas mantêm-se separadas:</small>
            {d.related.map((r) => (
              <button key={r.contact_id} type="button" className="secondary-button" disabled={!r.conversation_id} onClick={() => r.conversation_id && onOpen(r.conversation_id)}>
                {CHANNEL_LABEL[r.channel]} · {r.name || r.email || r.phone}
              </button>
            ))}
          </div>
        )}
        <div className="orders">
          {!orders ? (
            <small className="muted">A procurar encomendas…</small>
          ) : orders.error ? (
            <p className="support-error">Encomendas indisponíveis: {orders.error}</p>
          ) : orders.note ? (
            <small className="muted">{orders.note}</small>
          ) : orders.orders.length ? (
            <>
              <small className="muted">Encomendas Shopify de {orders.email}{orders.linked ? "" : " (email do contacto, não confirmado)"}:</small>
              <ul>
                {orders.orders.map((o) => (
                  <li key={o.name}>
                    <a href={o.admin_url} target="_blank" rel="noopener noreferrer"><strong>{o.name}</strong></a> · {time(o.created_at)} ·{" "}
                    {o.total !== null ? new Intl.NumberFormat("pt-PT", { style: "currency", currency: o.currency || "EUR" }).format(o.total) : "—"}
                    <small className="muted block">{[o.cancelled ? "Cancelada" : null, o.financial, o.fulfillment].filter(Boolean).join(" · ")}</small>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <small className="muted">Sem encomendas Shopify para {orders.email}.</small>
          )}
        </div>
      </section>

      <section>
        <span className="eyebrow">Registo</span>
        <ul className="audit">
          {d.audit.map((a, i) => (
            <li key={i}>
              <small>{time(a.created_at)}</small> {a.actor} {AUDIT[a.action] || a.action}
              {a.action === "status" && typeof a.details.to === "string" && ` → ${STATUS_LABEL[a.details.to as Status] || a.details.to}`}
              {a.action === "assign" && typeof a.details.to_name === "string" && ` → ${a.details.to_name}`}
            </li>
          ))}
          {!d.audit.length && <li className="muted">Sem ações registadas.</li>}
        </ul>
      </section>
    </div>
  );
}
