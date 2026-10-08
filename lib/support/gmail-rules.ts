import { randomBytes } from "crypto";
import { htmlToText } from "./ai-rules";

// Regras da caixa de email do apoio (Gmail API) que não dependem do servidor (testadas em tests/gmail-rules.cjs).

// Formato "full" de users.messages.get: body.data vem em base64url, já sem a codificação de transporte.
export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; snippet?: string; payload?: GmailPart };
export type MailAddress = { name: string | null; email: string | null };
export type MailAttachment = { name: string; type: string | null; size: number | null; ref: string; inline?: boolean };

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const oneLine = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

// Cabeçalho da própria parte, sem distinguir maiúsculas; o primeiro, se houver vários.
export function header(part: GmailPart | undefined, name: string): string | null {
  const n = name.toLowerCase();
  const h = part?.headers?.find((x) => typeof x?.name === "string" && x.name.toLowerCase() === n);
  return h ? String(h.value ?? "") : null;
}

// Charset desconhecido (ou inválido) lê-se como UTF-8. Nota: "iso-8859-1" é lido como windows-1252 (norma WHATWG).
function decoder(charset: string | null | undefined) {
  const label = (charset || "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  try {
    return new TextDecoder(label || "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

function qBytes(text: string) {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const hex = text.slice(i + 1, i + 3);
    if (text[i] === "_") out.push(0x20);
    else if (text[i] === "=" && /^[0-9a-f]{2}$/i.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else out.push(text.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

// Palavras codificadas da RFC 2047 (=?charset?B|Q?...?=). Palavras seguidas, separadas só por espaços, juntam-se
// (o espaço entre elas não conta) e, com o mesmo charset, descodificam-se juntas (caracteres partidos entre
// palavras). O texto simples fica como está.
const ENCODED_WORD = /=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi;

export function decodeWords(value: string): string {
  if (typeof value !== "string") return "";
  if (!value.includes("=?")) return value;
  let out = "";
  let last = 0;
  let charset: string | null = null;
  let chunks: Buffer[] = [];
  const flush = () => {
    if (charset !== null) out += decoder(charset).decode(Buffer.concat(chunks)).replace(CONTROL, " ");
  };
  for (const m of value.matchAll(ENCODED_WORD)) {
    const between = value.slice(last, m.index);
    const cs = m[1].split("*")[0].toLowerCase(); // "UTF-8*pt" (RFC 2231): sem a língua
    const bytes = m[2].toLowerCase() === "b" ? Buffer.from(m[3], "base64") : qBytes(m[3]);
    const adjacent = charset !== null && /^\s*$/.test(between);
    if (adjacent && cs === charset) chunks.push(bytes);
    else {
      flush();
      if (!adjacent) out += between;
      charset = cs;
      chunks = [bytes];
    }
    last = (m.index ?? 0) + m[0].length;
  }
  flush();
  return out + value.slice(last);
}

// Email simples e são (sem espaços, domínio com TLD); até 254 caracteres.
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;

export function validEmail(value: string) {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value) && !/^\.|\.@|\.\./.test(value);
}

function cleanName(raw: string, email: string | null) {
  let n = raw.replace(CONTROL, " ").trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(n);
  n = quoted ? quoted[1].replace(/\\(.)/g, "$1") : n.replace(/"/g, "");
  n = n.trim().replace(/^'(.*)'$/, "$1").replace(/^\((.*)\)$/, "$1");
  // Encoded-words dentro de aspas não são válidas, mas há programas que as enviam assim.
  n = oneLine(decodeWords(n)).slice(0, 200);
  return n && n.toLowerCase() !== email ? n : null;
}

// Um endereço: '"Ana Silva" <ana@x.pt>', 'Ana Silva <ana@x.pt>', 'ana@x.pt', '<ana@x.pt>', 'ana@x.pt (Ana)'.
// O email fica em minúsculas e só se for válido.
export function parseAddress(value: string | null): MailAddress {
  const v = (value || "").replace(/\r?\n[ \t]*/g, " ").trim();
  if (!v) return { name: null, email: null };
  let rawEmail = "";
  let rawName = "";
  const angles = [...v.matchAll(/<([^<>]*)>/g)];
  if (angles.length) {
    const m = angles[angles.length - 1];
    rawEmail = m[1];
    rawName = v.slice(0, m.index);
  } else {
    const m = /^([^\s<>()",;:@]+@[^\s<>()",;:]+)\s*(?:\(([^()]*)\))?$/.exec(v);
    if (m) {
      rawEmail = m[1];
      rawName = m[2] || "";
    } else rawName = "";
  }
  const e = rawEmail.trim().toLowerCase();
  const email = validEmail(e) ? e : null;
  return { name: cleanName(rawName, email), email };
}

// Lista separada por vírgulas (ou ";"), sem partir nomes entre aspas; só entradas com email válido.
export function parseAddressList(value: string | null): MailAddress[] {
  const v = value || "";
  const pieces: string[] = [];
  let cur = "";
  let quote = false;
  let angle = 0;
  let paren = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < v.length) cur += v[++i];
      else if (c === '"') quote = false;
      continue;
    }
    if (c === '"') quote = true;
    else if (c === "<") angle++;
    else if (c === ">") angle = Math.max(0, angle - 1);
    else if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if ((c === "," || c === ";") && !angle && !paren) {
      pieces.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  pieces.push(cur);
  return pieces
    .map((p) => parseAddress(p.replace(/^[^"<>@:,]*:\s*/, ""))) // "Grupo: a@x.pt, b@x.pt;"
    .filter((a) => a.email !== null);
}

export function base64UrlDecode(data: string): Buffer {
  return Buffer.from((data || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, ""), "base64");
}

export function decodeBody(data: string | undefined, charset: string | null): string {
  return data ? decoder(charset).decode(base64UrlDecode(data)) : "";
}

export function charsetOf(part: GmailPart | undefined): string | null {
  const m = /(?:^|;)\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(header(part, "Content-Type") || "");
  return m ? m[1].toLowerCase() : null;
}

function disposition(part: GmailPart) {
  return (header(part, "Content-Disposition") || "").split(";")[0].trim().toLowerCase();
}
const isAttachment = (part: GmailPart) => Boolean((part.filename || "").trim()) || disposition(part) === "attachment";
const mimeOf = (part: GmailPart) => (part.mimeType || "").trim().toLowerCase();

// Partes por ordem (profundidade primeiro). Sem intoAttached não entra em emails anexados (message/rfc822).
function* walk(part: GmailPart | undefined, intoAttached: boolean, depth = 0): Generator<GmailPart> {
  if (!part || depth > 40) return;
  yield part;
  if (!intoAttached && mimeOf(part) === "message/rfc822") return;
  for (const p of part.parts || []) yield* walk(p, intoAttached, depth + 1);
}

// Corpos enormes (newsletters com HTML gigante) são cortados antes de tratar: o resultado fica sempre curto.
const MAX_SOURCE = 1_000_000;

function firstBody(payload: GmailPart | undefined, mime: string, intoAttached: boolean) {
  for (const p of walk(payload, intoAttached)) {
    if (mimeOf(p) !== mime || isAttachment(p) || !p.body?.data) continue;
    const text = decodeBody(p.body.data, charsetOf(p));
    if (!text.trim()) continue;
    if (text.length <= MAX_SOURCE) return text;
    const cut = text.slice(0, MAX_SOURCE);
    const lt = cut.lastIndexOf("<"); // sem etiqueta cortada a meio
    return mime === "text/html" && lt > cut.lastIndexOf(">") ? cut.slice(0, lt) : cut;
  }
  return "";
}

// Reencaminhamentos não são histórico: o conteúdo reencaminhado é o assunto da mensagem.
const FORWARD = /forwarded message|begin forwarded message|mensagem (?:re)?encaminhada|in[ií]cio da mensagem (?:re)?encaminhada|message transf[ée]r[ée]|mensaje reenviado/i;
const tagText = (html: string) => html.replace(/<[^>]*>/g, " ");

// Fim do elemento que abre em `start` (contando os aninhados); sem fecho, o fim do HTML. As etiquetas lêem-se com
// [^<>]* (nunca passam do "<" seguinte) e tudo anda só para a frente: HTML estragado não fica lento.
function elementEnd(html: string, start: number, tag: string) {
  const re = new RegExp(`<(/?)${tag}\\b[^<>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (!m[1] && m[0].endsWith("/>")) continue;
    depth += m[1] ? -1 : 1;
    if (depth <= 0) return m.index + m[0].length;
  }
  return html.length;
}

// Remove os elementos `tag` escolhidos por `match` (com o que têm dentro), menos os de um reencaminhamento.
function removeElements(html: string, tag: string, match: (open: string) => boolean) {
  const open = new RegExp(`<${tag}\\b[^<>]*>`, "gi");
  const forwards = FORWARD.test(tagText(html));
  let out = "";
  let last = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    if (!match(m[0])) continue;
    if (forwards && FORWARD.test(tagText(html.slice(Math.max(0, m.index - 400), m.index + m[0].length + 800)))) continue;
    out += html.slice(last, m.index);
    last = elementEnd(html, m.index, tag);
    open.lastIndex = last;
  }
  return out + html.slice(last);
}

// Histórico citado no HTML: Gmail (div.gmail_quote), Yahoo, Thunderbird, Apple Mail (blockquote) e Outlook
// (div#appendonsend, div#divRplyFwdMsg ou hr#stopSpelling: daí até ao fim).
function withoutQuotedHtml(html: string) {
  const cut = html.search(/<(?:div|hr)\b[^<>]*\bid\s*=\s*["']?(?:appendonsend|divRplyFwdMsg|stopSpelling)\b/i);
  let h = cut >= 0 ? html.slice(0, cut) : html;
  h = removeElements(h, "div", (open) => /\bclass\s*=\s*["']?[^"'>]*\b(?:gmail_quote|yahoo_quoted|moz-cite-prefix)\b/i.test(open));
  return removeElements(h, "blockquote", () => true);
}

// Ligações em texto, como em htmlToText ("rótulo (endereço)" só para http/https), mas aos pares <a>…</a> e sem
// voltar atrás; aberturas ou fechos soltos saem.
function anchorsToText(html: string) {
  const tokens = [...html.matchAll(/<a\b[^<>]*>|<\/a\s*>/gi)];
  let out = "";
  let last = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    out += html.slice(last, t.index);
    last = (t.index ?? 0) + t[0].length;
    if (t[0][1] !== "/" && next && next[0][1] === "/") {
      const label = html.slice(last, next.index).replace(/<[^>]+>/g, "").trim();
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(t[0])?.[1] ?? "";
      out += /^https?:\/\//i.test(href) && !label.includes(href) ? `${label} (${href})` : label;
      last = (next.index ?? 0) + next[0].length;
      i++;
    }
  }
  return out + html.slice(last);
}

// HTML pronto para htmlToText: sem comentários, <head>, <title>, <script>, <style> e <noscript> (sem fecho, sai só
// a abertura); um "<" que não abre etiqueta passa a "&lt;"; ligações já em texto. Tudo em passagens para a frente:
// HTML estragado (blocos ou ligações sem fecho, repetidos) não torna a conversão lenta.
function preparedHtml(html: string) {
  const open = /<!--|<(head|title|script|style|noscript)\b[^<>]*>?/gi;
  const unclosed = new Set<string>();
  let out = "";
  let last = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const kind = (m[1] || "!--").toLowerCase();
    out += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (!unclosed.has(kind)) {
      const close = m[1] ? new RegExp(`</${kind}\\s*>`, "gi") : /-->/g;
      close.lastIndex = last;
      const c = close.exec(html);
      if (c) last = c.index + c[0].length;
      else unclosed.add(kind);
    }
    open.lastIndex = last;
  }
  out += html.slice(last);
  return anchorsToText(out.replace(/<(?=[^<>]*(?:<|$))/g, "&lt;"));
}

export const MAX_MESSAGE_TEXT = 60000;

// Texto da mensagem do cliente, sem o histórico: o primeiro text/plain que não é anexo; senão o HTML (sem as
// citações) em texto. Emails anexados (message/rfc822) só contam se não houver mais nada.
export function messageText(payload: GmailPart | undefined): string {
  let text = "";
  for (const intoAttached of [false, true]) {
    const plain = firstBody(payload, "text/plain", intoAttached);
    if (plain) {
      text = stripQuoted(plain);
      break;
    }
    const html = firstBody(payload, "text/html", intoAttached);
    if (html) {
      const clean = preparedHtml(html);
      const reply = htmlToText(withoutQuotedHtml(clean));
      text = stripQuoted(reply || htmlToText(clean.replace(/<\/?blockquote\b[^<>]*>/gi, "<br>")));
      break;
    }
  }
  let out = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
  if (out.length > MAX_MESSAGE_TEXT) out = out.slice(0, MAX_MESSAGE_TEXT).replace(/[\ud800-\udbff]$/, "");
  return out;
}

const ATTR_START = /^\s*(?:on|em|no dia|a|às|le|el|am|il)\s/i;
const ATTR_END = /(?:wrote|escreveu|a écrit|escribió|schrieb|ha scritto)\s*:\s*$/i;
const ORIGINAL = /^\s*-{2,}\s*(?:original message|mensagem original|message d'origine|mensaje original)\s*-{2,}\s*$/i;
const OUTLOOK_FROM = /^\s*\*?(?:from|de)\s*:\*?\s*\S/i;
const OUTLOOK_NEXT = /^\s*\*?(?:sent|enviado|enviada|date|data)\s*:/i;
const UNDERSCORES = /^\s*_{10,}\s*$/;
const QUOTED = /^\s*>/;
const BLANK = /^\s*$/;

function startsHistory(lines: string[], i: number) {
  const line = lines[i];
  // "On … wrote:" / "Em … escreveu:" (também quando passa para a linha seguinte); tem data ou email.
  if (ATTR_START.test(line)) {
    const one = line.trim();
    const next = lines[i + 1];
    const two = next !== undefined && !QUOTED.test(next) ? `${one} ${next.trim()}` : one;
    const hit = ATTR_END.test(one) ? one : ATTR_END.test(two) ? two : null;
    if (hit && hit.length <= 400 && /\d|@/.test(hit)) return true;
  }
  if (ORIGINAL.test(line)) return true;
  // Outlook: "________" seguido de "From:"/"De:".
  if (UNDERSCORES.test(line)) {
    const after = lines.slice(i + 1, i + 4).find((l) => !BLANK.test(l));
    if (after !== undefined && OUTLOOK_FROM.test(after)) return true;
  }
  // Outlook: "From:"/"De:" e, até 4 linhas depois, "Sent:"/"Enviado:"/"Date:"/"Data:" (não num reencaminhamento).
  if (OUTLOOK_FROM.test(line) && lines.slice(i + 1, i + 5).some((l) => OUTLOOK_NEXT.test(l)))
    return !lines.slice(Math.max(0, i - 3), i).some((l) => FORWARD.test(l));
  return false;
}

// Corta o histórico de uma resposta em texto. Se não sobrar nada (a mensagem é toda citação), devolve o original.
export function stripQuoted(text: string): string {
  const original = (text || "").replace(/\r\n?/g, "\n");
  const lines = original.split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++)
    if (startsHistory(lines, i)) {
      cut = i;
      break;
    }
  const kept = lines.slice(0, cut);
  let popped = false;
  while (kept.length && (BLANK.test(kept[kept.length - 1]) || QUOTED.test(kept[kept.length - 1]))) {
    popped ||= QUOTED.test(kept[kept.length - 1]);
    kept.pop();
  }
  // "Ana escreveu:" sem data, logo antes da citação final.
  if (popped && kept.length && ATTR_END.test(kept[kept.length - 1])) kept.pop();
  return kept.join("\n").trim() || original.trim();
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic",
  "application/pdf": "pdf", "text/plain": "txt", "text/html": "html", "text/calendar": "ics", "message/rfc822": "eml",
};

// Nome de ficheiro seguro: sem caminho, sem caracteres de controlo nem reservados; até `max` caracteres,
// mantendo a extensão.
export function safeFileName(raw: string | null | undefined, max = 200): string {
  let n = decodeWords(String(raw ?? "").slice(0, 2000)).replace(CONTROL, " ");
  n = n.split(/[\\/]/).pop() || "";
  n = n.replace(/[<>:"|?*]+/g, "_").replace(/\s+/g, " ").trim().replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  const chars = Array.from(n);
  if (chars.length > max) {
    const ext = /\.[A-Za-z0-9]{1,10}$/.exec(n)?.[0] ?? "";
    n = chars.slice(0, max - ext.length).join("").trimEnd() + ext;
  }
  return n;
}

// Anexos (e imagens no corpo) de uma mensagem. ref = "gmail:<mensagem>:<partId>" (o attachmentId do Gmail muda
// de pedido para pedido; o partId não). inline: imagem marcada como inline ou com Content-ID.
export function messageAttachments(messageId: string, payload: GmailPart | undefined): MailAttachment[] {
  const out: MailAttachment[] = [];
  const visit = (part: GmailPart | undefined, depth: number) => {
    if (!part || depth > 40) return;
    const filename = (part.filename || "").trim();
    if (!mimeOf(part).startsWith("multipart/") && (filename || part.body?.attachmentId)) {
      const mime = mimeOf(part);
      const type = /^[a-z0-9][\w.+-]*\/[a-z0-9][\w.+-]*$/.test(mime) ? mime : null;
      const partId = part.partId ?? "";
      const ext = type ? EXTENSIONS[type] : undefined;
      const name = safeFileName(filename) || `anexo${partId ? `-${partId.replace(/\./g, "-")}` : ""}${ext ? `.${ext}` : ""}`;
      const size = typeof part.body?.size === "number" && part.body.size >= 0 ? part.body.size : null;
      const disp = disposition(part);
      const inline = Boolean(type?.startsWith("image/")) && disp !== "attachment" && (disp === "inline" || header(part, "Content-ID") !== null);
      out.push({ name, type, size, ref: `gmail:${messageId}:${partId}`, ...(inline ? { inline: true } : {}) });
      return; // um email anexado conta como um anexo; o que tem dentro vai com ele
    }
    for (const p of part.parts || []) visit(p, depth + 1);
  };
  visit(payload, 0);
  return out;
}

// Fora do Apoio ao Cliente só o spam, o lixo e os rascunhos: um cliente cujo email o Gmail ponha em Promoções,
// Redes sociais, Atualizações ou Fóruns (ex.: o formulário de contacto da loja) tem de aparecer. Essas categorias
// não recebem a resposta automática.
export const EXCLUDED_LABELS = ["SPAM", "TRASH", "DRAFT"];
export const AUTOREPLY_EXCLUDED_LABELS = [...EXCLUDED_LABELS, "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "CATEGORY_UPDATES"];

export function labelExcluded(labels: string[] | undefined): boolean {
  return (labels || []).some((l) => EXCLUDED_LABELS.includes(l));
}

// Remetentes de sistemas (também os da RFC 3834: MAILER-DAEMON, owner-*, *-request); "info@" é uma pessoa.
const AUTO_LOCAL = /(?:^|[._+-])(?:no[._-]?reply|do[._-]?not[._-]?reply|nao[._-]?respond(?:a|er)|mailer[._-]?daemon|postmaster|bounces?|notifications?|notificac(?:ao|oes)|alerts?|newsletters?)(?:$|[._+-])|^owner-|-request$/;

// Resposta automática (RFC 3834): só a pessoas, nunca a sistemas, listas, avisos de entrega ou à própria loja.
export function autoReplyAllowed(msg: GmailMessage, opts: { mailbox: string; ownDomains: string[] }): { ok: boolean; reason?: string } {
  const labels = msg.labelIds || [];
  const excluded = labels.find((l) => AUTOREPLY_EXCLUDED_LABELS.includes(l));
  if (excluded) return { ok: false, reason: `Etiqueta excluída (${excluded})` };
  if (labels.includes("SENT")) return { ok: false, reason: "Enviada pela própria caixa" };
  const p = msg.payload;
  const from = parseAddress(header(p, "From")).email;
  if (!from) return { ok: false, reason: "Remetente em falta ou inválido" };
  if (from === (opts.mailbox || "").trim().toLowerCase()) return { ok: false, reason: "Enviada pela própria caixa" };
  const domain = from.split("@")[1];
  const own = (opts.ownDomains || []).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (own.some((d) => domain === d || domain.endsWith(`.${d}`))) return { ok: false, reason: "Remetente do domínio da loja" };
  if (AUTO_LOCAL.test(from.split("@")[0])) return { ok: false, reason: "Remetente automático" };
  if ((header(p, "Return-Path") || "").replace(/\s+/g, "") === "<>") return { ok: false, reason: "Aviso de entrega (sem endereço de retorno)" };
  const auto = header(p, "Auto-Submitted");
  if (auto !== null && auto.split(";")[0].trim().toLowerCase() !== "no") return { ok: false, reason: "Mensagem automática (Auto-Submitted)" };
  const precedence = (header(p, "Precedence") || "").trim().toLowerCase();
  if (["bulk", "list", "junk", "auto_reply", "auto-reply"].includes(precedence)) return { ok: false, reason: "Envio em massa (Precedence)" };
  if ((p?.headers || []).some((h) => /^list-/i.test(h?.name || ""))) return { ok: false, reason: "Lista de distribuição ou newsletter" };
  if (header(p, "X-Autoreply") !== null || header(p, "X-Autorespond") !== null) return { ok: false, reason: "Resposta automática de outro sistema" };
  const suppress = (header(p, "X-Auto-Response-Suppress") || "").toLowerCase().split(/[\s,]+/);
  if (suppress.some((t) => t === "all" || t === "oof" || t === "autoreply")) return { ok: false, reason: "O remetente pediu para não receber respostas automáticas" };
  return { ok: true };
}

// Formulários que escrevem em nome do cliente: o From é do serviço e o cliente vem no Reply-To (o que a pessoa
// escreveu no formulário, sem verificação).
export const FORM_RELAYS = ["mailer@shopify.com"];

// Quem escreveu a mensagem: o From, que o Gmail autentica (SPF/DKIM/DMARC; o que falha vai para o spam, que fica
// de fora). O Reply-To só conta nos formulários de contacto e fica como não verificado: nunca serve de identidade
// para mostrar encomendas.
export function senderOf(msg: GmailMessage): MailAddress & { verified: boolean } {
  const from = parseAddress(header(msg.payload, "From"));
  if (from.email && FORM_RELAYS.includes(from.email)) {
    const reply = parseAddress(header(msg.payload, "Reply-To"));
    if (reply.email && !FORM_RELAYS.includes(reply.email)) return { ...reply, verified: false };
  }
  return { ...from, verified: true };
}

// Contacto de um formulário (email não confirmado): linha própria, "formulario:<email>", que nunca se mistura com
// o contacto confirmado do mesmo endereço.
export const FORM_CONTACT_PREFIX = "formulario:";
export function contactExternalId(sender: { email: string | null; verified: boolean }) {
  return sender.email ? `${sender.verified ? "" : FORM_CONTACT_PREFIX}${sender.email}` : null;
}
// Endereço para onde se responde a partir do id do contacto (com ou sem o prefixo do formulário).
export function contactAddress(externalId: string | null | undefined): string | null {
  const v = String(externalId ?? "").trim().toLowerCase();
  const email = v.startsWith(FORM_CONTACT_PREFIX) ? v.slice(FORM_CONTACT_PREFIX.length) : v;
  return validEmail(email) ? email : null;
}

// Destinatário de uma resposta automática (no formulário de contacto é o que a pessoa escreveu): nunca o próprio
// domínio (nem subdomínios), nem endereços de sistemas ou do próprio formulário.
export function recipientAllowed(email: string, ownDomains: string[]): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  if (!validEmail(e) || FORM_RELAYS.includes(e)) return false;
  const [local, domain] = e.split("@");
  const own = (ownDomains || []).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return !own.some((d) => domain === d || domain.endsWith(`.${d}`)) && !AUTO_LOCAL.test(local);
}

// Mensagem automática (RFC 3834): também a nossa resposta "recebemos o seu email".
export function isAutoSubmitted(msg: GmailMessage): boolean {
  const v = header(msg.payload, "Auto-Submitted");
  return v !== null && v.split(";")[0].trim().toLowerCase() !== "no";
}

// Envio feito pelo dashboard: o id da mensagem no dashboard vai no cabeçalho X-LDO-Message (o Gmail guarda-o
// nos Enviados). Assim um envio incerto é confirmado pela sincronização sem depender do texto.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function dashboardMessageId(msg: GmailMessage): string | null {
  const v = (header(msg.payload, "X-LDO-Message") || "").trim().toLowerCase();
  return UUID.test(v) ? v : null;
}

// Texto que o Postgres aceita em jsonb: sem NUL e sem metades soltas de pares surrogate (passam a U+FFFD).
export function cleanText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\u0000/g, "").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
}

// Prefixos de resposta e reencaminhamento (pt, en, es, fr, de), repetidos e com contador ("Re[2]:").
const SUBJECT_PREFIX = /^\s*(?:re|res|fwd?|enc|rv|tr|aw|wg)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*/i;

export function cleanSubject(subject: string | null): string {
  let s = oneLine(decodeWords(subject || ""));
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(SUBJECT_PREFIX, "");
  }
  return s.trim();
}

// O Gmail só junta a resposta à conversa se o assunto corresponder: sem cortes e sem inventar texto.
export function replySubject(subject: string | null): string {
  const s = Array.from(cleanSubject(subject)).slice(0, 900).join("").trim();
  return s ? `Re: ${s}` : "Re:";
}

// Valor de cabeçalho numa só linha. Com caracteres fora do ASCII: palavras =?UTF-8?B?…?= de até 64 caracteres
// (o limite é 75), sem partir caracteres, separadas por CRLF + espaço.
const WORD_BYTES = 39;

export function encodeHeader(value: string): string {
  const v = oneLine(String(value ?? ""));
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  const words: string[] = [];
  let chunk = "";
  for (const ch of v) {
    if (chunk && Buffer.byteLength(chunk + ch, "utf8") > WORD_BYTES) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

export function formatAddress(name: string | null, email: string): string {
  if (typeof email !== "string" || /[\r\n]/.test(email)) throw new Error("Endereço de email inválido.");
  const e = email.trim();
  if (!validEmail(e)) throw new Error("Endereço de email inválido.");
  const n = oneLine(name || "");
  if (!n) return e;
  if (/^[\x20-\x7e]*$/.test(n)) return `"${n.replace(/(["\\])/g, "\\$1")}" <${e}>`;
  return `${encodeHeader(n)} <${e}>`;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const URL_RE = /https?:\/\/[^\s<>"'«»]+/gi;
const count = (s: string, c: string) => s.split(c).length - 1;

// Texto com as ligações http(s) clicáveis; a pontuação final ("veja https://x.pt/a." ou "(https://x.pt)") fica de fora.
function linkify(line: string) {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(URL_RE)) {
    let url = m[0];
    let round = count(url, ")") - count(url, "(");
    let square = count(url, "]") - count(url, "[");
    for (;;) {
      const c = url[url.length - 1];
      if (c === ")" && round > 0) round--;
      else if (c === "]" && square > 0) square--;
      else if (!".,;:!?…".includes(c)) break;
      url = url.slice(0, -1);
    }
    const at = m.index ?? 0;
    out += escapeHtml(line.slice(last, at));
    out += /^https?:\/\/[^/]/i.test(url) ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : escapeHtml(url);
    last = at + url.length;
  }
  return out + escapeHtml(line.slice(last));
}

const BODY_STYLE = "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2f33";
const LIST_ITEM = /^\s*(?:-|•)\s+(.*)$/;

// Texto simples para HTML de email: parágrafos nas linhas em branco, <br> nas mudanças de linha e listas
// quando há duas ou mais linhas seguidas a começar por "- " ou "• ".
export function textToHtml(text: string): string {
  const blocks = (text || "").replace(/\r\n?/g, "\n").trim().split(/\n(?:[ \t]*\n)+/);
  let html = "";
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    let para: string[] = [];
    const flush = () => {
      if (para.length) html += `<p style="margin:0 0 12px">${para.join("<br>")}</p>`;
      para = [];
    };
    for (let i = 0; i < lines.length; ) {
      let j = i;
      while (j < lines.length && LIST_ITEM.test(lines[j])) j++;
      if (j - i >= 2) {
        flush();
        html += `<ul style="margin:0 0 12px;padding-left:22px">${lines.slice(i, j).map((l) => `<li>${linkify((LIST_ITEM.exec(l) as RegExpExecArray)[1])}</li>`).join("")}</ul>`;
        i = j;
      } else {
        para.push(linkify(lines[i]));
        i++;
      }
    }
    flush();
  }
  return `<div style="${BODY_STYLE}">${html}</div>`;
}

export function signatureBlock(signature: string): { text: string; html: string } {
  const s = (signature || "").replace(/\r\n?/g, "\n").trim();
  if (!s) return { text: "", html: "" };
  return {
    text: `\n\n${s}`,
    html: `<div style="margin-top:18px;color:#4f5c55;font-size:13px;line-height:1.5">${s.split("\n").map(escapeHtml).join("<br>")}</div>`,
  };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Data da RFC 5322 em UTC ("Thu, 08 Oct 2026 09:05:00 +0000").
export function mailDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new Error("Data inválida.");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${DAYS[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

// Identificadores <…> de In-Reply-To / References: só ASCII visível, sem espaços nem < > lá dentro.
const MSG_ID = /<[\x21-\x3b\x3d\x3f-\x7e]{1,250}>/g;
const MSG_ID_ONE = /^<[\x21-\x3b\x3d\x3f-\x7e]{1,250}>$/;

export function messageIds(value: string | null | undefined): string[] {
  return String(value ?? "").match(MSG_ID) || [];
}

const CRLF = "\r\n";
const base64Lines = (buf: Buffer) => (buf.toString("base64").match(/.{1,76}/g) || []).join(CRLF);
const canonical = (s: string) => Buffer.from(String(s ?? "").replace(/\r\n?|\n/g, CRLF), "utf8");

// From/To já formatados (formatAddress): só se aceita a dobra CRLF + espaço; qualquer outra quebra é recusada.
function addressHeader(value: string, label: string) {
  const v = String(value ?? "").replace(/\r\n[ \t]+/g, " ");
  if (/[\r\n]/.test(v) || !v.includes("@")) throw new Error(`Cabeçalho ${label} inválido.`);
  return oneLine(v);
}

// Cabeçalho com uma lista de identificadores, dobrado em linhas de até 76 caracteres.
function foldIds(name: string, ids: string[]) {
  const lines: string[] = [];
  let line = `${name}:`;
  for (const id of ids) {
    if (line.length + 1 + id.length > 76 && line !== `${name}:`) {
      lines.push(line);
      line = ` ${id}`;
    } else line += ` ${id}`;
  }
  lines.push(line);
  return lines.join(CRLF);
}

function asciiFileName(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}
const pct = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Content-Disposition de um anexo: filename ASCII e, se o nome tiver outros caracteres, filename* (RFC 2231),
// em segmentos de até 60 caracteres sem partir caracteres.
function dispositionLines(name: string) {
  const ascii = asciiFileName(name);
  if (ascii === name) return [`Content-Disposition: attachment; filename="${ascii}"`];
  const pieces: string[] = [];
  let cur = "";
  for (const ch of name) {
    const e = pct(ch);
    if (cur && cur.length + e.length > 60) {
      pieces.push(cur);
      cur = "";
    }
    cur += e;
  }
  if (cur) pieces.push(cur);
  const ext = pieces.length === 1
    ? [` filename*=UTF-8''${pieces[0]}`]
    : pieces.map((p, i) => ` filename*${i}*=${i === 0 ? "UTF-8''" : ""}${p}${i < pieces.length - 1 ? ";" : ""}`);
  return [`Content-Disposition: attachment; filename="${ascii}";`, ...ext];
}

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const BOUNDARY = /^[0-9A-Za-z'()+_,\-./:=?]{1,60}$/;

export type MimeInput = {
  from: string;
  to: string;
  subject: string;
  inReplyTo?: string | null;
  references?: string | null;
  text: string;
  html: string;
  attachments?: { name: string; type: string; data: Buffer }[];
  date?: Date;
  messageId?: string;
  boundary?: string;
  // Id da mensagem no dashboard (cabeçalho X-LDO-Message).
  dashboardId?: string;
  // Resposta automática: "Auto-Submitted: auto-replied" (RFC 3834) para outros sistemas não responderem.
  autoSubmitted?: boolean;
};

// Mensagem RFC 5322 (CRLF) para o campo raw do Gmail (em base64url, por quem envia). Texto e HTML em
// multipart/alternative; com anexos, dentro de multipart/mixed. Nenhum valor consegue acrescentar cabeçalhos.
export function buildMime(o: MimeInput): string {
  const boundary = o.boundary ?? `=_ldo_${randomBytes(12).toString("hex")}`;
  if (!BOUNDARY.test(boundary)) throw new Error("Separador MIME inválido.");
  const attachments = o.attachments || [];
  const alt = attachments.length ? `alt-${boundary}` : boundary;

  const headers = [`From: ${addressHeader(o.from, "From")}`, `To: ${addressHeader(o.to, "To")}`, `Subject: ${encodeHeader(o.subject)}`, `Date: ${mailDate(o.date ?? new Date())}`];
  if (o.messageId !== undefined) {
    const raw = String(o.messageId).trim();
    const id = raw.startsWith("<") ? raw : `<${raw}>`;
    if (!MSG_ID_ONE.test(id)) throw new Error("Message-ID inválido.");
    headers.push(`Message-ID: ${id}`);
  }
  const replyTo = messageIds(o.inReplyTo).slice(0, 5);
  if (replyTo.length) headers.push(foldIds("In-Reply-To", replyTo));
  let refs = messageIds(o.references);
  if (refs.length > 20) refs = [refs[0], ...refs.slice(-19)]; // o primeiro e os mais recentes
  if (refs.length) headers.push(foldIds("References", refs));
  if (o.dashboardId !== undefined) {
    if (!UUID.test(o.dashboardId)) throw new Error("Identificador de mensagem inválido.");
    headers.push(`X-LDO-Message: ${o.dashboardId.toLowerCase()}`);
  }
  if (o.autoSubmitted) headers.push("Auto-Submitted: auto-replied", "X-Auto-Response-Suppress: All");
  headers.push("MIME-Version: 1.0");

  const altBody = [
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(canonical(o.text)),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(canonical(o.html)),
    `--${alt}--`,
  ];
  if (!attachments.length) return [...headers, `Content-Type: multipart/alternative; boundary="${alt}"`, "", ...altBody, ""].join(CRLF);

  const parts = [`--${boundary}`, `Content-Type: multipart/alternative; boundary="${alt}"`, "", ...altBody];
  for (const a of attachments) {
    const name = safeFileName(a.name) || "anexo";
    const t = String(a.type ?? "").trim().toLowerCase();
    const type = MIME_TYPE.test(t) ? t : "application/octet-stream";
    const data = Buffer.isBuffer(a.data) ? a.data : Buffer.from(a.data ?? "");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${type}; name="${asciiFileName(name)}"`,
      ...dispositionLines(name),
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(data),
    );
  }
  parts.push(`--${boundary}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts, ""].join(CRLF);
}

// Horário do apoio, na hora de Lisboa: "09:30-13:00, 14:00-18:30" (também "9h30-13h" ou "9h às 13h").
// Dia vazio = fechado; sem nenhum horário preenchido = sempre aberto.
export type SupportHours = { weekdays?: string; saturday?: string; sunday?: string };

const TIME = String.raw`(\d{1,2})(?:\s*[:hH.]\s*(\d{2})?)?`;
const RANGE = new RegExp(String.raw`^\s*${TIME}\s*(?:-|–|—|às|as|a|to)\s*${TIME}\s*$`, "i");
const minutesOf = (h: string, m: string | undefined) => {
  const hh = Number(h);
  const mm = Number(m ?? 0);
  return hh <= 24 && mm <= 59 && (hh < 24 || mm === 0) ? hh * 60 + mm : null;
};

// Intervalos em minutos desde a meia-noite; os inválidos (ou que passam da meia-noite) são ignorados.
export function hourRanges(value: string | null | undefined): [number, number][] {
  const out: [number, number][] = [];
  for (const chunk of (value || "").replace(/\s+/g, " ").split(/[,;]| e /)) {
    const m = RANGE.exec(chunk);
    if (!m) continue;
    const a = minutesOf(m[1], m[2]);
    const b = minutesOf(m[3], m[4]);
    if (a !== null && b !== null && a < b) out.push([a, b]);
  }
  return out;
}

const LISBON = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function withinHours(hours: SupportHours | null | undefined, now: Date): boolean {
  const days = [hours?.weekdays, hours?.saturday, hours?.sunday].map((s) => (typeof s === "string" ? s.trim() : ""));
  if (days.every((s) => !s)) return true;
  const parts: Record<string, string> = {};
  for (const p of LISBON.formatToParts(now)) parts[p.type] = p.value;
  const day = parts.weekday === "Sat" ? days[1] : parts.weekday === "Sun" ? days[2] : days[0];
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return hourRanges(day).some(([a, b]) => minutes >= a && minutes < b);
}
