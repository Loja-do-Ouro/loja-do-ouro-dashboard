import "server-only";
import { serverRpc } from "./db";
import { sniffType, uploadName } from "./rules";
import { publicOrigin } from "./zendesk";

// Anexos escritos pelas colaboradoras. O browser já reduziu as imagens; aqui confirma-se o tipo real
// pelos bytes e o tamanho (limite das funções Vercel: 4,5 MB por pedido).
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

// source_url: endereço público de origem (foto de produto no CDN da Shopify).
export type Upload = { id: string; conversation_id: string; user_id: string; name: string; type: string; size: number; message_id: string | null; data: string; source_url: string | null };

export async function saveUpload(userId: string, conversationId: string, name: string, bytes: Uint8Array, sourceUrl: string | null = null) {
  if (!bytes.byteLength) throw new Error("Ficheiro vazio.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error("Ficheiro demasiado grande (máximo 4 MB depois de reduzido).");
  const type = sniffType(bytes);
  if (!type || !ALLOWED.has(type)) throw new Error("Só se podem anexar imagens JPEG, PNG ou WebP e PDF.");
  // Até 120 caracteres, a acabar sempre na extensão do tipo real (o widget do chat do site guarda-o com este nome).
  const finalName = uploadName(name, type);
  return serverRpc<{ id: string; name: string; type: string; size: number }>("ldo_support_upload_save", {
    p_user_id: userId, p_conversation: conversationId, p_name: finalName, p_content_type: type,
    p_data_b64: Buffer.from(bytes).toString("base64"), p_source_url: sourceUrl,
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
