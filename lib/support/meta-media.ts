import "server-only";
import { META_CDN } from "./comment-rules";

export type MetaFile = { ok: true; bytes: Uint8Array } | { ok: false; tooLarge: boolean };

// Ficheiro do CDN da Meta (Facebook/Instagram), lido diretamente pelo servidor: só https e só servidores da Meta,
// também em cada redirecionamento (seguidos um a um), e no máximo maxBytes contados durante a leitura (sem
// depender do Content-Length). Endereço expirado, recusado ou sem resposta: { ok: false }.
export async function fetchMetaFile(url: string, maxBytes: number, timeoutMs = 20_000): Promise<MetaFile> {
  const signal = AbortSignal.timeout(timeoutMs);
  let next = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(next);
      if (u.protocol !== "https:" || !META_CDN.test(u.hostname)) return { ok: false, tooLarge: false };
      const r = await fetch(u, { cache: "no-store", redirect: "manual", signal });
      if (r.status >= 300 && r.status < 400) {
        const location = r.headers.get("location");
        await r.body?.cancel().catch(() => undefined);
        if (!location) return { ok: false, tooLarge: false };
        next = new URL(location, u).toString();
        continue;
      }
      if (!r.ok || !r.body) {
        await r.body?.cancel().catch(() => undefined);
        return { ok: false, tooLarge: false };
      }
      if (Number(r.headers.get("content-length") || 0) > maxBytes) {
        await r.body.cancel().catch(() => undefined);
        return { ok: false, tooLarge: true };
      }
      const reader = r.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, tooLarge: true };
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.byteLength;
      }
      return size ? { ok: true, bytes } : { ok: false, tooLarge: false };
    }
  } catch {
    // Endereço inválido, rede ou tempo esgotado.
  }
  return { ok: false, tooLarge: false };
}
