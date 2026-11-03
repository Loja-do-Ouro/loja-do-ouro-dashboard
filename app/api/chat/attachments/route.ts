import { clientKey, overLimit } from "@/lib/rate-limit";
import { serverRpc } from "@/lib/support/db";
import { asciiName, isUuid, sniffType } from "@/lib/support/rules";
import { ChatError, chatHandle, checkOrigin, corsHeaders, identityEmail, preflight, visitorTokenHash } from "@/lib/support/site-chat";
import { SITE_FILE_TYPES } from "@/lib/support/site-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Os anexos guardados têm no máximo 4 MB (as respostas das funções Vercel, 4,5 MB).
const MAX_BYTES = 4 * 1024 * 1024;
// Pedidos por ligação (IP) nesta instância do servidor: 120 em 10 minutos. O limite que vale entre instâncias é o da BD
// (60 ficheiros ou 60 MB por visitante em 10 minutos); este trava pedidos em paralelo com vários tokens.
const IP_MAX = 120;
const IP_WINDOW_MS = 10 * 60 * 1000;

export function OPTIONS(request: Request) {
  return preflight(request);
}

// Um ficheiro de uma resposta da equipa (?m=<mensagem>&i=<0-4>) para o widget do visitante. O token segue no cabeçalho
// Authorization, nunca no endereço, e a BD confirma que a resposta foi entregue na conversa dele. O widget mostra-o a
// partir da memória (blob:): tipo real pelos bytes (só imagens e PDF), documento isolado e sem cache.
export async function GET(request: Request) {
  return chatHandle(request, async () => {
    checkOrigin(request);
    const tokenHash = visitorTokenHash(request);
    const q = new URL(request.url).searchParams;
    const message = q.get("m"), index = q.get("i") || "";
    if (!isUuid(message) || !/^[0-4]$/.test(index)) throw new ChatError(400, "Pedido inválido.");
    if (overLimit(`chat-files:${clientKey(request)}`, IP_MAX, IP_WINDOW_MS)) throw new ChatError(429, "Demasiados pedidos de ficheiros. Aguarde um pouco.");
    const f = await serverRpc<{ name: string; type: string; size: number; data: string } | null>("ldo_support_site_attachment", {
      p_token_hash: tokenHash, p_identity_email: identityEmail(request), p_message: message, p_index: Number(index),
    });
    const bytes = f?.data ? Buffer.from(f.data, "base64") : null;
    const real = bytes ? sniffType(bytes) : null;
    // Apagado (30 dias), purgado ou com outro tipo: o widget mostra "Este ficheiro já não está disponível.".
    if (!f || !bytes || !real || !SITE_FILE_TYPES.includes(real) || bytes.byteLength > MAX_BYTES)
      throw new ChatError(404, "Este ficheiro já não está disponível.");
    const name = f.name || "anexo";
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...corsHeaders(request),
        "Content-Type": real,
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": `${real === "application/pdf" ? "attachment" : "inline"}; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}
