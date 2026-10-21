import "server-only";
import { REVISION } from "./bi/klaviyo";
import { klaviyoListPayload, type klaviyoProfilePayload, type klaviyoSubscriptionPayload } from "./private-selection-rules";

// Klaviyo com escrita, só para a Private Selection: perfis, a lista "Clientes Private Selection" e a inscrição nos
// emails de marketing. Chave própria (KLAVIYO_WRITE_API_KEY, com Profiles, Lists e Subscriptions em "Full Access"):
// a KLAVIYO_API_KEY do BI é só de leitura. A lista vem de KLAVIYO_PRIVATE_SELECTION_LIST_ID (criada à mão na
// Klaviyo). Sem as duas variáveis nada é enviado e a fila fica à espera na BD.
// Os pedidos seguem a mesma revisão da API que o BI (REVISION em lib/bi/klaviyo.ts); um por função, para ser fácil
// confirmar cada um na documentação da Klaviyo quando a revisão mudar.
const BASE = "https://a.klaviyo.com/api";
const TIMEOUT_MS = 10_000;
const MAX_WAIT_MS = 10_000;

export function klaviyoWriteConfigured() {
  return Boolean(process.env.KLAVIYO_WRITE_API_KEY && privateSelectionListId());
}

export function privateSelectionListId() {
  return process.env.KLAVIYO_PRIVATE_SELECTION_LIST_ID?.trim() || null;
}

type KlaviyoErrors = { errors?: { title?: string; detail?: string }[] };

// Uma chamada: 10 s no máximo e uma só nova tentativa quando a Klaviyo pede para esperar (429). As respostas 202 e
// 204 não têm corpo. Em erro, o motivo da Klaviyo (errors[0].detail) segue na mensagem; a chave nunca.
async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, attempt = 0): Promise<T | null> {
  const key = process.env.KLAVIYO_WRITE_API_KEY;
  if (!key) throw new Error("Klaviyo por configurar (KLAVIYO_WRITE_API_KEY).");
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, accept: "application/vnd.api+json",
        ...(body === undefined ? {} : { "content-type": "application/vnd.api+json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Klaviyo indisponível.");
  }
  if (r.status === 429 && attempt < 1) {
    const wait = Math.min(MAX_WAIT_MS, Math.max(1000, Number(r.headers.get("retry-after") || 1) * 1000));
    await new Promise((done) => setTimeout(done, wait));
    return call<T>(method, path, body, attempt + 1);
  }
  const text = await r.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Corpo que não é JSON: só interessa o estado.
  }
  if (!r.ok) {
    const e = (data as KlaviyoErrors | null)?.errors?.[0];
    const why = (e?.detail || e?.title || "").replace(/\s+/g, " ").trim().slice(0, 300);
    throw new Error(`Klaviyo recusou (HTTP ${r.status})${why ? `: ${why}` : "."}`);
  }
  return data as T | null;
}

// Cria ou atualiza o perfil pelo email (POST /api/profile-import/, 200 ou 201) e devolve o id do perfil.
// payload: klaviyoProfilePayload() de lib/private-selection-rules.ts.
export async function importProfile(payload: ReturnType<typeof klaviyoProfilePayload>) {
  const r = await call<{ data?: { id?: string } }>("POST", "/profile-import/", payload);
  const id = r?.data?.id;
  if (!id) throw new Error("Klaviyo não devolveu o perfil.");
  return id;
}

// Id do perfil com este email, ou null quando a Klaviyo não o tem (GET /api/profiles/ com filtro). Só para tirar da
// lista: assim um membro que nunca chegou à Klaviyo não passa a ter perfil por ter sido removido.
export async function findProfileId(email: string) {
  const q = new URLSearchParams({ filter: `equals(email,${JSON.stringify(email.trim().toLowerCase())})`, "fields[profile]": "email" });
  const r = await call<{ data?: { id?: string }[] }>("GET", `/profiles/?${q}`);
  return r?.data?.[0]?.id || null;
}

// Junta perfis à lista, sem mexer no consentimento (POST /api/lists/{id}/relationships/profiles/, 204).
export async function addProfilesToList(listId: string, profileIds: string[]) {
  await call("POST", `/lists/${encodeURIComponent(listId)}/relationships/profiles/`, klaviyoListPayload(profileIds));
}

// Tira perfis da lista (DELETE /api/lists/{id}/relationships/profiles/, 204). O perfil fica na Klaviyo.
export async function removeProfilesFromList(listId: string, profileIds: string[]) {
  await call("DELETE", `/lists/${encodeURIComponent(listId)}/relationships/profiles/`, klaviyoListPayload(profileIds));
}

// Inscrição nos emails de marketing (POST /api/profile-subscription-bulk-create-jobs/, 202: a Klaviyo trata-a em
// segundo plano). payload: klaviyoSubscriptionPayload() de lib/private-selection-rules.ts.
export async function subscribeProfiles(payload: NonNullable<ReturnType<typeof klaviyoSubscriptionPayload>>) {
  await call("POST", "/profile-subscription-bulk-create-jobs/", payload);
}
