// Apoio ao Cliente: tipos e regras partilhados entre servidor e browser (sem segredos nem I/O).

export type Status = "novo" | "em_atendimento" | "aguarda_cliente" | "resolvido";
export type Channel = "zendesk" | "facebook" | "instagram" | "whatsapp" | "site" | "email";
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
export function statusAfterCustomerMessage(status: Status, hasAssignee: boolean): Status {
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

// Números de encomenda que o cliente escreveu ("#12345", "encomenda nº 12345", "encomenda 12345"), sem repetir.
export function orderNumbersIn(texts: string[]) {
  const found = new Set<string>();
  const re = /(?:#\s?|\bencomenda\s*(?:n\.?\s*º|nº|n\.|número|numero|nr\.?)?\s*#?\s*)(\d{4,7})\b/gi;
  for (const t of texts) for (let m = re.exec(t); m; m = re.exec(t)) found.add(m[1]);
  return [...found].slice(0, 6);
}
