// Núcleo da cifra da plataforma de criadores (§0.3, rev. S-B12): AES-256-GCM com um ANEL de chaves passado por
// parâmetro, nunca lido do ambiente aqui (lib/criadores/crypto.ts lê CREATORS_ENCRYPTION_KEY e chama estas funções).
// Sem I/O: testado em tests/criadores-crypto.cjs.
//
// - CREATORS_ENCRYPTION_KEY = "c1:<32 bytes em base64>"; numa rotação, "c2:<nova>,c1:<antiga>" (a primeira é a atual).
// - Cada valor cifrado começa pela versão da chave: "c1.<base64url(iv 12 | tag 16 | corpo)>". seal usa a atual; open
//   escolhe a chave pelo prefixo.
// - A AAD é "<finalidade>:<id>" (iban:<criador>, fiscal:<criador>, addr:<pedido>, payee:<pagamento>, ig:<criador>,
//   igsel:<criador>) e cada finalidade cifra com uma subchave própria:
//   hkdfSync('sha256', chave, '', 'ldo-cr:' + finalidade, 32).
// - As chaves do servidor (hash dos IP, assinatura das ligações «Deixar de receber avisos») derivam do
//   CREATORS_SERVER_TOKEN por HKDF-SHA256 com info própria (rev. S-M3, R-B6), nunca do BI_INGEST_TOKEN.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const ENV = "CREATORS_ENCRYPTION_KEY";

// Finalidades com subchave própria (a parte da AAD antes de «:»).
export const CRYPTO_PURPOSES = ["iban", "fiscal", "addr", "payee", "ig", "igsel"] as const;
export type CryptoPurpose = (typeof CRYPTO_PURPOSES)[number];

export type KeyRing = {
  current: string; // versão usada por seal (a primeira do anel), ex.: "c2"
  versions: string[]; // pela ordem do anel
  keys: Record<string, Buffer>; // versão → chave-mãe de 32 bytes
};

const VERSION_RE = /^c[1-9][0-9]{0,3}$/;
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const SEALED_RE = /^(c[1-9][0-9]{0,3})\.([A-Za-z0-9_-]+)$/;

// Problema no valor da variável (formato, chaves repetidas, chave igual à do apoio) ou null se estiver bom.
// supportKey: o valor de SUPPORT_ENCRYPTION_KEY, para recusar a mesma chave nas duas áreas.
export function creatorsKeyProblem(value: string | undefined | null, supportKey?: string | null): string | null {
  const raw = (value || "").trim();
  if (!raw) return `${ENV} em falta.`;
  if (/require\(|console\.|randomBytes|openssl|node -e/.test(raw))
    return `${ENV} contém o comando em vez do resultado: corra o comando e cole só a chave que ele mostra, no formato c1:<chave>.`;
  const parts = raw.split(",").map((p) => p.trim());
  const seen = new Set<string>();
  const bytes = new Set<string>();
  const support = (supportKey || "").trim();
  for (const part of parts) {
    const m = /^([^:]*):(.*)$/.exec(part);
    if (!m) return `${ENV} inválida: cada chave tem de ter a versão à frente (ex.: c1:<chave>; numa rotação, c2:<nova>,c1:<antiga>).`;
    const [, version, key] = m;
    if (!VERSION_RE.test(version)) return `${ENV} inválida: «${version.slice(0, 12)}» não é uma versão (use c1, c2, …).`;
    if (seen.has(version)) return `${ENV} inválida: a versão ${version} aparece duas vezes.`;
    seen.add(version);
    if (!KEY_RE.test(key)) return `${ENV} inválida: a chave ${version} tem de ser 32 bytes aleatórios em base64 (44 caracteres, termina em =).`;
    if (bytes.has(key)) return `${ENV} inválida: a chave ${version} é igual a outra do anel.`;
    bytes.add(key);
    if (support && key === support) return `${ENV} não pode ser igual à SUPPORT_ENCRYPTION_KEY: gere uma chave própria para a plataforma de criadores.`;
  }
  return null;
}

// Anel de chaves a partir do valor da variável. Lança Error com a mensagem de creatorsKeyProblem.
export function parseKeyRing(value: string | undefined | null, supportKey?: string | null): KeyRing {
  const problem = creatorsKeyProblem(value, supportKey);
  if (problem) throw new Error(problem);
  const ring: KeyRing = { current: "", versions: [], keys: {} };
  for (const part of (value || "").trim().split(",")) {
    const [version, key] = part.trim().split(":");
    ring.versions.push(version);
    ring.keys[version] = Buffer.from(key, "base64");
  }
  ring.current = ring.versions[0];
  return ring;
}

// Problema com CREATORS_RESEAL_FROM (vazio = sem regravação, não é problema).
export function resealProblem(ring: KeyRing, from: string | undefined | null): string | null {
  const v = (from || "").trim();
  if (!v) return null;
  if (!VERSION_RE.test(v)) return "CREATORS_RESEAL_FROM inválida: indique a versão a regravar (ex.: c1).";
  if (v === ring.current) return `CREATORS_RESEAL_FROM é ${v}, que já é a chave atual: nada a regravar.`;
  if (!ring.keys[v]) return `CREATORS_RESEAL_FROM é ${v}, mas essa chave já não está em ${ENV}: sem ela não é possível regravar.`;
  return null;
}

function purposeOf(aad: string): CryptoPurpose {
  const i = aad.indexOf(":");
  const purpose = i > 0 ? aad.slice(0, i) : "";
  if (!(CRYPTO_PURPOSES as readonly string[]).includes(purpose) || i === aad.length - 1)
    throw new Error(`Finalidade de cifra inválida: use <finalidade>:<id> (${CRYPTO_PURPOSES.join(", ")}).`);
  return purpose as CryptoPurpose;
}

// Subchave de uma finalidade (32 bytes).
export function subkey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `ldo-cr:${purpose}`, 32));
}

// Cifra com a chave atual do anel. aad = "<finalidade>:<id>".
export function seal(ring: KeyRing, plain: string, aad: string): string {
  const key = subkey(ring.keys[ring.current], purposeOf(aad));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${ring.current}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

// Versão da chave de um valor cifrado («c1»), ou null se não tiver o formato.
export function sealedVersion(sealed: string | null | undefined): string | null {
  const m = SEALED_RE.exec(sealed || "");
  return m ? m[1] : null;
}

// Decifra com a chave indicada pelo prefixo. Erros com texto claro (nunca o valor).
export function open(ring: KeyRing, sealed: string, aad: string): string {
  const m = SEALED_RE.exec(sealed || "");
  if (!m) throw new Error("Valor cifrado com formato desconhecido (falta o prefixo da chave, ex.: c1.).");
  const [, version, data] = m;
  const master = ring.keys[version];
  if (!master)
    throw new Error(`Falta a chave ${version} em ${ENV}: este valor foi cifrado com ela. Volte a pô-la no anel (ex.: ${ring.current}:<atual>,${version}:<antiga>).`);
  const raw = Buffer.from(data, "base64url");
  if (raw.length < 28) throw new Error("Valor cifrado incompleto.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", subkey(master, purposeOf(aad)), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Finalidade de cifra")) throw e;
    throw new Error("Não foi possível decifrar: a chave ou a finalidade não correspondem a este valor.");
  }
}

// Regravação durante uma rotação (tick, com CREATORS_RESEAL_FROM): só os valores dessa versão; mesma AAD.
// Devolve o valor novo, ou null se não for preciso (outra versão, vazio, ou já na atual).
export function reseal(ring: KeyRing, sealed: string | null | undefined, aad: string, from: string): string | null {
  const version = sealedVersion(sealed);
  if (!sealed || version !== from || version === ring.current) return null;
  return seal(ring, open(ring, sealed, aad), aad);
}

// ---------------------------------------------------------------- chaves derivadas do CREATORS_SERVER_TOKEN

export const IP_KEY_INFO = "ldo-cr-ip-v1";
export const UNSUB_KEY_INFO = "ldo-cr-unsub-v1";

// Chave própria (32 bytes) derivada do CREATORS_SERVER_TOKEN por HKDF-SHA256 (sem sal). O token entra como texto.
export function serverKey(serverToken: string, info: string): Buffer {
  const token = (serverToken || "").trim();
  if (token.length < 32) throw new Error("CREATORS_SERVER_TOKEN em falta ou curto demais.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(token, "utf8"), Buffer.alloc(0), info, 32));
}

// Hash da ligação do criador (limites contra abuso; nunca o IP em claro): HMAC-SHA256 de "cr:<ip>" em hex (64).
export function ipHashWith(serverToken: string, ip: string): string {
  return createHmac("sha256", serverKey(serverToken, IP_KEY_INFO)).update(`cr:${ip || "unknown"}`).digest("hex");
}

// Assinatura de um valor com uma chave derivada (ex.: UNSUB_KEY_INFO e o id do criador), em base64url.
export function serverSign(serverToken: string, info: string, value: string): string {
  return createHmac("sha256", serverKey(serverToken, info)).update(value).digest("base64url");
}

// Comparação em tempo constante de uma assinatura de serverSign.
export function serverVerify(serverToken: string, info: string, value: string, signature: string): boolean {
  const expected = Buffer.from(serverSign(serverToken, info, value));
  const got = Buffer.from(String(signature || ""));
  return got.length === expected.length && timingSafeEqual(got, expected);
}
