"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiPanel } from "./ai-panel";
import { AttachmentViewer, sizeLabel, type ViewerItem } from "./attachment-viewer";
import { CatalogPicker } from "./catalog-picker";
import { EmojiPicker } from "./emoji-picker";
import { emojiAfter, insertAt } from "@/lib/support/emoji";
import {
  canChangeStatus,
  canReply,
  metaUnreachable,
  canTransfer,
  CHANNEL_LABEL,
  gmailThreadLink,
  DELIVERY_LABEL,
  LOCALE_LABEL,
  orderNumbersIn,
  previewKind,
  SITE_BRAND,
  siteLink,
  siteRootUrl,
  STATUSES,
  STATUS_LABEL,
  visitorSite,
  type Channel,
  type Delivery,
  type Kind,
  type Ownership,
  type Status,
} from "@/lib/support/rules";
import { COMMENT_MAX_CHARS, isCommentChannel, POST_KIND_LABEL, POST_KIND_TITLE, publicReplyRisks, type CommentChannel, type PostKind } from "@/lib/support/comment-rules";

type Source = { id: string; platform: string; channel: Channel; label: string; status: string; status_detail: string | null; last_success_at: string | null; last_attempt_at: string | null; last_error: string | null };
type Item = {
  id: string; channel: Channel; subject: string | null; status: Status; contact_name: string; contact_handle: string | null;
  assignee_id: string | null; assignee_name: string | null; last_message_at: string; last_preview: string | null; last_direction: Kind | null;
  unread: number; attention: boolean; auto?: boolean;
};
type AutoCounts = { support: number; thanks: number; email: number };
type List = {
  items: Item[]; counts: { all: number; mine: number; unassigned: number; unread: number; auto?: number }; sources: Source[]; poll_seconds: number;
  automatic?: { today: AutoCounts; week: AutoCounts };
};
type Message = {
  id: string; kind: Kind; author_name: string | null; author_user_id: string | null; body: string;
  attachments: { name: string; type: string | null; size: number | null; ref: string; inline?: boolean }[];
  created_at: string; inserted_at: string; deleted: boolean; delivery: Delivery | null; delivery_detail: string | null; external: boolean;
};
type User = { id: string; name: string; me: boolean; zendesk: boolean; zendesk_name: string | null; zendesk_status: string | null };
// Publicação comentada (só nos comentários): as imagens chegam pelo proxy do dashboard, pela posição.
type Post = {
  kind: PostKind; product_type: string | null; link: string | null; caption: string | null; media: { index: number; kind: "image" | "video" }[];
  comment_count: number | null; reaction_count: number | null; owner_name: string | null; seen_at: string;
};
type Detail = {
  conversation: {
    id: string; source_id: string; channel: Channel; account: string | null; external_id: string; subject: string | null; status: Status; platform_status: string | null;
    assignee_id: string | null; assignee_name: string | null; external_assignee_id: string | null; external_assignee_name: string | null;
    via: string | null; platform: string; source_label: string; source_status: string; read_at: string | null; last_inbound_at: string | null;
    last_inbound_inserted_at: string | null;
    // Comentários: respostas públicas ligadas nesta conversa (a BD confirma de novo ao publicar).
    public_replies?: boolean | null;
  };
  contact: { id: string; name: string | null; email: string | null; phone: string | null; handle: string | null; linked_email: string | null; linked_by_name: string | null; linked_at: string | null; claimed_email?: string | null } | null;
  related: { contact_id: string; channel: Channel; name: string | null; email: string | null; phone: string | null; conversation_id: string | null }[];
  post?: Post | null;
  messages: Message[];
  presence: { user_id: string; name: string; composing: boolean }[];
  audit: { action: string; details: Record<string, unknown>; created_at: string; actor: string }[];
  users: User[];
  me: string;
  super: boolean;
};
type AuditEntry = Detail["audit"][number];
type ShopOrder = {
  name: string; created_at: string; cancelled: boolean; financial: string | null; fulfillment: string | null; total: number | null; currency: string | null;
  admin_url: string; status_url?: string | null; phone?: string | null;
  items?: { name: string; variant: string | null; quantity: number; sku: string | null; price: number | null; currency: string | null; image: string | null }[];
};
type Orders = { email: string | null; orders: ShopOrder[]; error?: string; note?: string; linked?: boolean; phone_note?: string | null };
type OrderLookup = { number: string; loading: boolean; order?: ShopOrder | null; belongs?: boolean; phoneNote?: string | null; error?: string };

const money = (v: number | null | undefined, currency: string | null | undefined) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: currency || "EUR" }).format(v);

function OrderRow({ o, open }: { o: ShopOrder; open?: boolean }) {
  return (
    <li>
      <details open={open}>
        <summary>
          <strong>{o.name}</strong> · {time(o.created_at)} · {money(o.total, o.currency)}
          <small className="muted block">{[o.cancelled ? "Cancelada" : null, o.financial, o.fulfillment].filter(Boolean).join(" · ")}</small>
        </summary>
        {o.items && o.items.length > 0 && (
          <ul className="order-items">
            {o.items.map((it, i) => (
              <li key={i}>
                {it.image ? <img src={it.image} alt="" loading="lazy" /> : <span className="order-noimg" aria-hidden="true" />}
                <span>
                  {it.quantity} × {it.name}{it.variant ? ` — ${it.variant}` : ""}
                  {it.sku && <small className="muted block">Ref. {it.sku}</small>}
                </span>
                <b>{money(it.price, it.currency)}</b>
              </li>
            ))}
          </ul>
        )}
        <div className="order-links">
          <a href={o.admin_url} target="_blank" rel="noopener noreferrer">Abrir na Shopify</a>
          {o.status_url && <a href={o.status_url} target="_blank" rel="noopener noreferrer">Página da encomenda (cliente)</a>}
        </div>
      </details>
    </li>
  );
}

const FILTERS = [
  ["all", "Todas"],
  ["mine", "Minhas"],
  ["unassigned", "Sem responsável"],
  ["unread", "Não lidas"],
  ["auto", "Automáticas"],
] as const;

// Resumo das respostas automáticas enviadas (redes sociais e email).
function autoSummary(c: AutoCounts) {
  const parts = [
    c.thanks && `${c.thanks} agradecimento${c.thanks === 1 ? "" : "s"} a reações`,
    c.support && `${c.support} resposta${c.support === 1 ? "" : "s"} automática${c.support === 1 ? "" : "s"} a pedidos`,
    c.email && `${c.email} email${c.email === 1 ? "" : "s"} "recebemos o seu email"`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "nenhuma";
}

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
const SOURCE_NAME: Record<string, string> = {
  zendesk: "Zendesk", gmail: "Email", "metricool-facebook": "Facebook", "metricool-instagram": "Instagram",
  "metricool-facebook-comments": "comentários do Facebook", "metricool-instagram-comments": "comentários do Instagram",
};

const AUDIT: Record<string, string> = {
  status: "mudou o estado", assign: "atribuiu", reply: "respondeu", note: "acrescentou uma nota", reopen: "reabriu (nova mensagem do cliente)",
  link_customer: "associou o cliente", "zendesk.connect": "ligou o Zendesk", "zendesk.disconnect": "desligou o Zendesk",
  "gmail.connect": "ligou a caixa Gmail", "gmail.disconnect": "desligou a caixa Gmail", "email.settings": "alterou as definições do email",
  "social.settings": "alterou as respostas automáticas das redes sociais",
};

// Acontecimentos mostrados na própria conversa: mudanças de responsável, o fim da conversa pelo cliente e a
// resposta automática do email.
const THREAD_EVENTS = new Set(["assign", "visitor_end", "email.autoreply", "social.autoreply"]);

// Acontecimento por extenso (na conversa e no registo).
function assignText(a: AuditEntry) {
  if (a.action === "visitor_end")
    return `O cliente terminou a conversa no site${a.details.transcript ? " e pediu uma cópia por email" : ""}`;
  if (a.action === "social.autoreply") {
    const what = a.details.kind === "thanks" ? "Agradecimento automático à reação" : "Resposta automática ao cliente";
    return a.details.outcome === "uncertain" ? `${what}: sem confirmação da Metricool (pode não ter chegado)` : `${what} enviada`;
  }
  if (a.action === "email.autoreply")
    return `Resposta automática “recebemos o seu email” enviada${typeof a.details.email === "string" ? ` para ${a.details.email}` : ""}`;
  const to = typeof a.details.to_name === "string" ? a.details.to_name : "outra pessoa";
  switch (a.details.kind) {
    case "claim":
      return `${to} ficou responsável pela conversa`;
    case "transfer":
      return `${a.actor} transferiu a conversa para ${to}${a.details.notice ? " (o cliente viu o aviso no chat)" : ""}`;
    case "release":
      return `${a.actor} deixou a conversa sem responsável`;
    default:
      return a.details.to ? `${a.actor} atribuiu a conversa a ${to}` : `${a.actor} retirou o responsável`;
  }
}

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

type Pending = { id: string; name: string; type: string; size: number; preview: string | null };
const dropPreview = (u: Pending) => {
  if (u.preview?.startsWith("blob:")) URL.revokeObjectURL(u.preview);
};

// As fotografias do telemóvel têm muitas vezes 5–10 MB; o servidor aceita até 4 MB por pedido. As imagens
// são reduzidas aqui (máx. 2048 px, JPEG), o que também retira os dados de localização (EXIF).
async function prepareFile(file: File): Promise<Blob> {
  if (file.type === "application/pdf") {
    if (file.size > 4 * 1024 * 1024) throw new Error("PDF demasiado grande (máximo 4 MB).");
    return file;
  }
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) throw new Error("Só imagens (JPEG, PNG, WebP) ou PDF.");
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Não foi possível ler esta imagem. Experimente JPEG ou PNG.");
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (blob && blob.size <= 3.5 * 1024 * 1024) return blob;
  }
  throw new Error("Imagem demasiado grande mesmo depois de reduzida.");
}

async function uploadBlob(conversation: string, name: string, blob: Blob | null, product?: string) {
  const q = new URLSearchParams({ conversa: conversation, ...(product ? { produto: product, nome: name } : {}) });
  const r = await fetch(`/api/support/uploads?${q}`, {
    method: "POST",
    headers: { "x-support-upload": "1", ...(blob ? { "Content-Type": blob.type || "application/octet-stream", "x-file-name": encodeURIComponent(name) } : {}) },
    body: blob ?? undefined,
  });
  const isJson = (r.headers.get("content-type") || "").includes("application/json");
  const data = isJson ? await r.json() : null;
  if (!r.ok || !data) throw new Error(data?.error || `Carregamento recusado (HTTP ${r.status}).`);
  return data as { id: string; name: string; type: string; size: number };
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
// Até 1190 px a coluna do cliente/IA ocupa o lugar da conversa (não aparecem lado a lado).
const sideOverlays = () => typeof window !== "undefined" && window.matchMedia("(max-width: 1190px)").matches;

export function SupportInbox({
  zendeskSubdomain,
  zendeskReady,
  myZendesk,
  flash,
  initialConversation = null,
}: {
  zendeskSubdomain: string;
  zendeskReady: boolean;
  myZendesk: { connected: boolean; name: string | null; status: string | null };
  flash: { ok?: string; error?: string };
  // Ligação direta (ex.: email de transferência): /apoio?conversa=<id>.
  initialConversation?: string | null;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<List | null>(null);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string | null>(initialConversation);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [pane, setPane] = useState<"list" | "conversation" | "info">(initialConversation ? "conversation" : "list");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [drafts, setDrafts] = useState<Record<string, { reply: string; note: string }>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
  // O aviso "emoji não inserido" deixa de valer quando o texto muda ou se troca de conversa ou separador.
  const clearEmojiLimit = () => setSendError((e) => (/^Limite de \d+ caracteres atingido: o emoji/.test(e) ? "" : e));
  const [actionError, setActionError] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const composerText = useRef<HTMLTextAreaElement>(null);
  // Onde estava o cursor da caixa de texto (por conversa e separador), para o emoji entrar nesse lugar.
  const caret = useRef<{ slot: string; start: number; end: number; text: string } | null>(null);
  // Outra conversa ou outro separador: a seleção guardada já não está à vista, o emoji vai para o fim,
  // e o aviso de limite de um emoji já não se aplica.
  useEffect(() => {
    caret.current = null;
    clearEmojiLimit();
  }, [selected, mode]);
  const [infoTab, setInfoTab] = useState<"cliente" | "ia">("cliente");
  const [aiRequest, setAiRequest] = useState<{ n: number } | null>(null);
  // Miniaturas que não carregaram (ex.: endereço da Meta expirado): mostram-se como aviso, nunca vazias.
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  // Cartão da publicação (comentários): aberto por omissão só em ecrãs grandes; a escolha vale para todas as conversas.
  const [postOpen, setPostOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1191px) and (min-height: 900px)").matches);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewerOpener = useRef<HTMLElement | null>(null);
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
  useEffect(() => {
    const saved = loadStored("ldo-support-uploads") as Record<string, Pending[]>;
    setPending(Object.fromEntries(Object.entries(saved).map(([k, list]) => [k, (list || []).map((u) => ({ ...u, preview: null }))])));
  }, []);
  useEffect(() => store("ldo-support-uploads", Object.fromEntries(Object.entries(pending).map(([k, list]) => [k, list.map((u) => ({ ...u, preview: null }))]))), [pending]);
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
        const name = (x: { source: string }) => SOURCE_NAME[x.source] || x.source;
        const failed = r.results.filter((x) => x.ran && x.ok === false);
        const waiting = r.results.filter((x) => !x.ran && x.reason && x.reason !== "not_due" && x.reason !== "disabled");
        setSyncNote([
          failed.length ? `Falha em ${failed.map(name).join(", ")}; as restantes fontes foram atualizadas.` : "Atualizado.",
          waiting.length ? `Não correu: ${waiting.map((x) => `${name(x)} (${REASON[x.reason!] || x.reason})`).join(", ")}.` : "",
        ].filter(Boolean).join(" "));
      }
      // Importação longa: a passagem seguinte pode correr logo (o servidor só aceita após 15 s).
      // (Os comentários continuam sozinhos na passagem seguinte, com o intervalo mínimo da fonte.)
      if (r.results.some((x) => x.more && !x.source.endsWith("-comments"))) {
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

  // Chat do site: o que o cliente está a fazer na loja e em que site e língua (painel do cliente, cabeçalho, destino
  // da resposta). Enviado pelo browser do cliente (não confirmado); atualiza a cada 15 s com a conversa aberta.
  const [visitor, setVisitor] = useState<SiteVisitorState | null>(null);
  const siteChat = detail?.conversation.id === selected && detail?.conversation.channel === "site" ? selected : null;
  useEffect(() => {
    if (!siteChat) return;
    let alive = true;
    const load = () =>
      api<{ visitor: SiteVisitorInfo | null }>(`/api/support/site-visitor?conversa=${siteChat}`)
        .then((r) => alive && setVisitor({ id: siteChat, info: r.visitor, error: "" }))
        .catch((e) => alive && setVisitor((v) => ({ id: siteChat, info: v?.id === siteChat ? v.info : undefined, error: e instanceof Error ? e.message : "Indisponível." })));
    load();
    const t = setInterval(() => visible() && load(), 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [siteChat]);

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
      setShowCatalog(false);
      setShowEmoji(false);
      setAiRequest(null);
    }
    keepUnread.current.delete(id);
    setSelected(id);
    setPane("conversation");
  };

  const c = detail?.conversation.id === selected ? detail : null;
  // Chat do site: visitante desta conversa e marca e língua do site (sem dados: Loja do Ouro, sem destaque).
  const siteVisitor = c?.conversation.channel === "site" && visitor?.id === c.conversation.id ? visitor : null;
  // Sem os dados do visitante (a carregar ou falhou), a conta da conversa já diz se é da Gold Store Premium.
  const site = c?.conversation.channel === "site" && (siteVisitor?.info || c.conversation.account === "goldstorepremium.com")
    ? visitorSite(siteVisitor?.info, c.conversation.account)
    : null;
  const brand = SITE_BRAND[site?.site || "ldo"].brand;
  const isZendesk = c?.conversation.platform === "zendesk";
  // Zendesk desligado no dashboard: os tickets ficam como histórico (notas, estado e responsável só aqui).
  const zendeskOff = isZendesk && c?.conversation.source_status === "disabled";
  const zendeskLive = isZendesk && !zendeskOff;
  const isWhatsapp = c?.conversation.platform === "whatsapp";
  const isGmail = c?.conversation.platform === "gmail";
  // Comentários das publicações: a resposta fica PÚBLICA por baixo da publicação.
  const commentChannel: CommentChannel | null = c && isCommentChannel(c.conversation.channel) ? c.conversation.channel : null;
  const isComment = !!commentChannel;
  const publicReply = isComment && mode === "reply";
  const me = c?.users.find((u) => u.me);
  const draft = (selected && drafts[selected]) || { reply: "", note: "" };
  const text = mode === "reply" ? draft.reply : draft.note;
  const setDraft = (id: string, which: "reply" | "note", v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] || { reply: "", note: "" }), [which]: v } }));
  const setText = (v: string) => {
    if (selected) setDraft(selected, mode, v);
  };
  // Só a escrita da própria pessoa conta como "a escrever" (e só nesta conversa). Notas internas não contam:
  // no chat do site o cliente vê "A equipa está a escrever…".
  const typed = (v: string) => {
    if (!selected) return;
    clearEmojiLimit();
    if (mode === "reply") lastTyped.current = { id: selected, at: Date.now() };
    setText(v);
  };
  const sending = sendingId === selected;
  const slotOf = (id: string, m: "reply" | "note") => `${id}:${m}`;
  const pendingHere = (selected && pending[slotOf(selected, mode)]) || [];
  // Zendesk: até 5 anexos (imagens ou PDF). Email: até 5, só em respostas. Facebook/Instagram: uma imagem por mensagem, só em respostas.
  // Comentários das publicações: só texto.
  const maxAttachments = !c || isComment ? 0 : zendeskLive || (isGmail && mode === "reply") ? 5 : c.conversation.platform === "metricool" && mode === "reply" ? 1 : 0;
  const maxChars = publicReply && commentChannel ? COMMENT_MAX_CHARS[commentChannel] : 20000;
  // Texto posto por código (proposta da IA, rascunho guardado) pode passar o limite: não se publica assim.
  const overLimit = publicReply && text.length > maxChars;
  const attachHint = !c ? "" : isWhatsapp ? "WhatsApp por configurar." : isComment ? "Os comentários levam só texto (sem anexos)." : c.conversation.platform === "site" ? "O chat do site ainda não aceita anexos. Formatação: linhas com \"- \" viram lista, **negrito**; com 🛍 Produto o cliente vê um cartão com foto e preço." : maxAttachments === 0 ? "As notas internas deste canal não levam anexos." : isZendesk || isGmail ? "Até 5 imagens ou PDF." : "Uma imagem (JPEG/PNG) por mensagem.";

  async function addFiles(files: FileList | File[]) {
    if (!selected) return;
    if (uploadingRef.current) {
      setSendError("Aguarde que o anexo anterior termine de carregar.");
      return;
    }
    const id = selected;
    const slot = slotOf(id, mode);
    const room = maxAttachments - ((pending[slot] || []).length);
    const list = [...files].slice(0, Math.max(0, room));
    if (!list.length) {
      setSendError(maxAttachments ? `No máximo ${maxAttachments} anexo(s) nesta mensagem.` : attachHint);
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    setSendError("");
    try {
      for (const f of list) {
        if (f.type === "application/pdf" && !zendeskLive && !isGmail) throw new Error("PDF só no email e nos tickets Zendesk.");
        const blob = await prepareFile(f);
        const up = await uploadBlob(id, f.name, blob);
        const preview = up.type.startsWith("image/") ? URL.createObjectURL(blob) : null;
        setPending((p) => ({ ...p, [slot]: [...(p[slot] || []), { ...up, preview }] }));
      }
    } catch (e) {
      if (selectedRef.current === id) setSendError(e instanceof Error ? e.message : "Não foi possível anexar.");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  const keepCaret = (el: HTMLTextAreaElement) => {
    if (selected) caret.current = { slot: slotOf(selected, mode), start: el.selectionStart, end: el.selectionEnd, text: el.value };
  };

  function insertEmoji(char: string, viaMouse: boolean) {
    if (!selected) return;
    const slot = slotOf(selected, mode);
    const at = caret.current && caret.current.slot === slot && caret.current.text === text ? caret.current : { start: text.length, end: text.length };
    const next = insertAt(text, at.start, at.end, emojiAfter(text.slice(0, Math.min(at.start, at.end)), char));
    if (next.text.length > maxChars) {
      setSendError(`Limite de ${maxChars} caracteres atingido: o emoji não foi inserido.`);
      return;
    }
    typed(next.text);
    caret.current = { slot, start: next.caret, end: next.caret, text: next.text };
    // Escolha com o rato: o cursor volta ao texto logo a seguir ao emoji. Com o teclado o foco fica no painel,
    // e no telemóvel não se abre o teclado; se a caixa de texto já tinha o foco (iPhone), o cursor também lá fica.
    requestAnimationFrame(() => {
      const el = composerText.current;
      if (!el || el.value !== next.text) return;
      if (viaMouse) el.focus({ preventScroll: true });
      if (viaMouse || document.activeElement === el) el.setSelectionRange(next.caret, next.caret);
    });
  }
  const closeEmoji = () => {
    setShowEmoji(false);
    // Com rato e teclado, volta a escrever onde estava; no telemóvel não se abre o teclado.
    const el = composerText.current, at = caret.current;
    if (!el || !selected || !window.matchMedia("(pointer: fine)").matches) return;
    el.focus({ preventScroll: true });
    if (at && at.slot === slotOf(selected, mode) && at.text === el.value) el.setSelectionRange(at.start, at.end);
  };

  async function insertCatalog(item: { title: string; url: string; image: string | null; photo: string | null; price: string | null }, withImage: boolean) {
    if (!selected) return;
    const id = selected;
    const slot = slotOf(id, mode);
    // Chat do site: a ligação abre no site e na língua do cliente (a do catálogo é a da Loja do Ouro, em português).
    const url = site ? siteLink(item.url, site.site, site.locale) : item.url;
    // Gold Store Premium: produto só com a ligação. O cartão no chat mostra o nome, a foto e o preço do próprio site,
    // na língua do cliente (o preço do catálogo é o de Portugal e o nome, em português, ficava repetido por cima).
    const gsp = site?.site === "gsp";
    const line = gsp && item.price ? url : `${item.title}${!gsp && item.price ? ` — ${item.price}` : ""}\n${url}`;
    const current = drafts[id]?.[mode] || "";
    setDraft(id, mode, current ? `${current.replace(/\s+$/, "")}\n\n${line}` : line);
    setShowCatalog(false);
    if (withImage && item.photo && maxAttachments > (pending[slot] || []).length && !uploadingRef.current) {
      uploadingRef.current = true;
      setUploading(true);
      try {
        // Fotografia já reduzida pela Shopify (JPEG até 1600 px).
        const up = await uploadBlob(id, item.title.slice(0, 80), null, item.photo);
        setPending((p) => ({ ...p, [slot]: [...(p[slot] || []), { ...up, preview: item.image }] }));
      } catch (e) {
        if (selectedRef.current === id) setSendError(e instanceof Error ? e.message : "Não foi possível anexar a foto do produto.");
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    }
  }

  // Responsável: só ele responde ao cliente (a BD confirma). Os colegas podem deixar notas internas.
  const own: Ownership | null = c ? { assigneeId: c.conversation.assignee_id, me: c.me, isSuper: Boolean(c.super) } : null;
  const ownerName = c?.conversation.assignee_name || "outra pessoa";
  // Mensagem privada que a Meta recusou com #551 depois da última mensagem do cliente: reenviar não resolve.
  const unreachable = !!c && c.conversation.platform === "metricool" && !isComment && metaUnreachable(c.messages);
  // O aviso de uma recusa #551 deixa de valer noutra conversa ou separador, ou quando a caixa bloqueia (o aviso
  // fixo explica) ou desbloqueia (a pessoa voltou a estar contactável).
  useEffect(() => {
    setSendError((e) => (/\(Meta #551\)/.test(e) ? "" : e));
  }, [selected, mode, unreachable]);
  const replyBlocked = !c
    ? "A carregar…"
    : isWhatsapp
      ? "WhatsApp por configurar: ainda não é possível responder por este canal."
      : zendeskOff
        ? "O Zendesk foi desligado do dashboard: este ticket fica como histórico. Responda no Zendesk (separador Cliente → Abrir no Zendesk). Pode deixar uma nota interna."
      : own && !canReply(own)
        ? `Esta conversa está com ${ownerName}: só essa pessoa responde ao cliente. ${c.super ? "Para responder, transfira-a para si (Cliente → Atendimento)." : "Se precisar de a assumir, peça-lhe que a transfira."} Pode deixar uma nota interna.`
        : zendeskLive && !me?.zendesk
          ? "Ligue a sua conta Zendesk para responder com a sua autoria."
          : c.conversation.source_status === "blocked" && isGmail
            ? "A caixa Gmail do apoio precisa de ser ligada de novo (Configuração do apoio → Email (Gmail))."
            : c.conversation.source_status === "blocked" && !isZendesk
              ? "A Metricool recusou o acesso a esta caixa de entrada. Ver a configuração do apoio."
              : unreachable
                ? `O ${c.conversation.channel === "instagram" ? "Instagram" : "Messenger"} não aceita mensagens nossas para esta pessoa (Meta #551): pode ter bloqueado a página, deixado de aceitar as nossas mensagens ou desativado a conta. Só será possível responder quando o cliente voltar a escrever. Se deixou telefone ou email na conversa, contacte-o por aí; pode deixar uma nota interna.`
              : isComment && !c.conversation.public_replies
                ? "As respostas públicas aos comentários ainda estão desligadas: falta validar a publicação num comentário de teste. Responda na própria publicação, se for preciso, ou deixe uma nota interna."
                : "";
  // Rascunho que já não pode seguir por aqui (Zendesk desligado, respostas públicas desligadas, pessoa que a Meta
  // não deixa contactar): fica para copiar ou passar para nota interna.
  const draftStuck = zendeskOff || (isComment && !c?.conversation.public_replies) || unreachable;
  const noteBlocked = !c ? "A carregar…" : zendeskLive && !me?.zendesk ? "Ligue a sua conta Zendesk para escrever notas internas no ticket." : "";
  // Sem caixa de resposta neste separador, o painel dos emojis fecha (não volta a abrir sozinho mais tarde).
  const composerBlocked = Boolean(mode === "reply" ? replyBlocked : noteBlocked);
  useEffect(() => {
    if (composerBlocked) setShowEmoji(false);
  }, [composerBlocked]);

  // Assistente de IA: pede uma proposta (abre o separador da IA) e passa-a para o campo de resposta.
  // A proposta nunca é enviada sozinha: fica no rascunho para rever e enviar.
  const suggestReply = () => {
    setInfoTab("ia");
    if (sideOverlays()) setPane("info");
    setAiRequest({ n: Date.now() });
  };
  const useAiDraft = (value: string, how: "replace" | "append") => {
    if (!selected) return;
    const current = drafts[selected]?.reply || "";
    if (how === "replace" && current.trim() && current.trim() !== value.trim() && !confirm("Substituir o texto que já está no campo de resposta pela proposta da IA?")) return;
    setDraft(selected, "reply", how === "append" && current.trim() ? `${current.replace(/\s+$/, "")}\n\n${value}` : value);
    setMode("reply");
    if (sideOverlays()) setPane("conversation");
  };

  async function send() {
    if (!selected || !c || (!text.trim() && !pendingHere.length) || sendingId || uploading) return;
    const blocked = mode === "reply" ? replyBlocked : noteBlocked;
    if (blocked) return;
    const id = selected, which = mode, body = text.trim();
    // Resposta pública: confirmar antes de publicar algo que parece um dado pessoal (fica visível para todos).
    if (isComment && which === "reply") {
      if (body.length > maxChars) {
        setSendError(`Resposta demasiado longa para um comentário (máximo ${maxChars} caracteres).`);
        return;
      }
      const risks = publicReplyRisks(body);
      if (risks.length && !confirm(`Esta resposta fica PÚBLICA na publicação e parece conter ${risks.join(", ")}. Publicar mesmo assim?`)) return;
    }
    const slot = slotOf(id, which);
    const uploads = (pending[slot] || []).map((u) => u.id);
    // A mesma chave só se reutiliza para o mesmo texto (pedido perdido): o servidor nunca envia duas vezes.
    const prev = pendingKey.current[slot];
    const key = prev && prev.body === body + "|" + uploads.join(",") ? prev.key : crypto.randomUUID();
    pendingKey.current[slot] = { key, body: body + "|" + uploads.join(",") };
    store("ldo-support-pending", pendingKey.current);
    const here = () => selectedRef.current === id;
    setSendingId(id);
    setSendError("");
    try {
      const r = await api<{ delivery: Delivery | null; detail?: string | null; repeated: boolean }>(`/api/support/conversations/${id}`, {
        method: "POST", body: { action: which === "reply" ? "reply" : "note", body, clientKey: key, uploads },
      });
      delete pendingKey.current[slot];
      store("ldo-support-pending", pendingKey.current);
      if (r.delivery === "failed") {
        // Falhou com certeza: o texto fica no rascunho para corrigir e voltar a enviar.
        if (here()) setSendError(r.detail || "O envio falhou. O texto ficou no rascunho.");
      } else {
        setDraft(id, which, "");
        if (lastTyped.current.id === id) lastTyped.current = { id: null, at: 0 };
        (pending[slot] || []).forEach(dropPreview);
        setPending((p) => ({ ...p, [slot]: [] }));
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

  const viewerItems = useMemo(
    () =>
      (c?.messages || []).flatMap((m) =>
        m.attachments.map((a, i) => ({
          key: `${m.id}:${i}`,
          href: `/api/support/attachments?${new URLSearchParams({ c: c!.conversation.id, m: m.id, i: String(i) })}`,
          name: a.name,
          size: a.size,
          // Facebook/Instagram não indicam o tipo: tenta-se como imagem (se falhar, fica para descarregar).
          kind: a.type ? previewKind(a.type) : ("image" as const),
        })),
      ),
    [c],
  );
  // A conversa com as mudanças de responsável pelo meio, por ordem de hora.
  const timeline = useMemo(() => {
    type Row = { key: string; at: string; message?: Message; event?: AuditEntry };
    if (!c) return [] as Row[];
    const events: Row[] = c.audit.filter((a) => THREAD_EVENTS.has(a.action)).map((a, i) => ({ key: `ev-${i}-${a.created_at}`, at: a.created_at, event: a }));
    const messages: Row[] = c.messages.map((m) => ({ key: m.id, at: m.created_at, message: m }));
    return [...messages, ...events].sort((x, y) => x.at.localeCompare(y.at));
  }, [c]);
  const sources = list?.sources || [];
  // Estado dos canais: os comentários do Facebook e do Instagram num só indicador (o pior estado dos dois), para a
  // barra não crescer; o detalhe de cada um fica no texto de ajuda.
  const sourceChips = useMemo(() => {
    const comments = sources.filter((s) => s.platform === "metricool_comments");
    const others = sources.filter((s) => s.platform !== "metricool_comments");
    if (!comments.length) return others.map((s) => ({ ...s, title: s.last_error || s.status_detail || "" }));
    const rank = ["blocked", "error", "pending", "not_configured", "active", "disabled"];
    const worst = [...comments].sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status))[0];
    const oldest = comments.map((s) => s.last_success_at).filter(Boolean).sort()[0] || null;
    return [
      ...others.map((s) => ({ ...s, title: s.last_error || s.status_detail || "" })),
      { ...worst, id: "comments", label: "Comentários", last_success_at: worst.status === "active" ? oldest : worst.last_success_at,
        title: comments.map((s) => `${s.label}: ${s.last_error || s.status_detail || (s.status === "active" ? `sincronizado ${time(s.last_success_at)}` : s.status)}`).join(" · ") },
    ];
  }, [sources]);
  // Só fontes ativas contam: uma fonte por ligar não faz parecer que tudo está atualizado.
  const lastSync = sources.filter((s) => s.status === "active").map((s) => s.last_success_at).filter(Boolean).sort().at(-1) || null;
  const destination = useMemo(() => {
    if (!c) return "";
    const who = c.contact?.handle || c.contact?.name || c.contact?.email || "cliente";
    if (zendeskOff) return "nada sai para o cliente por aqui (Zendesk desligado)";
    if (isZendesk) return `Resposta pública no ticket ${c.conversation.subject?.split(" · ")[0] || ""} — Zendesk notifica ${c.contact?.email || who}`;
    if (isGmail) return `Email para ${c.contact?.email || c.contact?.claimed_email || who}, de ${c.conversation.account || "apoiocliente@lojadoouro.pt"} — na mesma conversa, com a assinatura automática`;
    if (commentChannel) return `Comentário público no ${commentChannel === "instagram_comments" ? "Instagram" : "Facebook"} · resposta a ${who} (todos veem)`;
    if (c.conversation.channel === "instagram") return `Instagram Direct · para ${who}`;
    if (c.conversation.channel === "facebook") return `Facebook Messenger · para ${who}`;
    if (c.conversation.channel === "site")
      return `Chat do site${site ? ` · ${SITE_BRAND[site.site].brand} · em ${LOCALE_LABEL[site.locale]}` : ""} · para ${who} (se já tiver saído do site, recebe também por email)`;
    return `${CHANNEL_LABEL[c.conversation.channel]} · por configurar`;
  }, [c, isZendesk, isGmail, zendeskOff, commentChannel, site?.site, site?.locale]);
  // Imagens da publicação no visualizador (pelo proxy do dashboard; os vídeos abrem na própria publicação).
  const postItems = useMemo(
    () =>
      (c?.post?.media || [])
        .filter((m) => m.kind === "image")
        .map((m, n, all) => ({
          key: `post:${m.index}`,
          href: `/api/support/post-media?${new URLSearchParams({ c: c!.conversation.id, i: String(m.index) })}`,
          name: `${POST_KIND_LABEL[c!.post!.kind] || "Publicação"}${all.length > 1 ? ` — imagem ${n + 1}` : ""}`,
          size: null,
          kind: "image" as const,
        })),
    [c],
  );

  return (
    <div className={`support-app show-${pane}`}>
      {flash.ok && <div role="status" className="notice ok-notice support-flash">{flash.ok}</div>}
      {flash.error && <div role="alert" className="notice error-notice support-flash">{flash.error}</div>}
      <div className="support-sources" aria-label="Estado dos canais">
        {sourceChips.map((s) => (
          <span key={s.id} className={`source-chip ${s.status}`} title={s.title}>
            <b>{s.label}</b>
            {s.status === "disabled" ? "Desligado (só histórico)" : s.status === "not_configured" ? "Por configurar" : s.status === "active" && s.platform === "site" ? "Em direto" : s.status === "active" ? `Sincronizado ${time(s.last_success_at)}` : s.status === "pending" ? s.status_detail || "A aguardar ligação" : s.status === "blocked" ? "Bloqueado" : "Erro"}
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
                  {list && <b>{list.counts[key] ?? 0}</b>}
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
          {filter === "auto" && list?.automatic && (
            <div className="auto-summary">
              <p><strong>Respostas automáticas enviadas</strong></p>
              <p>Hoje: {autoSummary(list.automatic.today)}</p>
              <p>Últimos 7 dias: {autoSummary(list.automatic.week)}</p>
              <p className="muted">Aqui ficam as conversas de quem só reagiu (story, gosto, emoji) e nunca fez um pedido. Voltam à lista principal se a pessoa escrever de novo, ou se alguém da equipa as atribuir, mudar o estado ou escrever nelas.</p>
            </div>
          )}
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
                    {i.auto && <span className="status-badge auto">Tratada automaticamente</span>}
                    {i.unread > 0 && <b className="unread-badge" aria-label={`${i.unread} não lidas`}>{i.unread}</b>}
                    {i.attention && <span className="attention" title="Envio falhado, incerto ou por concluir">!</span>}
                  </span>
                  <span className="support-item-preview">
                    {i.last_direction === "outbound" ? "Nós: " : ""}
                    {i.last_preview || i.subject || "Sem mensagens"}
                  </span>
                  {isCommentChannel(i.channel) && i.subject && <span className="support-item-context">Em: {i.subject}</span>}
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
                    {/* Chat do site noutra língua ou na Gold Store Premium (Loja do Ouro em português fica sem destaque). */}
                    {site && (site.site !== "ldo" || site.locale !== "pt") && (
                      <span className="site-chip" title={`Site ${SITE_BRAND[site.site].brand} (${SITE_BRAND[site.site].domain}) · cliente em ${LOCALE_LABEL[site.locale]}${site.country ? ` · país ${countryName(site.country)}` : ""}`}>
                        {site.locale.toUpperCase()} · {SITE_BRAND[site.site].brand}
                      </span>
                    )}
                  </small>
                </div>
                <span className={`status-badge ${c.conversation.status}`}>{STATUS_LABEL[c.conversation.status]}</span>
                <button type="button" className="secondary-button support-info-toggle" onClick={() => { setInfoTab("cliente"); setPane("info"); }}>Cliente</button>
                <button type="button" className="secondary-button support-info-toggle" onClick={() => { setInfoTab("ia"); setPane("info"); }}>✨ IA</button>
              </header>
              {c.presence.length > 0 && (
                <div className="notice support-presence" role="status">
                  {c.presence.map((p) => `${p.name} ${p.composing ? "está a escrever nesta conversa" : "tem esta conversa aberta"}`).join(" · ")}.
                </div>
              )}
              {detailError && <p className="support-error" role="alert">{detailError}</p>}
              {actionError && <p className="support-error" role="alert">{actionError}</p>}
              {actionNote && <p className="support-note" role="status">{actionNote}</p>}
              {commentChannel && (
                <PostCard
                  key={c.conversation.id}
                  post={c.post || null}
                  network={commentChannel === "instagram_comments" ? "Instagram" : "Facebook"}
                  items={postItems}
                  open={postOpen}
                  onToggle={() => setPostOpen((v) => !v)}
                  onView={(items, index, opener) => {
                    viewerOpener.current = opener;
                    setViewer({ items, index });
                  }}
                />
              )}
              <div className="support-messages" ref={messagesBox}>
                {timeline.map((t) => {
                  if (t.event) return <p key={t.key} className="msg-event" role="note">{assignText(t.event)} · <time dateTime={t.at}>{time(t.at)}</time></p>;
                  const m = t.message!;
                  return (
                  <article key={m.id} className={`msg ${m.kind}`}>
                    <header>
                      <strong>{m.kind === "note" ? `Nota interna · ${m.author_name || "Equipa"}` : m.author_name || (m.kind === "inbound" ? "Cliente" : brand)}</strong>
                      {isComment && m.kind === "outbound" && (
                        <small className={`public-flag${m.delivery === "failed" ? " failed" : ""}`}>{m.delivery === "failed" ? "não publicada" : "resposta pública"}</small>
                      )}
                      <time dateTime={m.created_at}>{time(m.created_at)}</time>
                    </header>
                    {m.deleted ? <p className="msg-deleted">{isComment ? "Comentário apagado." : "Mensagem apagada pelo cliente."}</p> : m.body && <p>{m.body}</p>}
                    {m.attachments.length > 0 && (
                      <div className="msg-attachments">
                        {m.attachments.map((a, i) => {
                          const item = viewerItems.find((v) => v.key === `${m.id}:${i}`)!;
                          const openIt = (e: React.MouseEvent<HTMLElement>) => {
                            viewerOpener.current = e.currentTarget;
                            setViewer({ items: viewerItems, index: viewerItems.indexOf(item) });
                          };
                          // Imagens pequenas aparecem logo; as grandes (vindas do Zendesk) só ao abrir.
                          return item.kind === "image" && (a.size ?? 0) <= 4 * 1024 * 1024 && !brokenThumbs.has(item.href) && !(a.inline && (a.size ?? 0) < 20 * 1024) ? (
                            <button key={i} type="button" className="attachment-thumb" onClick={openIt} title={`Ver ${a.name}`}>
                              <img src={item.href} alt={a.name} loading="lazy" decoding="async" onError={() => setBrokenThumbs((b) => new Set(b).add(item.href))} />
                            </button>
                          ) : item.kind === "audio" && !brokenThumbs.has(item.href) ? (
                            <span key={i} className="attachment-audio">
                              <button type="button" className="attachment-chip" onClick={openIt} title={`Abrir ${a.name}`}>
                                <span aria-hidden="true">🎵</span>
                                {a.name}
                              </button>
                              <audio src={item.href} controls preload="none" onError={() => setBrokenThumbs((b) => new Set(b).add(item.href))} />
                            </span>
                          ) : (
                            <button key={i} type="button" className="attachment-chip" onClick={openIt}>
                              <span aria-hidden="true">{item.kind === "pdf" ? "📄" : item.kind === "video" ? "🎬" : item.kind === "image" ? "🖼" : "📎"}</span>
                              {brokenThumbs.has(item.href) ? "Imagem indisponível" : a.name}
                              {a.size ? <small> · {sizeLabel(a.size)}</small> : null}
                            </button>
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
                            {zendeskOff ? (
                              <button type="button" onClick={() => {
                                if (confirm("Confirma que viu no Zendesk que esta mensagem foi enviada?")) act({ action: "confirm_sent", messageId: m.id });
                              }}>Confirmei no Zendesk</button>
                            ) : (
                              <button type="button" onClick={() => act({ action: "verify", messageId: m.id })}>Verificar</button>
                            )}
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
                          <button type="button" onClick={() => { const which = m.kind === "note" ? "note" : "reply"; setMode(which); setDraft(selected!, which, m.body); }}>Copiar para o rascunho</button>
                        )}
                      </footer>
                    )}
                  </article>
                  );
                })}
                {!c.messages.length && <p className="support-empty">Sem mensagens sincronizadas.</p>}
              </div>

              {/* Entre as mensagens e a caixa de resposta: no telemóvel ocupa o lugar das mensagens, não o do texto. */}
              {showEmoji && !(mode === "reply" ? replyBlocked : noteBlocked) && <EmojiPicker onPick={insertEmoji} onClose={closeEmoji} />}
              <div className={`support-composer ${mode}${publicReply ? " public" : ""}`}>
                {/* Parte de cima com scroll; os botões ficam sempre à vista por baixo (nunca por cima do texto). */}
                <div className="composer-scroll">
                <div className="composer-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={mode === "reply"} className={mode === "reply" ? "active" : ""} onClick={() => setMode("reply")}>{isComment ? "Resposta pública" : "Responder ao cliente"}</button>
                  <button type="button" role="tab" aria-selected={mode === "note"} className={mode === "note" ? "active" : ""} onClick={() => setMode("note")}>Nota interna</button>
                </div>
                <p className="composer-target">
                  {publicReply ? (
                    <span className="composer-target-line" title={`${destination}. Sem email, telefone, morada nem n.º de encomenda: para isso, mensagem privada.`}>🌐 <strong>{destination}</strong></span>
                  ) : mode === "reply" ? <>Envia por: <strong>{destination}</strong></> : <>Nota interna — <strong>visível só para a equipa</strong>{zendeskLive ? " (comentário privado no Zendesk)" : isComment ? " (nunca é publicada)" : ""}.</>}
                  {mode === "reply" && !c.conversation.assignee_id && !c.conversation.external_assignee_id && !replyBlocked && <small className="block muted">Ao responder fica responsável por esta conversa.</small>}
                </p>
                {(mode === "reply" ? replyBlocked : noteBlocked) ? (
                  <div className="composer-blocked">
                    {mode === "reply" ? replyBlocked : noteBlocked}
                    {draftStuck && mode === "reply" && draft.reply.trim() && selected && (
                      <div className="composer-draft">
                        <textarea readOnly value={draft.reply} rows={4} aria-label="Rascunho da resposta" />
                        <button type="button" className="secondary-button" onClick={() => navigator.clipboard?.writeText(draft.reply).catch(() => undefined)}>Copiar</button>
                        <button type="button" className="secondary-button" onClick={() => {
                          setDraft(selected, "note", [draft.note, draft.reply].filter((x) => x.trim()).join("\n\n"));
                          setDraft(selected, "reply", "");
                          setMode("note");
                        }}>Passar para nota interna</button>
                      </div>
                    )}
                    {zendeskLive && !me?.zendesk && zendeskReady && (
                      <form method="post" action="/api/support/zendesk/connect"><button type="submit" className="secondary-button">Ligar Zendesk</button></form>
                    )}
                  </div>
                ) : (
                  <>
                    {showCatalog && (
                      <CatalogPicker canAttach={maxAttachments > pendingHere.length} onClose={() => setShowCatalog(false)} onInsert={insertCatalog} />
                    )}
                    <textarea
                      ref={composerText}
                      onSelect={(e) => keepCaret(e.currentTarget)}
                      onBlur={(e) => keepCaret(e.currentTarget)}
                      onPaste={(e) => {
                        // Resposta pública: um texto colado acima do limite do comentário não é cortado sem aviso.
                        if (publicReply) {
                          const el = e.currentTarget, pasted = e.clipboardData.getData("text/plain");
                          if (pasted.length > maxChars - (text.length - (el.selectionEnd - el.selectionStart))) {
                            e.preventDefault();
                            setSendError(`Texto demasiado longo para um comentário (máximo ${maxChars} caracteres): encurte-o antes de colar.`);
                            return;
                          }
                        }
                        const files = [...e.clipboardData.files];
                        if (!files.length || !maxAttachments) return;
                        // Excel/Word põem texto e uma imagem da seleção: fica o texto.
                        if (e.clipboardData.getData("text/plain").trim()) return;
                        e.preventDefault();
                        addFiles(files);
                      }}
                      value={text}
                      onChange={(e) => typed(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                        else if (e.key === "Escape" && showEmoji) {
                          e.preventDefault();
                          setShowEmoji(false);
                        }
                      }}
                      rows={4}
                      maxLength={maxChars}
                      placeholder={publicReply ? "Resposta pública (todos a veem): sem email, telefone, morada nem n.º de encomenda…" : mode === "reply" ? "Escreva a resposta ao cliente…" : "Nota para a equipa (o cliente não a vê)…"}
                      aria-label={publicReply ? "Resposta pública ao comentário" : mode === "reply" ? "Resposta ao cliente" : "Nota interna"}
                    />
                    {pendingHere.length > 0 && (
                      <ul className="pending-uploads" aria-label="Anexos por enviar">
                        {pendingHere.map((u) => (
                          <li key={u.id}>
                            {u.preview ? <img src={u.preview} alt="" /> : <span aria-hidden="true">📄</span>}
                            <span>{u.name}<small> · {sizeLabel(u.size)}</small></span>
                            <button type="button" aria-label={`Retirar ${u.name}`} onClick={() => {
                              const slot = slotOf(selected!, mode);
                              dropPreview(u);
                              setPending((p) => ({ ...p, [slot]: (p[slot] || []).filter((x) => x.id !== u.id) }));
                            }}>✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                </div>
                {!(mode === "reply" ? replyBlocked : noteBlocked) && (
                    <div className="composer-actions">
                      {sendError && <span className="support-error" role="alert">{sendError}</span>}
                      <input
                        ref={fileInput}
                        type="file"
                        hidden
                        multiple={maxAttachments > 1}
                        accept={isZendesk || isGmail ? "image/jpeg,image/png,image/webp,image/heic,application/pdf" : "image/jpeg,image/png,image/webp,image/heic"}
                        onChange={(e) => {
                          if (e.target.files) addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      {!isComment && (
                        <button type="button" className="secondary-button" disabled={!maxAttachments || uploading || pendingHere.length >= maxAttachments} title={attachHint} onClick={() => fileInput.current?.click()}>
                          {uploading ? "A anexar…" : <><span aria-hidden="true">📎</span><span className="btn-label"> Anexar</span></>}
                        </button>
                      )}
                      <button type="button" className="secondary-button" onClick={() => { setShowEmoji((v) => !v); setShowCatalog(false); }} onKeyDown={(e) => { if (e.key === "Escape" && showEmoji) { e.preventDefault(); setShowEmoji(false); } }} aria-expanded={showEmoji} aria-label="Emojis" title="Inserir emoji"><span aria-hidden="true">😊</span></button>
                      {mode === "reply" && (
                        <button type="button" className="secondary-button" onClick={() => { setShowCatalog((v) => !v); setShowEmoji(false); }} aria-expanded={showCatalog} aria-label="Produto da loja" title="Produto da loja"><span aria-hidden="true">🛍</span><span className="btn-label"> Produto</span></button>
                      )}
                      {mode === "reply" && (
                        <button type="button" className="secondary-button" onClick={suggestReply} title="A IA propõe uma resposta (não envia nada)." aria-label="Sugerir resposta com a IA"><span aria-hidden="true">✨</span><span className="btn-label"> Sugerir resposta</span></button>
                      )}
                      {publicReply ? (
                        <small className={overLimit ? "over-limit" : ""} title={overLimit ? "Acima do limite de um comentário" : "Caracteres usados / limite do comentário"}>
                          {text.length}/{maxChars}{overLimit ? " — acima do limite" : ""}
                        </small>
                      ) : (
                        <small className="composer-hint">Ctrl+Enter para enviar</small>
                      )}
                      <button type="button" onClick={send} title={publicReply ? "Ctrl+Enter para publicar" : "Ctrl+Enter para enviar"} disabled={sending || uploading || overLimit || (!text.trim() && !pendingHere.length)}>
                        {sending ? (publicReply ? "A publicar…" : "A enviar…") : publicReply ? <>Publicar<span className="btn-label"> resposta</span></> : mode === "reply" ? <>Enviar<span className="btn-label"> ao cliente</span></> : "Guardar nota"}
                      </button>
                    </div>
                )}
              </div>
            </>
          )}
        </section>

        {viewer && (
          <AttachmentViewer
            items={viewer.items}
            index={viewer.index}
            onIndex={(index) => setViewer((v) => (v ? { ...v, index } : v))}
            onClose={() => {
              setViewer(null);
              viewerOpener.current?.focus();
            }}
          />
        )}
        <aside className="support-info" aria-label="Cliente e assistente de IA">
          {c ? (
            <>
              <div className="info-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={infoTab === "cliente"} className={infoTab === "cliente" ? "active" : ""} onClick={() => setInfoTab("cliente")}>Cliente</button>
                <button type="button" role="tab" aria-selected={infoTab === "ia"} className={infoTab === "ia" ? "active" : ""} onClick={() => setInfoTab("ia")}>✨ Assistente IA</button>
              </div>
              {/* Os dois ficam montados: mudar de separador não perde um pedido à IA em curso. */}
              <div className="info-pane" hidden={infoTab !== "cliente"}>
                <CustomerPanel
                  key={c.conversation.id}
                  d={c}
                  visitor={siteVisitor}
                  zendeskSubdomain={zendeskSubdomain}
                  actionError={actionError}
                  onBack={() => setPane("conversation")}
                  onAct={act}
                  onReload={() => loadDetail(c.conversation.id)}
                  onOpen={(id) => open(id)}
                />
              </div>
              <div className="info-pane" hidden={infoTab !== "ia"}>
                <AiPanel
                  key={c.conversation.id}
                  conversationId={c.conversation.id}
                  visible={infoTab === "ia" && (pane === "info" || !sideOverlays())}
                  request={aiRequest}
                  replyBlocked={replyBlocked}
                  publicReply={isComment}
                  onUseDraft={useAiDraft}
                  onBack={() => setPane("conversation")}
                />
              </div>
            </>
          ) : (
            <p className="support-empty">Informação do cliente.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

// Publicação comentada, por cima das mensagens: miniatura, tipo, legenda e ligação para a publicação. Fica numa
// linha (abre ao tocar) e só abre por omissão em ecrãs grandes; a escolha mantém-se ao mudar de conversa. A legenda
// é texto simples (nunca HTML) e as imagens chegam pelo proxy do dashboard.
function PostCard({ post, network, items, open, onToggle, onView }: {
  post: Post | null;
  network: "Instagram" | "Facebook";
  items: ViewerItem[];
  open: boolean;
  onToggle: () => void;
  onView: (items: ViewerItem[], index: number, opener: HTMLElement) => void;
}) {
  // Imagens que não carregaram (endereço da Meta expirado): voltam a ser pedidas quando a sincronização atualiza a
  // publicação, ou ao tocar em "Sem imagem" (o cartão não é recriado: o scroll e o foco mantêm-se).
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [retry, setRetry] = useState(0);
  const brokenRef = useRef(broken);
  brokenRef.current = broken;
  const seenAt = post?.seen_at;
  useEffect(() => {
    if (!brokenRef.current.size) return;
    setBroken(new Set());
    setRetry((n) => n + 1);
  }, [seenAt]);
  const src = (href: string) => (retry ? `${href}&r=${retry}` : href);
  if (!post) return <section className="post-card" aria-label="Publicação comentada"><p className="post-card-empty">Publicação comentada ainda por sincronizar.</p></section>;
  const title = POST_KIND_TITLE[post.kind] || "Publicação comentada";
  const shown = items.filter((it) => !broken.has(it.href));
  const first = shown[0];
  const unavailable = items.length > 0 && !shown.length;
  const video = post.kind === "reel" || post.kind === "video" || post.media.some((m) => m.kind === "video");
  const counts = [
    post.comment_count !== null && `${post.comment_count} comentário${post.comment_count === 1 ? "" : "s"}`,
    post.reaction_count !== null && `${post.reaction_count} reaç${post.reaction_count === 1 ? "ão" : "ões"}`,
  ].filter(Boolean).join(" · ");
  const fail = (href: string) => setBroken((b) => new Set(b).add(href));
  return (
    <section className={`post-card${open ? " open" : ""}`} aria-label="Publicação comentada">
      <div className="post-card-head">
        {first ? (
          <button type="button" className="post-thumb" onClick={(e) => onView(shown, 0, e.currentTarget)} title="Ver imagem da publicação">
            <img src={src(first.href)} alt={title} loading="lazy" decoding="async" onError={() => fail(first.href)} />
            {shown.length > 1 && <span className="post-thumb-more">+{shown.length - 1}</span>}
          </button>
        ) : unavailable ? (
          <button type="button" className="post-thumb empty unavailable" title="A imagem não carregou (o endereço da Meta pode ter expirado). Tocar para tentar de novo."
            onClick={() => { setBroken(new Set()); setRetry((n) => n + 1); }}>Sem imagem</button>
        ) : (
          <span className="post-thumb empty" aria-hidden="true">{video ? "🎬" : "🖼"}</span>
        )}
        <button type="button" className="post-card-summary" aria-expanded={open} onClick={onToggle}>
          <span className="post-card-title">
            <b>{title}</b>
            {counts && <small> · {counts}</small>}
          </span>
          <span className="post-card-caption">{post.caption || "Sem legenda."}</span>
        </button>
        {post.link && <a className="post-card-link" href={post.link} target="_blank" rel="noopener noreferrer">Abrir no {network} ↗</a>}
      </div>
      {open && (
        <div className="post-card-body">
          {post.caption && <p className="post-card-full">{post.caption}</p>}
          {shown.length > 1 && (
            <div className="post-card-media">
              {shown.map((it, n) => (
                <button key={it.href} type="button" className="post-thumb" onClick={(e) => onView(shown, n, e.currentTarget)} title={`Ver ${it.name}`}>
                  <img src={src(it.href)} alt={it.name} loading="lazy" decoding="async" onError={() => fail(it.href)} />
                </button>
              ))}
            </div>
          )}
          {video && <small className="muted">Vídeo: veja-o na própria publicação.</small>}
          <small className="muted block">Dados da publicação na última sincronização ({time(post.seen_at)}).</small>
        </div>
      )}
    </section>
  );
}

function CustomerPanel({
  d, visitor, zendeskSubdomain, actionError, onBack, onAct, onReload, onOpen,
}: {
  d: Detail;
  visitor: SiteVisitorState | null;
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
  // Zendesk desligado: os tickets antigos ficam como no resto do dashboard (estado e responsável locais).
  const isZendesk = conv.platform === "zendesk" && conv.source_status !== "disabled";
  const zendeskOff = conv.platform === "zendesk" && conv.source_status === "disabled";
  const contactId = contact?.id, linkedEmail = contact?.linked_email, contactEmail = contact?.email;
  const loadOrders = useCallback(() => {
    if (!contactId) return;
    api<Orders>(`/api/support/contacts/${contactId}?conversa=${conv.id}`)
      .then(setOrders)
      .catch((e) => setOrders({ email: null, orders: [], error: e instanceof Error ? e.message : "Indisponível." }));
    // linkedEmail/contactEmail: procurar de novo quando a associação muda.
  }, [contactId, linkedEmail, contactEmail, conv.id]);
  useEffect(loadOrders, [loadOrders]);
  // Telemóvel registado na loja (da encomenda mais recente que o tenha).
  const shopPhone = orders?.orders.find((o) => o.phone)?.phone || null;
  // Encomendas que o cliente mencionou e que não estão já na lista acima.
  const mentioned = useMemo(() => {
    const known = new Set((orders?.orders || []).map((o) => o.name.replace(/\D/g, "")));
    return orderNumbersIn(d.messages.filter((m) => m.kind === "inbound").map((m) => m.body || "")).filter((n) => !known.has(n));
  }, [d.messages, orders]);
  const [lookup, setLookup] = useState<OrderLookup | null>(null);
  async function findOrder(number: string) {
    setLookup({ number, loading: true });
    try {
      const r = await api<{ order: ShopOrder | null; belongs?: boolean; phoneNote?: string | null; error?: string }>(
        `/api/support/orders?${new URLSearchParams({ conversa: conv.id, numero: number })}`);
      setLookup({ number, loading: false, order: r.order, belongs: r.belongs, phoneNote: r.phoneNote, error: r.error });
    } catch (e) {
      setLookup({ number, loading: false, error: e instanceof Error ? e.message : "Indisponível." });
    }
  }

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

  // Responsável: assume-se uma conversa livre; o responsável (ou o Super Admin) transfere-a a um colega.
  // No Zendesk só se transfere a quem ligou a conta Zendesk (o responsável é o agente Zendesk).
  const own: Ownership = { assigneeId: conv.assignee_id, me: d.me, isSuper: Boolean(d.super) };
  const transferTo = d.users.filter((u) => u.id !== conv.assignee_id && (!isZendesk || u.zendesk));
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await onAct(body);
    } finally {
      setBusy(false);
    }
  };
  const owner = conv.assignee_id
    ? `${conv.assignee_name || "—"}${conv.assignee_id === d.me ? " (eu)" : ""}`
    : conv.external_assignee_name ? `${conv.external_assignee_name} ${zendeskOff ? "(no Zendesk)" : "(Zendesk, conta por ligar)"}` : "Sem responsável";
  const targetName = transferTo.find((u) => u.id === target)?.name || "";
  return (
    <div className="customer-panel">
      <button type="button" className="support-back" onClick={onBack}>← Conversa</button>
      <section>
        <span className="eyebrow">Atendimento</span>
        <label>
          Estado
          <select value={conv.status} disabled={!canChangeStatus(own)} title={canChangeStatus(own) ? "" : "Só o responsável (ou o Super Admin) muda o estado."}
            onChange={(e) => onAct({ action: "update", status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s} disabled={isZendesk && s === "novo" && conv.status !== "novo"}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <div className="owner-row">
          <span>Responsável</span>
          <strong>{owner}</strong>
        </div>
        {!conv.assignee_id && (
          <button type="button" className="secondary-button" disabled={busy || (isZendesk && !d.users.find((u) => u.me)?.zendesk)}
            onClick={() => run({ action: "update", assigneeId: d.me })}>
            Assumir conversa
          </button>
        )}
        {canTransfer(own) && (
          <form className="transfer-form" onSubmit={(e) => {
            e.preventDefault();
            if (!target) return;
            const msg = conv.channel === "site"
              ? `Transferir a conversa para ${targetName}? O cliente vê no chat que passou a falar com outra pessoa.`
              : `Transferir a conversa para ${targetName}?`;
            if (confirm(msg)) run({ action: "update", assigneeId: target }).then(() => setTarget(""));
          }}>
            <label>
              Transferir para
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Escolher colega…</option>
                {transferTo.map((u) => <option key={u.id} value={u.id}>{u.name}{u.me ? " (eu)" : ""}</option>)}
              </select>
            </label>
            <button type="submit" className="secondary-button" disabled={!target || busy}>Transferir</button>
          </form>
        )}
        {d.super && conv.assignee_id && (
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => { if (confirm("Deixar esta conversa sem responsável? Volta para a lista \"Sem responsável\" e a próxima pessoa a responder fica com ela.")) run({ action: "update", assigneeId: null }); }}>
            Deixar sem responsável
          </button>
        )}
        {conv.assignee_id && !canTransfer(own) && <small className="muted">Só {conv.assignee_name || "o responsável"} (ou o Super Admin) pode responder ao cliente e transferir esta conversa. Pode deixar notas internas.</small>}
        {isZendesk && <small className="muted">Estado e responsável são gravados no Zendesk (fonte de verdade) com a sua conta. Estado no Zendesk: {conv.platform_status || "—"}.</small>}
        {zendeskOff && <small className="muted">O Zendesk foi desligado do dashboard: estado e responsável deste ticket ficam só aqui (não mudam no Zendesk). Se o Zendesk voltar a ser ligado, passam a vir de lá outra vez.</small>}
        {!isZendesk && !zendeskOff && <small className="muted">Estado e responsável pertencem ao dashboard; uma nova mensagem do cliente reabre uma conversa resolvida.{isCommentChannel(conv.channel) ? " Um comentário em Novo, sem responsável, a que a marca respondeu fora do dashboard passa sozinho a Resolvido." : ""}</small>}
        <div className="customer-actions">
          <button type="button" className="secondary-button" onClick={() => onAct({ action: "unread" })}>Marcar como não lida</button>
          {(isZendesk || zendeskOff) && (
            <a className="outline-button" href={`https://${zendeskSubdomain}.zendesk.com/agent/tickets/${encodeURIComponent(conv.external_id)}`} target="_blank" rel="noopener noreferrer">Abrir no Zendesk</a>
          )}
          {conv.platform === "gmail" && conv.account && (
            <a className="outline-button" href={gmailThreadLink(conv.account, conv.external_id)} target="_blank" rel="noopener noreferrer">Abrir no Gmail</a>
          )}
          {isCommentChannel(conv.channel) && d.post?.link && (
            <a className="outline-button" href={d.post.link} target="_blank" rel="noopener noreferrer">Abrir a publicação</a>
          )}
        </div>
        {actionError && <p className="support-error" role="alert">{actionError}</p>}
      </section>

      {conv.channel === "site" && <SiteVisitor state={visitor} />}

      <section>
        <span className="eyebrow">Contactos conhecidos</span>
        <dl>
          <dt>Nome</dt><dd>{contact?.name || "—"}</dd>
          {contact?.handle && contact.handle !== contact.name && (<><dt>Perfil</dt><dd>{contact.handle}</dd></>)}
          <dt>Email</dt>
          <dd>
            {contact?.email || (contact?.claimed_email ? <>{contact.claimed_email} <small className="muted">({conv.channel === "email" ? "indicado no formulário de contacto" : "indicado no chat"}, não confirmado)</small></> : "—")}
            {conv.channel === "site" && contact?.email && <small className="muted block">Confirmado: o cliente tinha sessão iniciada na loja.</small>}
          </dd>
          <dt>Telefone</dt><dd>{contact?.phone || "—"}</dd>
          <dt>Canal</dt><dd>{conv.source_label}</dd>
        </dl>
      </section>

      <section>
        <span className="eyebrow">Cliente da loja online</span>
        {isCommentChannel(conv.channel) ? (
          // Comentários públicos: quem comenta não se associa a um cliente da loja (no Instagram é identificado pelo nome
          // de utilizador, que pode passar para outra pessoa, e a resposta é pública).
          <p className="muted small">Nos comentários públicos não se associa o cliente da loja. Para tratar de encomendas, convide-o a enviar mensagem privada.</p>
        ) : (
          <>
            <p className="muted small">A associação é manual, por email. Nunca se juntam clientes pelo nome.</p>
            <form className="link-form" onSubmit={(e) => { e.preventDefault(); link(email); }}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={contact?.email || contact?.claimed_email || "email do cliente na loja"} aria-label="Email do cliente na loja online" />
              <button type="submit" className="secondary-button">Associar</button>
              {contact?.linked_email && <button type="button" className="secondary-button" onClick={() => { setEmail(""); link(""); }}>Remover</button>}
            </form>
          </>
        )}
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
              {shopPhone && <p className="order-phone">📞 Telemóvel na loja: <a href={`tel:${shopPhone.replace(/[^\d+]/g, "")}`}>{shopPhone}</a></p>}
              {orders.phone_note && <small className="muted block">{orders.phone_note}</small>}
              <ul className="order-list">
                {orders.orders.map((o, i) => <OrderRow key={o.name} o={o} open={i === 0} />)}
              </ul>
            </>
          ) : (
            <small className="muted">Sem encomendas Shopify para {orders.email}.</small>
          )}
        </div>
        {mentioned.length > 0 && (
          <div className="orders mentioned">
            <small className="muted">Encomendas mencionadas na conversa:</small>
            <div className="related">
              {mentioned.map((n) => (
                <button key={n} type="button" className="secondary-button" disabled={lookup?.number === n && lookup.loading} onClick={() => findOrder(n)}>
                  Ver encomenda #{n}
                </button>
              ))}
            </div>
            {lookup && (lookup.loading ? <small className="muted">A procurar #{lookup.number}…</small>
              : lookup.error ? <p className="support-error">Encomenda #{lookup.number}: {lookup.error}</p>
              : !lookup.order ? <small className="muted">Não existe a encomenda #{lookup.number} na loja online.</small>
              : (
                <>
                  {!lookup.belongs && (
                    <p className="support-warning">Esta encomenda não está no email deste contacto. Confirme a identidade do cliente (por exemplo, o email usado na compra) antes de partilhar dados.</p>
                  )}
                  {lookup.order.phone && <p className="order-phone">📞 Telemóvel da encomenda: <a href={`tel:${lookup.order.phone.replace(/[^\d+]/g, "")}`}>{lookup.order.phone}</a></p>}
                  {lookup.phoneNote && <small className="muted block">{lookup.phoneNote}</small>}
                  <ul className="order-list"><OrderRow o={lookup.order} open /></ul>
                </>
              ))}
          </div>
        )}
      </section>

      <section>
        <span className="eyebrow">Registo</span>
        <ul className="audit">
          {d.audit.map((a, i) => (
            <li key={i}>
              <small>{time(a.created_at)}</small> {THREAD_EVENTS.has(a.action) ? assignText(a) : `${a.actor} ${AUDIT[a.action] || a.action}`}
              {a.action === "status" && typeof a.details.to === "string" && ` → ${STATUS_LABEL[a.details.to as Status] || a.details.to}`}
            </li>
          ))}
          {!d.audit.length && <li className="muted">Sem ações registadas.</li>}
        </ul>
      </section>
    </div>
  );
}

// locale, site e country: vazios ou em falta (visitantes antigos, servidor anterior) contam como português e Loja do Ouro.
type SiteVisitorInfo = {
  page_url: string | null; page_title: string | null; visit_started_at: string | null; pages_viewed: number | null;
  context_at: string | null; last_seen_at: string; created_at: string; verified: boolean; now: string;
  cart: { count: number; total: number; currency: string; items: { title: string; variant: string | null; quantity: number; price: number; url: string | null }[] } | null;
  locale: string | null; site: "ldo" | "gsp"; country: string | null;
};
// Visitante da conversa aberta (info undefined enquanto carrega; null sem dados do visitante).
type SiteVisitorState = { id: string; info?: SiteVisitorInfo | null; error: string };

// País pelo nome em português ("Espanha (ES)"); só o código se o browser não o souber.
function countryName(code: string) {
  try {
    const name = new Intl.DisplayNames(["pt-PT"], { type: "region" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

// Duração legível ("4 min", "1 h 20 min").
function duration(ms: number) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

// Chat do site: o que o cliente está a fazer na loja e em que site e língua. Enviado pelo browser do cliente (não
// confirmado); lido pela conversa (a cada 15 s enquanto está aberta).
function SiteVisitor({ state }: { state: SiteVisitorState | null }) {
  const info = state?.info;
  const error = state?.error || "";
  if (info === undefined && !error) return null;
  const now = info ? Date.parse(info.now) : 0;
  const online = Boolean(info && now - Date.parse(info.last_seen_at) < 75_000);
  const site = info ? visitorSite(info) : null;
  const origin = (() => {
    const fallback = SITE_BRAND[site?.site || "ldo"].origin;
    try {
      return info?.page_url ? new URL(info.page_url).origin : fallback;
    } catch {
      return fallback;
    }
  })();
  const money = (v: number, currency: string) => new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(v);
  return (
    <section>
      <span className="eyebrow">{online ? "No site agora" : "No site"}</span>
      {error && <p className="support-error">{error}</p>}
      {info === null && <small className="muted">Sem informação do visitante.</small>}
      {info && (
        <>
          <p className={`site-presence ${online ? "on" : "off"}`}>
            <span aria-hidden="true" />
            {online ? "No site agora" : `Saiu do site · visto há ${duration(now - Date.parse(info.last_seen_at))}`}
          </p>
          <dl>
            {site && (
              <>
                <dt>Site / Marca</dt>
                <dd>
                  {SITE_BRAND[site.site].brand} ·{" "}
                  <a href={siteRootUrl(site.site, site.locale)} target="_blank" rel="noopener noreferrer">{SITE_BRAND[site.site].domain}</a>
                </dd>
                <dt>Língua / País</dt>
                <dd>
                  {LOCALE_LABEL[site.locale].charAt(0).toUpperCase() + LOCALE_LABEL[site.locale].slice(1)} · {site.country ? countryName(site.country) : "país desconhecido"}
                </dd>
              </>
            )}
            <dt>Página</dt>
            <dd>
              {info.page_url ? (
                <a href={info.page_url} target="_blank" rel="noopener noreferrer">{info.page_title || new URL(info.page_url).pathname}</a>
              ) : "—"}
            </dd>
            <dt>Visita</dt>
            <dd>
              {info.visit_started_at
                ? `${online ? "Na loja há" : "Esteve na loja"} ${duration((online ? now : Date.parse(info.last_seen_at)) - Date.parse(info.visit_started_at))}`
                : "—"}
              {info.pages_viewed ? <small className="muted block">{info.pages_viewed} página{info.pages_viewed === 1 ? "" : "s"} vista{info.pages_viewed === 1 ? "" : "s"} nesta visita</small> : null}
            </dd>
            <dt>Carrinho</dt>
            <dd>
              {!info.cart ? (
                "Sem informação"
              ) : !info.cart.count ? (
                "Vazio"
              ) : (
                <>
                  {info.cart.count} artigo{info.cart.count === 1 ? "" : "s"} · {money(info.cart.total, info.cart.currency)}
                  <ul className="site-cart">
                    {info.cart.items.map((i, n) => (
                      <li key={n}>
                        {i.quantity} × {i.url ? <a href={`${origin}${i.url}`} target="_blank" rel="noopener noreferrer">{i.title}</a> : i.title}
                        {i.variant ? <small className="muted"> ({i.variant})</small> : null} — {money(i.price, info.cart!.currency)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </dd>
          </dl>
          <small className="muted">Enviado pelo browser do cliente (não confirmado){info.context_at ? `; atualizado há ${duration(now - Date.parse(info.context_at))}` : ""}.</small>
        </>
      )}
    </section>
  );
}
