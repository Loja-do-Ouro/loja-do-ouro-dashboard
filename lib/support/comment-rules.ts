// Comentários das publicações do Facebook e do Instagram (Inbox "post-comments" da Metricool): regras puras,
// partilhadas entre o servidor e o browser (sem segredos nem I/O; testadas em tests/comment-rules.cjs).
// - Uma conversa por comentário principal (tópico): o comentário e as respostas, com a publicação comentada.
// - A marca é o dono da publicação (element.owner.id): as respostas dela são "Loja do Ouro"; tudo o resto é de
//   quem comenta (podem ser várias pessoas no mesmo tópico).
// - A resposta é PÚBLICA: o dashboard avisa antes de publicar dados pessoais (email, telefone, código postal,
//   n.º de encomenda).
import { orderNumbersIn } from "./rules";

export type CommentParticipant = { id?: string; name?: string; email?: string; imageProfileUrl?: string };
export type CommentItem = { id?: string; parentId?: string; creationDate?: string; owner?: string; text?: string; mediaUrl?: string; properties?: Record<string, unknown> };
export type PostElement = {
  id?: string; owner?: CommentParticipant; link?: string; text?: string; mediaUrls?: string[]; commentCount?: number; reactionCount?: number;
  properties?: Record<string, unknown>;
};
export type CommentThread = {
  id?: string; provider?: string; status?: string; creationDate?: string; lastUpdateTime?: string; participants?: CommentParticipant[];
  root?: CommentItem & { element?: PostElement; comments?: CommentItem[] };
};

export type CommentChannel = "facebook_comments" | "instagram_comments";
export const isCommentChannel = (channel: string | null | undefined): channel is CommentChannel =>
  channel === "facebook_comments" || channel === "instagram_comments";

// Limites de texto de um comentário (Instagram 2200 caracteres; Facebook 8000).
export const COMMENT_MAX_CHARS: Record<CommentChannel, number> = { instagram_comments: 2200, facebook_comments: 8000 };

export type PostKind = "post" | "reel" | "video" | "photo" | "story" | "ad" | "other";
export const POST_KIND_LABEL: Record<PostKind, string> = {
  post: "Publicação", reel: "Reel", video: "Vídeo", photo: "Fotografia", story: "Story", ad: "Anúncio", other: "Publicação",
};
// Título do cartão (com a concordância de cada tipo).
export const POST_KIND_TITLE: Record<PostKind, string> = {
  post: "Publicação comentada", reel: "Reel comentado", video: "Vídeo comentado", photo: "Fotografia comentada", story: "Story comentada",
  ad: "Anúncio comentado", other: "Publicação comentada",
};

// Texto de terceiros pronto a gravar: sem metades de emoji (um carácter UTF-16 isolado faz a BD recusar o lote
// inteiro) e cortado sem partir um emoji ao meio.
export function wellFormed(s: string) {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}
export function cut(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}

// Servidores de imagens da Meta (Facebook/Instagram) que o dashboard pode ler.
export const META_CDN = /^(lookaside\.fbsbx\.com|lookaside\.facebook\.com|[a-z0-9.-]+\.fbcdn\.net|[a-z0-9.-]+\.cdninstagram\.com)$/;

export function metaMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && META_CDN.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

// Ligação da publicação: só https no Facebook ou no Instagram (vem de terceiros; é usada como href).
export function safePostLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    return /^([a-z0-9-]+\.)*(facebook\.com|instagram\.com|fb\.com|fb\.watch)$/.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

// Tipo de publicação: pela classificação da Meta (fbMediaProductType / igMediaProductType) e, sem ela, pela ligação.
export function postKind(link: string | null | undefined, productType?: string | null): PostKind {
  const t = (productType || "").toUpperCase();
  if (/^ADS?$|_AD$|^AD_/.test(t)) return "ad";
  if (t === "REELS" || t === "REEL") return "reel";
  if (t === "STORY" || t === "STORIES") return "story";
  if (t === "VIDEO") return "video";
  if (t === "PHOTO" || t === "IMAGE") return "photo";
  if (link) {
    try {
      const u = new URL(link);
      const p = `${u.pathname}${u.search}`;
      if (/\/reels?\//.test(p)) return "reel";
      if (/\/stories\//.test(p)) return "story";
      if (/\/videos?\/|\/watch/.test(p) || u.hostname === "fb.watch") return "video";
      if (/\/photos?\/|photo\.php/.test(p)) return "photo";
      if (/\/p\/|\/posts?\/|permalink|story_fbid/.test(p)) return "post";
    } catch {
      // ligação inválida: tipo genérico
    }
  }
  return t === "FEED" || t === "POST" ? "post" : "other";
}

function productTypeOf(properties: Record<string, unknown> | undefined) {
  const v = properties?.fbMediaProductType ?? properties?.igMediaProductType;
  return typeof v === "string" && /^[A-Za-z_]{1,30}$/.test(v) ? v : null;
}

const norm = (s: string | null | undefined) => (s || "").trim().replace(/^@/, "").toLowerCase();

// Data ISO de uma data da Metricool ("2026-10-11T22:48:27+0200"); null se não for válida.
export function commentDate(value: string | undefined): string | null {
  if (!value) return null;
  const fixed = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(fixed);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function plain(text: unknown, max: number) {
  const s = typeof text === "string" ? text : typeof text === "number" ? String(text) : "";
  return cut(wellFormed(s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim(), max);
}
// Ids e autores podem vir como texto ou como número.
const idOf = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export type CommentIngestMessage = {
  external_id: string; kind: "inbound" | "outbound"; author_name: string | null; author_external_id: string | null; body: string;
  attachments: { name: string; type: null; size: null; ref: string }[]; created_at: string;
};
export type CommentIngest = {
  external_id: string;
  contact: { external_id: string | null; name: string | null; email: null; handle: string | null; avatar_url: string | null };
  subject: string;
  platform_status: string | null;
  via: "comment";
  external_updated_at: string | null;
  // Estado inicial de um tópico novo (e "respondido fora do dashboard" num tópico em Novo): a BD decide.
  resolved: "answered" | "stale" | null;
  post: {
    external_id: string; link: string | null; kind: PostKind; product_type: string | null; caption: string | null;
    media: { url: string; kind: "image" | "video" }[]; comment_count: number | null; reaction_count: number | null; owner_name: string | null;
  } | null;
  messages: CommentIngestMessage[];
};

const STALE_MS = 7 * 24 * 3600 * 1000;

// Conta da marca nos comentários de uma página: a configurada ou já conhecida, ou o dono de mais de metade das
// publicações da página. Sem certeza, null (e nenhum tópico é interpretado).
export function commentBrand(threads: CommentThread[], known: string | null): string | null {
  if (known) return known;
  const count = new Map<string, number>();
  for (const t of threads) {
    const id = idOf(t.root?.element?.owner?.id);
    if (id) count.set(id, (count.get(id) || 0) + 1);
  }
  const [top] = [...count].sort((a, b) => b[1] - a[1]);
  return top && top[1] > threads.length / 2 ? top[0] : null;
}

// Tópico da Metricool → conversa do dashboard. Fica de fora (null) um tópico sem id do comentário principal (é o
// alvo da resposta pública), numa publicação de outra conta, ou só com mensagens da marca.
export function threadToConversation(
  t: CommentThread,
  opts: { network: "FACEBOOK" | "INSTAGRAM"; now: Date; brandHandles?: string[]; brandId?: string | null },
): CommentIngest | null {
  const root = t.root;
  const element = root?.element;
  const brandId = idOf(element?.owner?.id);
  const rootId = idOf(root?.id);
  if (!root || !rootId || !brandId || (opts.brandId && brandId !== opts.brandId)) return null;
  const handles = new Set([norm(idOf(element?.owner?.name)), ...(opts.brandHandles || []).map(norm)].filter(Boolean));
  const isBrand = (owner: string) => !!owner && (owner === brandId || handles.has(norm(owner)));
  const participants = t.participants || [];
  const person = (owner: string) => participants.find((p) => idOf(p.id) === owner || (p.name && owner && norm(idOf(p.name)) === norm(owner)));
  const instagram = opts.network === "INSTAGRAM";
  // No Instagram o autor vem pelo nome de utilizador; no Facebook pelo id (o nome vem dos participantes).
  const nameOf = (owner: string) => plain(person(owner)?.name || (instagram ? owner : ""), 200) || null;

  const items = [root, ...(root.comments || [])]
    .map((c) => ({ c, id: idOf(c.id), owner: idOf(c.owner), at: commentDate(c.creationDate) }))
    .filter((x): x is { c: CommentItem; id: string; owner: string; at: string } => !!x.id && !!x.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const rootOwner = idOf(root.owner);
  const customerOwner = rootOwner && !isBrand(rootOwner) ? rootOwner : items.find((x) => x.owner && !isBrand(x.owner))?.owner;
  if (!customerOwner) return null;

  const messages: CommentIngestMessage[] = items.map(({ c, id, owner, at }) => {
    const brand = isBrand(owner);
    const media = metaMediaUrl(c.mediaUrl);
    return {
      external_id: cut(id, 200),
      kind: brand ? "outbound" : "inbound",
      author_name: brand ? null : nameOf(owner) || (owner === customerOwner ? null : "Outra pessoa"),
      author_external_id: owner ? cut(owner, 200) : null,
      body: plain(c.text, 20000),
      attachments: media ? [{ name: "Imagem do comentário", type: null, size: null, ref: `metricool:${media}` }] : [],
      created_at: at,
    };
  });
  const last = messages.at(-1);
  const resolved = !last ? null : last.kind === "outbound" ? "answered" : opts.now.getTime() - Date.parse(last.created_at) > STALE_MS ? "stale" : null;

  const link = safePostLink(element?.link);
  const productType = productTypeOf(element?.properties);
  const kind = postKind(link, productType);
  const caption = plain(element?.text, 2200) || null;
  const media = (element?.mediaUrls || [])
    .map((u) => metaMediaUrl(u))
    .filter((u): u is string => !!u)
    .slice(0, 10)
    .map((url) => ({ url, kind: /\.(mp4|mov|m4v|webm)(\?|$)/i.test(new URL(url).pathname) ? "video" as const : "image" as const }));
  const count = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null);
  const customer = person(customerOwner);
  const avatar = customer?.imageProfileUrl && metaMediaUrl(customer.imageProfileUrl);
  const postId = idOf(element?.id);

  return {
    external_id: cut(rootId, 200),
    contact: {
      external_id: cut(customerOwner, 200),
      name: nameOf(customerOwner),
      email: null,
      handle: instagram ? plain(customerOwner, 120) : null,
      avatar_url: avatar || null,
    },
    subject: cut(`${POST_KIND_LABEL[kind]}${caption ? ` · ${cut(caption.replace(/\s+/g, " "), 120)}` : ""}`, 300),
    platform_status: plain(t.status, 40) || null,
    via: "comment",
    external_updated_at: commentDate(t.lastUpdateTime),
    resolved,
    post: postId
      ? {
        external_id: cut(postId, 200), link, kind, product_type: productType, caption, media,
        comment_count: count(element?.commentCount), reaction_count: count(element?.reactionCount), owner_name: plain(element?.owner?.name, 200) || null,
      }
      : null,
    messages,
  };
}

// Resposta pública num comentário: o que impede a publicação (null se pode seguir). O alvo (objectId) e a rede vêm
// sempre da BD; uma nota interna nunca é publicada.
export function commentReplyProblem(r: { kind: string; channel: string; provider: string | undefined; objectId: string | null | undefined; body: string; uploads: number }): string | null {
  if (r.kind !== "outbound") return "Nota interna: nunca é publicada.";
  if (!isCommentChannel(r.channel)) return "Esta conversa não é de comentários: nada foi publicado.";
  if (!r.provider || !r.objectId || !/^[\w.:-]{1,200}$/.test(r.objectId)) return "Comentário de destino por identificar nesta conversa: nada foi publicado.";
  if (r.uploads > 0) return "Os comentários não levam anexos: nada foi publicado.";
  if (!r.body.trim()) return "Escreva o texto da resposta: nada foi publicado.";
  const max = COMMENT_MAX_CHARS[r.channel];
  if (r.body.length > max) return `Resposta demasiado longa para um comentário (máximo ${max} caracteres): nada foi publicado.`;
  return null;
}

// Avisos antes de publicar uma resposta pública: dados pessoais à vista de todos. Os contactos da própria loja
// (lojadoouro.pt) não contam.
export function publicReplyRisks(text: string): string[] {
  const risks: string[] = [];
  const emails = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter((e) => !/@lojadoouro\.pt$/i.test(e));
  if (emails.length) risks.push("um endereço de email");
  // Telefone português (9 algarismos, 2… fixo ou 91/92/93/96 móvel), com ou sem +351 e separadores.
  const phones = text.match(/(?:\+?351[\s.-]?)?(?<!\d)(?:\d[\s.-]?){8}\d(?!\d)/g) || [];
  if (phones.some((p) => /^(9[1236]|2)\d{7,8}$/.test(p.replace(/\D/g, "").replace(/^351(?=\d{9}$)/, "")) && p.replace(/\D/g, "").replace(/^351(?=\d{9}$)/, "").length === 9))
    risks.push("um número de telefone");
  if (/\b\d{4}-\d{3}\b/.test(text)) risks.push("um código postal");
  if (orderNumbersIn([text]).length) risks.push("um número de encomenda");
  if (/\b(nif|iban|cart[aã]o de cidad[aã]o)\b/i.test(text)) risks.push("dados de identificação ou pagamento");
  // Código de envio (CTT e transportadoras internacionais: duas letras, nove algarismos, duas letras).
  if (/\b[A-Z]{2}\d{9}[A-Z]{2}\b/.test(text)) risks.push("um código de envio");
  return risks;
}

// ---------------------------------------------------------------- páginas da listagem
// Uma página pedida à Metricool: estado HTTP (null sem resposta), tópicos e a ligação para a página seguinte.
export type CommentPage<T> = { status: number | null; data: T[]; next: string | null };
export type PageWalk = { pages: number; next: string | null; end: boolean; error: { status: number | null; first: boolean } | null };

// Só se segue paginação https dentro da própria API Metricool (ou um caminho relativo a ela).
export function metricoolNext(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2000) return null;
  try {
    const u = new URL(value, "https://app.metricool.com/api/");
    return u.protocol === "https:" && u.hostname === "app.metricool.com" ? value : null;
  } catch {
    return null;
  }
}

// Percorre as páginas: a 1.ª (atividade mais recente) e, com tempo, as seguintes a partir de onde a passagem anterior
// parou (resume). Cada página é entregue logo (onPage), para ficar gravada mesmo que a passagem pare a meio.
// - 1.ª página: espera fixa; uma falha é erro da passagem (error.first).
// - Seguintes: a espera cabe no orçamento; uma falha (sem resposta, 5xx, 429) só pára aqui e devolve a mesma página
//   para a passagem seguinte. 401/403 são erro (acesso recusado). Um ponto de continuação que já não existe
//   (400/404/410) é largado: a leitura recomeça do início.
// end: a lista chegou ao fim (sem página seguinte que se possa seguir).
export async function walkPages<T>(o: {
  fetchPage: (next: string | null, timeoutMs: number) => Promise<CommentPage<T>>;
  maxPages: number; deadline: number; now: () => number; resume?: string | null; onPage?: (page: T[]) => Promise<void>;
}): Promise<PageWalk> {
  let next: string | null = null;
  let pages = 0;
  let resumed = false;
  let end = false;
  const resume = metricoolNext(o.resume);
  do {
    const continuation = pages > 0;
    const timeout = continuation ? Math.max(10_000, Math.min(40_000, o.deadline - o.now() - 5_000)) : 40_000;
    const r = await o.fetchPage(next, timeout);
    if (r.status !== 200) {
      if (!continuation || r.status === 401 || r.status === 403) return { pages, next: null, end: false, error: { status: r.status, first: !continuation } };
      if (resumed && pages === 1 && (r.status === 400 || r.status === 404 || r.status === 410)) next = null;
      return { pages, next, end: false, error: null };
    }
    if (o.onPage) await o.onPage(r.data);
    next = metricoolNext(r.next);
    end = !next;
    pages++;
    if (pages === 1 && next && resume && !resumed) {
      next = resume;
      resumed = true;
    }
  } while (next && pages < o.maxPages && o.now() < o.deadline - 15_000);
  return { pages, next: end ? null : next, end, error: null };
}

// Leitura completa da lista (todas as páginas, ao longo de várias passagens) no máximo de 6 em 6 horas; entre elas,
// cada passagem lê só a 1.ª página (a atividade mais recente). firstPageOnly (Verificar, Não foi enviada): só a 1.ª
// página, sem mexer na leitura completa em curso.
export const FULL_READ_EVERY_MS = 6 * 3_600_000;
export function commentReadPlan(cursor: Record<string, unknown>, now: number, firstPageOnly = false) {
  const fullAt = typeof cursor.full_read_at === "string" ? Date.parse(cursor.full_read_at) : NaN;
  const walking = !firstPageOnly && !(Number.isFinite(fullAt) && now - fullAt < FULL_READ_EVERY_MS);
  return { walking, maxPages: walking ? 5 : 1, resume: walking ? metricoolNext(cursor.next) : null };
}
// Cursor depois da passagem: guarda onde a leitura completa parou; ao chegar ao fim, fica feita.
export function commentCursorAfter(cursor: Record<string, unknown>, walking: boolean, walk: { next: string | null; end: boolean }, now: number) {
  const out: Record<string, unknown> = { ...cursor };
  if (walking) {
    if (walk.end) {
      delete out.next;
      out.full_read_at = new Date(now).toISOString();
    } else if (walk.next) out.next = walk.next;
    else delete out.next;
  }
  return { cursor: out, importing: walking && !walk.end };
}
