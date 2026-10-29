// Apoio ao Cliente: tipos e regras partilhados entre servidor e browser (sem segredos nem I/O).

export type Status = "novo" | "em_atendimento" | "aguarda_cliente" | "resolvido";
export type Channel = "zendesk" | "facebook" | "instagram" | "facebook_comments" | "instagram_comments" | "whatsapp" | "site" | "email";
export type Kind = "inbound" | "outbound" | "note";
export type Delivery = "sending" | "accepted" | "delivered" | "read" | "failed" | "uncertain";

export const STATUSES: Status[] = ["novo", "em_atendimento", "aguarda_cliente", "resolvido"];
export const STATUS_LABEL: Record<Status, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  aguarda_cliente: "A aguardar cliente",
  resolvido: "Resolvido",
};
export const CHANNEL_LABEL: Record<Channel, string> = {
  zendesk: "Zendesk",
  facebook: "Facebook",
  instagram: "Instagram",
  facebook_comments: "Comentários Facebook",
  instagram_comments: "Comentários Instagram",
  whatsapp: "WhatsApp",
  site: "Chat do site",
  email: "Email",
};
// Conversa no Gmail (web), aberta já na conta da caixa do apoio.
export function gmailThreadLink(mailbox: string, threadId: string) {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${encodeURIComponent(threadId)}`;
}

export const DELIVERY_LABEL: Record<Delivery, string> = {
  sending: "A enviar",
  accepted: "Aceite pela plataforma",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  uncertain: "Resultado incerto",
};

// Zendesk é a fonte de verdade do estado dos seus tickets. "hold" (em espera) continua em atendimento.
export function fromZendeskStatus(s: string | null | undefined): Status {
  switch (s) {
    case "new":
      return "novo";
    case "pending":
      return "aguarda_cliente";
    case "solved":
    case "closed":
      return "resolvido";
    default:
      return "em_atendimento";
  }
}

// O Zendesk não aceita voltar a "new"; "Novo" no dashboard equivale a reabrir (open).
export function toZendeskStatus(s: Status): "open" | "pending" | "solved" {
  return s === "aguarda_cliente" ? "pending" : s === "resolvido" ? "solved" : "open";
}

// Regra explícita de reabertura (conversas cujo estado pertence ao dashboard; espelha ldo_support_ingest):
// mensagem nova do cliente em "Resolvido" → "Novo" sem responsável, "Em atendimento" com responsável;
// em "A aguardar cliente" → "Em atendimento"; nos restantes estados nada muda.
// rating: a mensagem foi tratada como resposta a um pedido de avaliação (ldo_private.support_take_rating: só a nota, as
// estrelas ou «não»). Não reabre; só uma nota de 1 ou 2 numa conversa resolvida a devolve a "Novo", sem responsável,
// para acompanhamento. Uma nota seguida de texto não é tratada aqui (rating null): reabre como qualquer mensagem.
export function statusAfterCustomerMessage(status: Status, hasAssignee: boolean, rating: { score: number | null } | null = null): Status {
  if (rating) return rating.score !== null && rating.score <= 2 && status === "resolvido" ? "novo" : status;
  if (status === "resolvido") return hasAssignee ? "em_atendimento" : "novo";
  if (status === "aguarda_cliente") return "em_atendimento";
  return status;
}

// Espera depois de erros (espelha ldo_support_sync_finish): dobra a cada falha, até 30 minutos,
// e nunca antes do Retry-After indicado pela plataforma.
export function backoffSeconds(pollSeconds: number, failures: number, retryAfter = 0) {
  return Math.max(Math.min(pollSeconds * 2 ** Math.min(failures, 6), 1800), retryAfter);
}

// Resultado de um envio a partir da resposta HTTP. Sem resposta (tempo esgotado, rede) ou erro do
// servidor da plataforma, o pedido pode ter sido aceite: fica "incerto" e nunca é repetido sozinho.
export function sendOutcome(status: number | null): Extract<Delivery, "accepted" | "failed" | "uncertain"> {
  if (status === null || status >= 500 || status === 408) return "uncertain";
  if (status >= 200 && status < 300) return "accepted";
  return "failed";
}

// Meta #551 ("This person isn't available right now" / "isn't receiving messages from you right now"): a pessoa
// bloqueou a página, deixou de aceitar mensagens da empresa ou desativou a conta (a Meta não diz qual). Nada foi
// enviado e repetir não resolve; só uma mensagem nova do cliente volta a abrir a conversa.
const META_UNREACHABLE = /\((?:Meta )?#551\)|isn\W{0,6}t (?:available|receiving messages from you) right now/i;
export function metaSendRefusal(raw: string | null | undefined, network: "Messenger" | "Instagram"): string | null {
  if (!raw || !META_UNREACHABLE.test(raw)) return null;
  return `Não enviada: o ${network} não aceita mensagens nossas para esta pessoa (Meta #551). Pode ter bloqueado a página, `
    + "deixado de aceitar as nossas mensagens ou desativado a conta; a Meta não diz qual. Voltar a enviar não resolve. Se o cliente "
    + "deixou telefone ou email na conversa, contacte-o por aí (o endereço …@facebook.com do perfil não é um email real). Se não, "
    + "só é possível responder quando voltar a escrever.";
}
// A Meta recusou uma resposta com #551 e, desde então, nada mostra que a pessoa voltou a estar contactável (uma
// mensagem dela, ou uma nossa que passou, por exemplo enviada no Meta Business Suite): não vale a pena tentar outra vez.
export function metaUnreachable(messages: { kind: string; delivery: string | null; delivery_detail: string | null; created_at: string }[]): boolean {
  const t = (m: { created_at: string }) => Date.parse(m.created_at) || 0;
  const reached = Math.max(0, ...messages.filter((m) => m.kind === "inbound"
    || (m.kind === "outbound" && (m.delivery == null || m.delivery === "accepted" || m.delivery === "delivered" || m.delivery === "read"))).map(t));
  return messages.some((m) => m.kind === "outbound" && m.delivery === "failed" && t(m) > reached && META_UNREACHABLE.test(m.delivery_detail || ""));
}

// Falhas do lado da Metricool, explicadas à equipa sem o texto técnico (o #551 continua em metaSendRefusal):
// - connection: a Metricool não encontra a ligação da rede na marca (UserConnection, com a autorização da Meta) para
//   o utilizador da API e responde com o erro do Java ("Cannot invoke …UserConnection.getAccessToken() because
//   "connection" is null", HTTP 400) antes de falar com a Meta: nada saiu e repetir não resolve até religar a rede;
// - token: a Meta anulou a autorização da Metricool (#190);
// - internal: outro erro interno do servidor da Metricool (NullPointerException), sem código da Meta. As outras exceções
//   do Java (IllegalArgumentException: texto demasiado longo…) costumam dizer o motivo: ficam com o texto original.
// 401/403 (acesso recusado) e 429 (limite de pedidos) têm o seu texto em failure(), igual no envio e na sincronização.
// O texto tem de caber em delivery_detail e em last_error (500 caracteres, com o "Conversas X: " de quem chama).
export type MetricoolFaultKind = "connection" | "token" | "internal";
export type MetricoolFault = { kind: MetricoolFaultKind; text: string };
// Rede de um provider da Metricool (o Instagram ligado pelo login do Instagram é INSTAGRAMBUSINESS).
export const metricoolNetwork = (provider?: string | null): "Facebook" | "Instagram" => (/^INSTAGRAM/i.test(provider || "") ? "Instagram" : "Facebook");
// Também apanha o texto cortado aos 160 caracteres ("…UserConnection.getAcce") e a variante sem "java.lang".
const MC_CONNECTION = /\buserconnection\b|\.getAccessToken\(\)|\bconnection\\?"?\s+is\s+null/i;
const MC_TOKEN = /\(#190\)|Error validating access token|session has been invalidated/i;
const MC_INTERNAL = /\bNullPointerException\b|Cannot invoke\s+\\?"[\w.$]+\(/i;
export function metricoolFault(raw: string | null | undefined, network: "Facebook" | "Instagram", where: "envio" | "comentario" | "sincronizacao",
  status?: number | null): MetricoolFault | null {
  if (!raw || META_UNREACHABLE.test(raw) || status === 401 || status === 403 || status === 429) return null;
  // Um erro com código da Meta (#100, #10…) fica com o texto original: diz mais do que "erro interno".
  const kind: MetricoolFaultKind | null = MC_CONNECTION.test(raw) ? "connection" : MC_TOKEN.test(raw) ? "token"
    : !/\(#\d+\)/.test(raw) && MC_INTERNAL.test(raw) ? "internal" : null;
  if (!kind) return null;
  const http = status ? `, HTTP ${status}` : "";
  const sync = where === "sincronizacao";
  const again = where === "comentario" ? "republicar" : "reenviar";
  if (kind === "internal") {
    // Só o nome da exceção (letras), nunca o resto do texto da Metricool ("Cannot invoke … is null" é uma NullPointerException).
    const name = /\b([A-Z][A-Za-z]{2,50}(?:Exception|Error))\b/.exec(raw)?.[1] || "NullPointerException";
    // Um 4xx fica "Falhou" (sendOutcome): nada saiu. Sem resposta ou 5xx seria "Sem confirmação": confirmar antes de repetir.
    const failed = status != null && status >= 400 && status < 500 && status !== 408;
    const next = sync ? "A sincronização volta a tentar sozinha"
      : failed ? `${where === "comentario" ? "Nada foi publicado" : "Nada foi enviado ao cliente"}; pode tentar outra vez`
      : `Confirme no Meta Business Suite se ${where === "comentario" ? "a resposta ficou publicada" : "chegou ao cliente"} antes de ${again}`;
    return { kind, text: `${sync ? "erro" : "Erro"} interno da Metricool (${name}). ${next}; se repetir, avise a Metricool com a hora. (Ref. Metricool: ${name}${http})` };
  }
  const prefix = where === "envio" ? "Não enviada: " : where === "comentario" ? "Não publicada: " : "";
  const meanwhile = sync ? "Sem ela não entram mensagens novas nem saem respostas; responda no Meta Business Suite."
    : `${where === "comentario" ? "Nada foi publicado" : "Nada chegou ao cliente"} e ${again} não resolve até a ligação ser reposta; responda no Meta Business Suite.`;
  const how = `na mesma marca, com a conta do token da API e um perfil com controlo total da página${network === "Instagram" ? " (Instagram através do Facebook)" : ""}`;
  // Ligação em falta: a causa pode estar na conta Metricool (quem ligou a rede, em que marca) ou num erro da Metricool, e
  // voltar a ligar não resolveu da primeira vez (28-10-2026): verificar e confirmar com a Metricool antes de religar.
  return kind === "connection"
    ? { kind, text: `${prefix}a Metricool não encontra, para o utilizador do token da API, a ligação do ${network} nesta marca. ${meanwhile} Quem gere a Metricool: ver Configuração → Validar ligações e confirmar com a Metricool; se religar, ${how}. (Ref. Metricool: UserConnection nula${http})` }
    : { kind, text: `${prefix}a Meta deixou de aceitar a autorização da Metricool para o ${network} (sessão expirada ou anulada, por exemplo por mudança de palavra-passe ou perda de acesso à página). ${meanwhile} Para repor: religar o ${network} ${how}. (Ref. Meta #190)` };
}
// Erros da Metricool gravados antes desta explicação ("Envio: Metricool recusou o pedido (HTTP 400 · {…})"): mostrados
// com o mesmo texto. Os restantes ficam como estão.
export function metricoolDetail(detail: string | null | undefined, network: "Facebook" | "Instagram"): string | null {
  const m = /^([^:()]{1,80}): Metricool recusou o pedido \(HTTP (\d{3})/.exec(detail || "");
  if (!m) return detail ?? null;
  const where = m[1] === "Envio" ? "envio" : m[1] === "Resposta pública" ? "comentario" : "sincronizacao";
  const fault = metricoolFault(detail, network, where, Number(m[2]));
  return !fault ? detail ?? null : where === "sincronizacao" ? `${m[1]}: ${fault.text}` : fault.text;
}

// Cursor de uma fonte Metricool para a marca (blogId) em uso. Noutra marca (de "Loja do Ouro Jericó" 2912472 para
// "Loja do Ouro" 7708381, 29-10-2026), a conta da marca nas conversas, a paginação e a leitura completa eram da marca
// anterior: começa do zero e volta a detetar. Sem marca no cursor, vale a da fonte (account, onde foi criada).
export function metricoolCursor(cursor: Record<string, unknown>, account: string | null | undefined, blogId: string): Record<string, unknown> {
  const previous = typeof cursor.blog === "string" ? cursor.blog : account || null;
  return !previous || previous === blogId ? { ...cursor, blog: blogId } : { blog: blogId };
}

// Marca da Metricool (lista de marcas do token, /admin/simpleProfiles) só com os campos que ajudam a perceber a
// ligação: ids numéricos, nome da marca, página de Facebook (id), se há Instagram e como está ligado, se há perfil de
// Facebook a ligar (sim/não) e o papel do utilizador da API. Logins, emails, hashes, imagens, ligações de white label e
// ids de perfis pessoais nunca passam.
export type SafeBrand = {
  id: number; label: string | null; userId: number | null; ownerUserId: number | null; isShared: boolean | null; deleted: boolean | null;
  firstConnectionDate: string | null; facebookPageId: string | null; instagram: boolean; instagramConnectionType: "BUSINESS" | "FACEBOOK_LOGIN" | null;
  // Permissões do papel: null quando a Metricool não as indica (por exemplo, o dono da marca sem "actions").
  fbUserId: boolean; role: { name: string | null; viewInbox: boolean | null; fullAccessInbox: boolean | null; viewAnalytics: boolean | null } | null;
};
const mcInt = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : null);
const mcBool = (v: unknown) => (typeof v === "boolean" ? v : null);
const mcSet = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : typeof v === "number");
export function safeMetricoolBrand(raw: unknown): SafeBrand | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const id = mcInt(b.id);
  if (id === null) return null;
  const label = typeof b.label === "string" ? b.label.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) || null : null;
  const when = typeof b.firstConnectionDate === "string" || typeof b.firstConnectionDate === "number" ? new Date(b.firstConnectionDate) : null;
  const page = typeof b.facebookPageId === "string" || typeof b.facebookPageId === "number" ? String(b.facebookPageId).trim() : "";
  const role = b.brandRole && typeof b.brandRole === "object" ? (b.brandRole as { name?: unknown; actions?: Record<string, unknown> | null }) : null;
  const can = (k: string) => (role?.actions && typeof role.actions[k] === "boolean" ? (role.actions[k] as boolean) : null);
  return {
    id, label, userId: mcInt(b.userId), ownerUserId: mcInt(b.ownerUserId), isShared: mcBool(b.isShared), deleted: mcBool(b.deleted),
    firstConnectionDate: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
    facebookPageId: /^\d{1,30}$/.test(page) ? page : null,
    instagram: mcSet(b.instagram),
    instagramConnectionType: b.instagramConnectionType === "BUSINESS" || b.instagramConnectionType === "FACEBOOK_LOGIN" ? b.instagramConnectionType : null,
    fbUserId: mcSet(b.fbUserId),
    role: role ? {
      name: typeof role.name === "string" && /^[\p{L}\p{N} ._-]{1,40}$/u.test(role.name) ? role.name : null,
      viewInbox: can("viewInbox"), fullAccessInbox: can("fullAccessInbox"), viewAnalytics: can("viewAnalytics"),
    } : null,
  };
}

// O que a verificação da ligação da marca encontrou ("Validar ligações"), por ordem: erros, depois avisos. Só ids,
// estados e datas; nunca texto da Metricool. Uma fonte pode sincronizar sem erros e não receber nada (Facebook, 28-10-2026):
// - listed: conversas lidas na lista da Metricool (normalmente perto de 100); 0 com as autorizações OK quer dizer
//   que a Metricool não está a ler a rede;
// - lastInbound: a última mensagem de um cliente guardada de cada rede; só dá aviso passadas 24 h e se a sincronização
//   continuou a funcionar durante esse tempo (lastSuccess), para não avisar todas as manhãs.
export type InboxProbe = { status: number | null; allowAccessToMessages?: boolean; missingScopes?: string[]; fault?: MetricoolFaultKind | null };
export type BrandFinding = { level: "ok" | "aviso" | "erro"; text: string };
const STALE_INBOUND_MS = 24 * 3_600_000;
export function metricoolBrandFindings(input: {
  account: { userId: string; blogId: string };
  brands: SafeBrand[] | null; brandsStatus?: number | null;
  expected: { facebookPageId: string | null };
  inbox: Partial<Record<"FACEBOOK" | "INSTAGRAM" | "INSTAGRAMBUSINESS", InboxProbe>>;
  listed?: Partial<Record<"FACEBOOK" | "INSTAGRAM", number | null>>;
  lastInbound?: Partial<Record<"Facebook" | "Instagram", string | null>>;
  lastSuccess?: Partial<Record<"Facebook" | "Instagram", string | null>>;
  now: Date;
}): BrandFinding[] {
  const out: BrandFinding[] = [];
  const erro = (text: string) => out.push({ level: "erro", text });
  const aviso = (text: string) => out.push({ level: "aviso", text });
  const { account, brands, expected, inbox } = input;
  const named = (b: SafeBrand) => `${b.id}${b.label ? ` «${b.label}»` : ""}`;
  const brand = brands?.find((b) => String(b.id) === account.blogId) || null;
  if (!brands) aviso(`A lista de marcas da Metricool não respondeu (${input.brandsStatus == null ? "sem resposta" : `HTTP ${input.brandsStatus}`}): não foi possível confirmar a marca ${account.blogId}.`);
  else if (!brand) erro(`A marca ${account.blogId} não aparece nas marcas do utilizador Metricool ${account.userId}: foi apagada, mudou de dono ou o token é de outro utilizador.`);
  else {
    if (brand.deleted) erro(`A marca ${named(brand)} está apagada na Metricool.`);
    const owner = brand.ownerUserId ?? brand.userId;
    if (owner !== null && String(owner) !== account.userId)
      aviso(`A marca é do utilizador Metricool ${owner}${brand.isShared ? " (partilhada)" : ""}; o dashboard usa o userId ${account.userId}. As redes têm de estar ligadas na marca que a API usa: confirmar com a Metricool que utilizador e token usar.`);
    if (brand.role?.fullAccessInbox === false) erro(`O papel do utilizador da API nesta marca${brand.role.name ? ` (${brand.role.name})` : ""} não dá acesso total à Caixa de entrada.`);
    if (brand.role?.viewAnalytics === false) aviso(`O papel do utilizador da API nesta marca${brand.role.name ? ` (${brand.role.name})` : ""} não dá acesso às Analytics.`);
    if (!brand.facebookPageId) erro("A marca não tem página de Facebook ligada na Metricool.");
    else if (expected.facebookPageId && brand.facebookPageId !== expected.facebookPageId)
      erro(`A página de Facebook ligada à marca (${brand.facebookPageId}) não é a das conversas guardadas (${expected.facebookPageId}): a religação foi feita com outra página.`);
    if (!brand.instagram) erro("A marca não tem conta de Instagram ligada na Metricool.");
    else if (brand.instagramConnectionType === "BUSINESS")
      aviso("O Instagram está ligado pelo login do Instagram (BUSINESS): a Inbox deve esperar INSTAGRAMBUSINESS e o dashboard usa INSTAGRAM. Religar o Instagram através do Facebook (recomendado) ou confirmar com a Metricool.");
    if (brand.facebookPageId && !brand.fbUserId) aviso("A marca não indica o perfil de Facebook que autorizou a ligação: pode faltar a autorização; voltar a ligar o Facebook na marca.");
  }
  // Outra marca com a mesma página: a religação pode ter ficado lá.
  const page = brand?.facebookPageId || expected.facebookPageId;
  for (const b of (brands || []).filter((x) => x.id !== brand?.id && page && x.facebookPageId === page).slice(0, 5))
    aviso(`A marca ${named(b)} também tem a página de Facebook ${page}: confirmar em que marca ficou a ligação.`);
  for (const p of ["FACEBOOK", "INSTAGRAM"] as const) {
    const r = inbox[p];
    const net = metricoolNetwork(p);
    if (!r || (r.status === 200 && r.allowAccessToMessages !== false)) {
      if (input.listed?.[p] === 0)
        erro(`Inbox ${p}: a Metricool responde sem erro mas devolve 0 conversas do ${net} (normalmente perto de 100): não está a ler as mensagens desta rede. Confirmar na Caixa de entrada da Metricool.`);
      continue;
    }
    if (r.status === 200) {
      const scopes = (r.missingScopes || []).filter((s) => /^[\w.:-]{1,60}$/.test(s)).slice(0, 10);
      erro(`Inbox ${p}: a Metricool não tem acesso às mensagens do ${net}${scopes.length ? ` (em falta: ${scopes.join(", ")})` : ""}. Voltar a ligar a rede e aceitar todas as permissões.`);
    } else if (r.fault === "connection") erro(`Inbox ${p}: a Metricool não encontra a ligação do ${net} na marca (UserConnection nula) para o utilizador do token da API. Confirmar com a Metricool; se religar, fazê-lo na mesma marca, com a conta do token da API.`);
    else if (r.status === 401 || r.status === 403) erro(`Inbox ${p}: a Metricool recusou o acesso (HTTP ${r.status}): o utilizador da API não tem acesso à Caixa de entrada desta marca, ou o plano deixou de incluir a API.`);
    else if (r.fault === "token") erro(`Inbox ${p}: a Meta anulou a autorização da Metricool (#190). Voltar a ligar o ${net} com um perfil com controlo total da página.`);
    else erro(`Inbox ${p}: a Metricool não respondeu como esperado (${r.status === null ? "sem resposta" : `HTTP ${r.status}`}).`);
  }
  const ib = inbox.INSTAGRAMBUSINESS;
  if (ib?.status === 200 && ib.allowAccessToMessages && inbox.INSTAGRAM && inbox.INSTAGRAM.status !== 200)
    aviso("A Inbox responde como INSTAGRAMBUSINESS mas não como INSTAGRAM: o Instagram pode ter sido religado pelo login do Instagram. O dashboard continua em INSTAGRAM; não mudar sem confirmar com a Metricool (as conversas podem ter outros ids).");
  const fmt = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  for (const net of ["Facebook", "Instagram"] as const) {
    const at = Date.parse(input.lastInbound?.[net] || "");
    const ok = Date.parse(input.lastSuccess?.[net] || "");
    if (Number.isFinite(at) && input.now.getTime() - at > STALE_INBOUND_MS && (!Number.isFinite(ok) || ok - at > STALE_INBOUND_MS))
      aviso(`Nenhuma mensagem nova do ${net} desde ${fmt.format(new Date(at))} (mais de 24 h, com a sincronização a funcionar): se costumam chegar várias por dia, a Metricool não está a entregar mensagens novas (confirmar na Caixa de entrada da Metricool).`);
  }
  if (!out.length) return [{ level: "ok", text: "Marca, página de Facebook, Instagram e autorizações da Inbox como esperado." }];
  return [...out.filter((f) => f.level === "erro"), ...out.filter((f) => f.level === "aviso")];
}

// Canais do Zendesk em que uma resposta pública pela API segue por email (notificações do Zendesk).
// Nos outros (mensagens, redes sociais, WhatsApp no Zendesk) a entrega tem de ser validada.
const ZENDESK_EMAIL_LIKE = new Set(["email", "web", "api", "mobile", "web_service", "web_form", "sample_ticket"]);
export function zendeskReplyWarning(via: string | null | undefined): string {
  const base = "Aceite pelo Zendesk não significa entregue: o cliente só recebe se as notificações do Zendesk estiverem ativas para este canal.";
  if (!via || ZENDESK_EMAIL_LIKE.has(via)) return base;
  return `${base} Este ticket veio do canal “${via}”, em que respostas pela API podem não chegar ao cliente — validar com um ticket de teste.`;
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as string[]).includes(v);
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Texto simples a partir de HTML recebido: nunca se apresenta HTML de terceiros no dashboard.
export function plainText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Anexos que o browser pode mostrar em linha; os restantes são sempre descarregados.
export const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// Chave de cifra dos tokens: só 32 bytes aleatórios em base64 (44 caracteres, o resultado do comando
// do README). Frases, o próprio comando ou valores mal copiados são recusados: uma chave previsível
// tornaria a cifra inútil.
export function keyProblem(value: string | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return "SUPPORT_ENCRYPTION_KEY em falta.";
  if (/\s|require\(|console\.|randomBytes/.test(raw))
    return "SUPPORT_ENCRYPTION_KEY contém o comando em vez do resultado: corra o comando e cole só a linha que ele mostra (44 caracteres).";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) return "SUPPORT_ENCRYPTION_KEY inválida: tem de ser 32 bytes aleatórios em base64 (44 caracteres, termina em =).";
  return null;
}

// Tipo real de um ficheiro pelos primeiros bytes (assinaturas WHATWG mimesniff). O tipo declarado pelo
// remetente nunca chega para mostrar um ficheiro em linha: se não coincidir, é tratado como "outro".
export function sniffType(b: Uint8Array): string | null {
  const at = (offset: number, ...bytes: number[]) => bytes.every((x, i) => b[offset + i] === x);
  const ascii = (offset: number, text: string) => [...text].every((ch, i) => b[offset + i] === ch.charCodeAt(0));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  for (let i = 0; i <= Math.min(b.length - 5, 1019); i++) if (ascii(i, "%PDF-")) return "application/pdf";
  if (ascii(4, "ftyp")) return ascii(8, "M4A ") ? "audio/mp4" : ascii(8, "qt  ") ? "video/quicktime" : "video/mp4";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return "audio/mpeg";
  return null;
}

// Como o dashboard mostra cada tipo: imagens, PDF, vídeo e áudio em pré-visualização; o resto descarrega.
export type PreviewKind = "image" | "pdf" | "video" | "audio" | "file";
export function previewKind(type: string | null | undefined): PreviewKind {
  const t = (type || "").split(";")[0].trim().toLowerCase();
  if (INLINE_TYPES.has(t)) return "image";
  if (t === "application/pdf") return "pdf";
  if (["video/mp4", "video/webm", "video/quicktime"].includes(t)) return "video";
  if (["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/aac", "audio/webm"].includes(t)) return "audio";
  return "file";
}

// Responsável da conversa (espelha ldo_support_set_local / ldo_support_begin_send). Só o responsável
// responde ao cliente; sem responsável, quem responde primeiro fica com a conversa. Notas internas: todos.
export type Ownership = { assigneeId: string | null; me: string; isSuper: boolean };
export const canReply = (o: Ownership) => !o.assigneeId || o.assigneeId === o.me;
export const canChangeStatus = (o: Ownership) => o.isSuper || !o.assigneeId || o.assigneeId === o.me;
export const canTransfer = (o: Ownership) => Boolean(o.assigneeId) && (o.isSuper || o.assigneeId === o.me);

export type AssignKind = "claim" | "assign" | "transfer" | "release";
// Mudança de responsável pedida (target null = deixar sem responsável). Devolve o tipo ou o motivo da recusa.
export function assignmentChange(o: Ownership, target: string | null, ownerName = "o responsável"): { kind: AssignKind | null } | { error: string } {
  if (target === o.assigneeId) return { kind: null };
  if (target === null) return o.isSuper ? { kind: "release" } : { error: "Só o Super Admin pode deixar uma conversa sem responsável. Para a passar a um colega, use Transferir." };
  if (!o.assigneeId) {
    if (target === o.me) return { kind: "claim" };
    return o.isSuper ? { kind: "assign" } : { error: "Só se pode atribuir a si próprio uma conversa sem responsável. Assuma-a e depois transfira-a." };
  }
  return canTransfer(o) ? { kind: "transfer" } : { error: `Esta conversa está com ${ownerName}. Só essa pessoa (ou o Super Admin) a pode transferir.` };
}

// Primeiro nome (o que o cliente vê no chat do site): nunca o nome completo nem o nome de utilizador.
export function firstName(fullName: string | null | undefined): string | null {
  const first = (fullName || "").trim().split(/\s+/)[0];
  return first || null;
}

// Primeiro nome do cliente nos textos automáticos (pedido de avaliação, emails do chat do site): só uma palavra de 2 a
// 30 letras (com apóstrofo ou hífen pelo meio). Um nome de perfil com emoji, números, pontuação ou uma ligação dá "":
// o texto segue sem nome ("Olá!").
export function safeFirstName(raw: string | null | undefined): string {
  const first = (raw || "").trim().split(/\s+/)[0] || "";
  return /^[\p{L}][\p{L}'-]{1,29}$/u.test(first) ? first : "";
}

// Histórico visível (configuração do apoio, por omissão 1 de setembro de 2026): numa conversa antiga que voltou a ter
// atividade, as mensagens anteriores à data ficam recolhidas no ecrã e fora da IA. Sem data válida, conta tudo.
export function visibleSince<T extends { created_at: string }>(messages: T[], from: string | null | undefined): T[] {
  const t = from ? Date.parse(from) : NaN;
  if (Number.isNaN(t)) return messages;
  return messages.filter((m) => !(Date.parse(m.created_at) < t));
}

// A conversa no ecrã (mensagens e mudanças de responsável, por ordem de hora) dividida pela mesma data: tudo o que é
// anterior fica junto atrás do separador, para a ordem de hora não se perder ao abrir.
export function historySplit<T extends { at: string }>(rows: T[], from: string | null | undefined): { older: T[]; rest: T[] } {
  const t = from ? Date.parse(from) : NaN;
  if (Number.isNaN(t)) return { older: [], rest: rows };
  const old = (r: T) => Date.parse(r.at) < t;
  return { older: rows.filter(old), rest: rows.filter((r) => !old(r)) };
}

// "1 de setembro de 2026" (dia de Lisboa).
export function historyDateLabel(from: string | null | undefined): string | null {
  const t = from ? Date.parse(from) : NaN;
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "numeric", month: "long", year: "numeric" }).format(new Date(t));
}

// Números de encomenda que o cliente escreveu ("#12345", "encomenda nº 12345", "encomenda 12345"), sem repetir.
export function orderNumbersIn(texts: string[]) {
  const found = new Set<string>();
  const re = /(?:#\s?|\bencomenda\s*(?:n\.?\s*º|nº|n\.|número|numero|nr\.?)?\s*#?\s*)(\d{4,7})\b/gi;
  for (const t of texts) for (let m = re.exec(t); m; m = re.exec(t)) found.add(m[1]);
  return [...found].slice(0, 6);
}

// Chat do site: a marca segue o domínio, que a Shopify escolhe pelo país do cliente (Loja do Ouro em lojadoouro.pt,
// mercado Portugal; Gold Store Premium em goldstorepremium.com, mercados Internacional e Espanha), em qualquer
// língua. Visitantes sem estes dados (anteriores às línguas) contam como Loja do Ouro, em português.
export type SiteKey = "ldo" | "gsp";
export type SiteLocale = "pt" | "en" | "es" | "fr" | "de";
export const SITE_LOCALES: SiteLocale[] = ["pt", "en", "es", "fr", "de"];
export const SITE_BRAND: Record<SiteKey, { brand: string; domain: string; origin: string; roots: Partial<Record<SiteLocale, string>> }> = {
  ldo: { brand: "Loja do Ouro", domain: "lojadoouro.pt", origin: "https://www.lojadoouro.pt", roots: { pt: "/", en: "/en/", es: "/es/", fr: "/fr/", de: "/de/" } },
  // Inglês na raiz; sem francês nem alemão publicados (ficam na raiz).
  gsp: { brand: "Gold Store Premium", domain: "goldstorepremium.com", origin: "https://www.goldstorepremium.com", roots: { en: "/", es: "/es/", pt: "/pt-pt/" } },
};
export const LOCALE_LABEL: Record<SiteLocale, string> = { pt: "português", en: "inglês", es: "espanhol", fr: "francês", de: "alemão" };

// Página inicial do site na língua do cliente (ex.: https://www.goldstorepremium.com/es/).
export function siteRootUrl(site: SiteKey, locale: SiteLocale) {
  return SITE_BRAND[site].origin + (SITE_BRAND[site].roots[locale] || "/");
}

// Ligação da loja no site e na língua do cliente (o catálogo dá sempre www.lojadoouro.pt, em português): o
// prefixo de língua do endereço original sai. Outras ligações ficam iguais.
export function siteLink(url: string, site: SiteKey, locale: SiteLocale) {
  const m = /^https?:\/\/(?:www\.)?lojadoouro\.pt(?=[/?#]|$)\/?(?:(?:pt|en|es|fr|de)(?:-[a-z]{2})?(?=[/?#]|$)\/?)?/i.exec(url);
  return m ? siteRootUrl(site, locale) + url.slice(m[0].length) : url;
}

const asLocale = (v: unknown) => {
  const l = typeof v === "string" ? v.trim().toLowerCase().slice(0, 2) : "";
  return SITE_LOCALES.includes(l as SiteLocale) ? (l as SiteLocale) : null;
};

// Marca, língua e país do visitante. Com o servidor atualizado vêm da BD (língua vazia = português); sem eles
// (servidor anterior, ou dados do visitante indisponíveis) deduzem-se da página e da conta da conversa
// ('goldstorepremium.com' na Gold Store Premium): domínio para a marca, prefixo do endereço para a língua.
export function visitorSite(v: { site?: unknown; locale?: unknown; country?: unknown; page_url?: string | null } | null | undefined, account?: string | null): {
  site: SiteKey; locale: SiteLocale; country: string | null;
} {
  const country = typeof v?.country === "string" && /^[A-Z]{2}$/.test(v.country) ? v.country : null;
  if (v?.site === "ldo" || v?.site === "gsp") return { site: v.site, locale: asLocale(v.locale) || "pt", country };
  let url: URL | null = null;
  try {
    url = v?.page_url ? new URL(v.page_url) : null;
  } catch {
    url = null;
  }
  const site: SiteKey = (url && /(^|\.)goldstorepremium\.com$/i.test(url.hostname)) || account === "goldstorepremium.com" ? "gsp" : "ldo";
  const prefix = url && /^\/(en|es|fr|de|pt-pt)(\/|$)/i.exec(url.pathname)?.[1];
  return { site, locale: asLocale(v?.locale) || asLocale(prefix) || (site === "gsp" ? "en" : "pt"), country };
}
