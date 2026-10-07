import "server-only";
import { serverRpc } from "./db";
import { sniffType } from "./rules";
import { publicOrigin } from "./zendesk";

// Anexos escritos pelas colaboradoras. O browser já reduziu as imagens; aqui confirma-se o tipo real
// pelos bytes e o tamanho (limite das funções Vercel: 4,5 MB por pedido).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export type Upload = { id: string; conversation_id: string; user_id: string; name: string; type: string; size: number; message_id: string | null; data: string };

export async function saveUpload(userId: string, conversationId: string, name: string, bytes: Uint8Array) {
  if (!bytes.byteLength) throw new Error("Ficheiro vazio.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Ficheiro demasiado grande (máximo 4 MB depois de reduzido).");
  const type = sniffType(bytes);
  if (!type || !ALLOWED.has(type)) throw new Error("Só se podem anexar imagens JPEG, PNG ou WebP e PDF.");
  const clean = name.replace(/[\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 120) || "anexo";
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[type]!;
  const finalName = clean.toLowerCase().endsWith(`.${ext}`) ? clean : `${clean.replace(/\.[^.]*$/, "")}.${ext}`;
  return serverRpc<{ id: string; name: string; type: string; size: number }>("ldo_support_upload_save", {
    p_user_id: userId, p_conversation: conversationId, p_name: finalName, p_content_type: type,
    p_data_b64: Buffer.from(bytes).toString("base64"),
  });
}

export function getUpload(id: string) {
  return serverRpc<Upload | null>("ldo_support_upload_get", { p_id: id });
}

// URL público temporário (1 hora) de uma imagem, para a Meta a ir buscar.
export async function publishUpload(id: string, requestUrl: string) {
  const token = await serverRpc<string>("ldo_support_upload_publish", { p_id: id });
  return `${publicOrigin(requestUrl)}/api/support/media/${token}`;
}
