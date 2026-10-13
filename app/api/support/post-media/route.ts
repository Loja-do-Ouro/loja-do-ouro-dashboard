import { sessionRpc } from "@/lib/support/db";
import { handle, HttpError, supportViewer } from "@/lib/support/http";
import { fetchMetaFile } from "@/lib/support/meta-media";
import { isUuid, sniffType } from "@/lib/support/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024;
const IMAGES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Imagem da publicação comentada (Facebook/Instagram), através do servidor: o endereço temporário do CDN da Meta
// é lido na BD pela conversa e pela posição (com a sessão de quem pede), nunca recebido do browser. Só imagens
// confirmadas pelos bytes; um vídeo abre na própria publicação. O browser nunca contacta a Meta.
export async function GET(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request);
    const q = new URL(request.url).searchParams;
    const conversation = q.get("c"), index = Number(q.get("i"));
    if (!isUuid(conversation) || !Number.isInteger(index) || index < 0 || index > 9) throw new HttpError(404, "Imagem não encontrada.");
    const media = await sessionRpc<{ url?: unknown; kind?: unknown } | null>(viewer.session, "ldo_support_post_media", { p_conversation: conversation, p_index: index });
    if (!media || typeof media.url !== "string") throw new HttpError(404, "Imagem não encontrada.");
    if (media.kind === "video") throw new HttpError(415, "Vídeo: abra a publicação para o ver.");
    const file = await fetchMetaFile(media.url, MAX_BYTES);
    if (!file.ok) throw new HttpError(file.tooLarge ? 413 : 410, file.tooLarge ? "Imagem demasiado grande." : "Imagem indisponível (o endereço da Meta pode ter expirado).");
    const type = sniffType(file.bytes);
    if (!type || !IMAGES.has(type)) throw new HttpError(415, "Este ficheiro não é uma imagem.");
    const name = `publicacao-${index + 1}.${type.split("/")[1].replace("jpeg", "jpg")}`;
    return new Response(file.bytes.slice(), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${q.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        // Na mesma sessão do browser não volta a pedir a imagem ao mudar de conversa.
        "Cache-Control": "private, max-age=600",
      },
    });
  });
}
