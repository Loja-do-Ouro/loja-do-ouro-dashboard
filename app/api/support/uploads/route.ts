import { catalogImage } from "@/lib/bi/shopify";
import { sessionRpc } from "@/lib/support/db";
import { handle, HttpError, json, supportViewer } from "@/lib/support/http";
import { isUuid } from "@/lib/support/rules";
import { MAX_UPLOAD_BYTES, saveUpload } from "@/lib/support/uploads";

export const dynamic = "force-dynamic";

// Anexo para uma resposta: o ficheiro vem em bruto (o browser já reduziu as imagens) ou, com
// ?produto=<url do CDN Shopify>, é a foto de um produto. Exige o cabeçalho x-support-upload, que um
// formulário de outro site não consegue enviar, além da sessão e da mesma origem.
export async function POST(request: Request) {
  return handle(async () => {
    const viewer = await supportViewer(request, { write: true, json: false });
    if (request.headers.get("x-support-upload") !== "1") throw new HttpError(403, "Pedido recusado.");
    const q = new URL(request.url).searchParams;
    const conversation = q.get("conversa");
    if (!isUuid(conversation)) throw new HttpError(400, "Conversa inválida.");
    // Confirma o acesso à conversa com a sessão da pessoa.
    await sessionRpc(viewer.session, "ldo_support_conversation", { p_id: conversation });

    const product = q.get("produto");
    if (product) {
      const bytes = await catalogImage(product);
      const name = (q.get("nome") || "produto").slice(0, 100);
      return json(await saveUpload(viewer.id, conversation, name, bytes));
    }
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, "Ficheiro demasiado grande (máximo 4 MB depois de reduzido).");
    const bytes = new Uint8Array(await request.arrayBuffer());
    const name = decodeURIComponent(request.headers.get("x-file-name") || "anexo");
    return json(await saveUpload(viewer.id, conversation, name, bytes));
  });
}
