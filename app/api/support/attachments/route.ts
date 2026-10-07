import { NextResponse } from "next/server";
import { serverRpc, sessionRpc } from "@/lib/support/db";
import { handle, HttpError, supportViewer } from "@/lib/support/http";
import { metricoolImage } from "@/lib/support/metricool";
import { isUuid, previewKind, sniffType } from "@/lib/support/rules";
import { getUpload } from "@/lib/support/uploads";
import { zendeskAttachment } from "@/lib/support/zendesk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// As respostas das funções Vercel têm limite de 4,5 MB: até 4 MB o ficheiro passa por aqui com
// cabeçalhos seguros; acima disso, os anexos do Zendesk abrem diretamente do endereço temporário do Zendesk.
const MAX_BYTES = 4 * 1024 * 1024;
const PROVIDER: Record<string, string> = { "metricool-facebook": "FACEBOOK", "metricool-instagram": "INSTAGRAM" };
// Servidores de ficheiros da Meta (Instagram/Messenger) que podem ser lidos diretamente.
const META_CDN = /^(lookaside\.fbsbx\.com|lookaside\.facebook\.com|[a-z0-9.-]+\.fbcdn\.net|[a-z0-9.-]+\.cdninstagram\.com)$/;

type Detail = {
  conversation: { id: string; source_id: string; external_id: string };
  messages: { id: string; attachments: { name: string; type: string | null; ref: string }[] }[];
};

function asciiName(name: string) {
  return (name || "anexo").normalize("NFKD").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "anexo";
}

// Cabeçalhos por tipo real (confirmado pelos bytes, nunca só pelo declarado):
// - imagens: em linha, num documento isolado (sandbox);
// - PDF: em linha sem sandbox (o visualizador do browser corre fora do nosso site; sandbox impediria a
//   pré-visualização) e só dentro do próprio dashboard (frame-ancestors);
// - vídeo/áudio: em linha, com pedidos parciais (Range);
// - tudo o resto (SVG, HTML, Office, desconhecidos) ou ?download=1: sempre descarregado.
function respond(request: Request, bytes: Uint8Array, name: string, download: boolean) {
  const real = sniffType(bytes);
  const kind = download || !real ? "file" : previewKind(real);
  const inline = kind !== "file";
  const csp = kind === "pdf" ? "default-src 'none'; frame-ancestors 'self'" : inline ? "default-src 'none'; img-src 'self'; media-src 'self'; frame-ancestors 'self'; sandbox" : "default-src 'none'; sandbox";
  const headers: Record<string, string> = {
    "Content-Type": inline ? real! : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name || "anexo")}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": csp,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",
    "Cache-Control": "private, no-store",
  };
  // Pedidos parciais (vídeo/áudio; o Safari exige-os).
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
  if ((kind === "video" || kind === "audio") && range) {
    const total = bytes.byteLength;
    let start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2] || 0));
    let end = range[1] ? (range[2] ? Number(range[2]) : total - 1) : total - 1;
    if (!range[1] && !range[2]) start = 0;
    end = Math.min(end, total - 1);
    if (start < 0 || start > end || start >= total)
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(bytes.slice(), { headers: { ...headers, ...(kind === "video" || kind === "audio" ? { "Accept-Ranges": "bytes" } : {}) } });
}

// Anexos através do servidor: o browser nunca recebe tokens nem URLs autenticados.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const q = new URL(request.url).searchParams;
    const conversation = q.get("c"), message = q.get("m"), index = Number(q.get("i"));
    const download = q.get("download") === "1";
    if (!isUuid(conversation) || !isUuid(message) || !Number.isInteger(index) || index < 0) throw new HttpError(404, "Anexo não encontrado.");
    const d = await sessionRpc<Detail>(viewer.session, "ldo_support_conversation", { p_id: conversation });
    const a = d.messages.find((m) => m.id === message)?.attachments[index];
    if (!a) throw new HttpError(404, "Anexo não encontrado.");

    // Imagem ou PDF enviado pelo dashboard (ainda com os bytes guardados).
    if (a.ref.startsWith("upload:")) {
      const u = await getUpload(a.ref.slice(7));
      if (!u || u.conversation_id !== conversation) throw new HttpError(404, "Anexo já não disponível no dashboard.");
      return respond(request, new Uint8Array(Buffer.from(u.data, "base64")), u.name, download);
    }

    if (a.ref.startsWith("zendesk:") && d.conversation.source_id === "zendesk") {
      const users = await sessionRpc<{ id: string; zendesk: boolean }[]>(viewer.session, "ldo_support_users");
      const reader = users.find((u) => u.id === viewer.id)?.zendesk ? viewer.id : await serverRpc<string | null>("ldo_support_zendesk_sync_user");
      if (!reader) throw new HttpError(409, "Ligue o Zendesk para abrir anexos.");
      const z = await zendeskAttachment(reader, d.conversation.external_id, a.ref.slice(8), MAX_BYTES);
      // Grande: o browser abre-o diretamente do endereço temporário do Zendesk (sem passar por aqui).
      if ("redirect" in z) return NextResponse.redirect(z.redirect, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      const bytes = new Uint8Array(await z.response.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "Anexo demasiado grande para abrir aqui; abra o ticket no Zendesk.");
      return respond(request, bytes, z.name, download);
    }

    if (a.ref.startsWith("metricool:") && PROVIDER[d.conversation.source_id]) {
      const target = a.ref.slice(10);
      if (!/^https:\/\//.test(target)) throw new HttpError(400, "Anexo inválido.");
      // Imagens do Instagram/Messenger: endereço assinado e temporário do CDN da Meta, lido diretamente
      // (só destes servidores). O fetch-image da Metricool fica como alternativa.
      let bytes = new Uint8Array(0);
      // Redirecionamentos seguidos um a um, sempre dentro dos servidores da Meta.
      let next: string | null = target;
      for (let hop = 0; next && hop < 4 && META_CDN.test(new URL(next).hostname); hop++) {
        const r: Response | null = await fetch(next, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(20000) }).catch(() => null);
        if (!r) break;
        if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
          next = new URL(r.headers.get("location")!, next).toString();
          await r.body?.cancel();
          continue;
        }
        if (r.ok && Number(r.headers.get("content-length") || 0) <= MAX_BYTES) bytes = new Uint8Array(await r.arrayBuffer());
        else await r.body?.cancel();
        break;
      }
      if (!bytes.byteLength) bytes = new Uint8Array(await (await metricoolImage(PROVIDER[d.conversation.source_id], target)).arrayBuffer());
      if (!bytes.byteLength) throw new HttpError(410, "Imagem indisponível (o endereço da Meta pode ter expirado).");
      if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "Anexo demasiado grande para abrir aqui; abra-o na Metricool.");
      return respond(request, bytes, a.name, download);
    }
    throw new HttpError(404, "Anexo não encontrado.");
  });
}
