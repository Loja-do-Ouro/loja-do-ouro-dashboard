import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { keyProblem } from "./rules";

// Tokens Zendesk cifrados com AES-256-GCM antes de irem para o Supabase. A chave
// (SUPPORT_ENCRYPTION_KEY, 32 bytes em base64) só existe no ambiente Vercel. O id do
// colaborador entra como dados autenticados: um token não pode ser trocado para outra pessoa.
const PREFIX = "v1.";

export function encryptionProblem(): string | null {
  return keyProblem(process.env.SUPPORT_ENCRYPTION_KEY);
}

function key(): Buffer {
  const problem = encryptionProblem();
  if (problem) throw new Error(problem);
  const raw = process.env.SUPPORT_ENCRYPTION_KEY!.trim();
  return Buffer.from(raw, "base64");
}

export function encryptionConfigured() {
  return encryptionProblem() === null;
}

export function seal(plain: string, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function open(sealed: string, owner: string): string {
  if (!sealed.startsWith(PREFIX)) throw new Error("Formato de token desconhecido.");
  const raw = Buffer.from(sealed.slice(PREFIX.length), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(owner));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
