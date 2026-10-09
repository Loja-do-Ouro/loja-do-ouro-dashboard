import "server-only";
import { localDate } from "@/lib/bi/periods";
import { serverRpc } from "@/lib/support/db";
import { open, seal } from "@/lib/support/crypto";
import { planSheetChanges } from "@/lib/store-sheet-plan";
import { dayHash, groupByDay, parseSalesSheet, type SheetCell, type SheetSale, type SheetTab } from "@/lib/store-sheet-rules";

// Lojas físicas: importação da folha Google "Análise de Vendas" (um separador por loja) para ldo_shop_sales.
// Ligação Google só de leitura (spreadsheets.readonly), feita pelo Super Admin na Administração; as chaves ficam
// cifradas no Supabase (AES-256-GCM, SUPPORT_ENCRYPTION_KEY) e só o servidor as usa. Corre de madrugada e antes do
// alerta das 22h; compara cada loja/dia com a última versão importada e só escreve o que mudou.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const STORE_SHEET_COOKIE = "ldo_sheet_oauth";
const OWNER = "sheets:lojas"; // dados autenticados da cifra: as chaves só abrem para esta ligação
const RENEW_MARGIN_MS = 2 * 60 * 1000;
// Dias enviados de cada vez à base de dados (cada chamada é uma transação curta).
const APPLY_BATCH = 40;

export class SheetError extends Error {
  constructor(message: string, public status: number | null = null, public reconnect = false) {
    super(message);
  }
}

export function storeSheetConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
// O endereço de retorno registado na Google é o da produção: a ligação faz-se sempre lá.
export function storeSheetOrigin() {
  if (process.env.SUPPORT_PUBLIC_URL) return process.env.SUPPORT_PUBLIC_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "https://loja-do-ouro-dashboard.vercel.app";
}
export function storeSheetRedirectUri() {
  return process.env.STORE_SHEET_REDIRECT_URI || `${storeSheetOrigin()}/api/admin/folha-lojas/callback`;
}
export function storeSheetUrl(spreadsheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}

type Account = {
  spreadsheet_id: string; email: string | null; scope: string | null; refresh_ct: string | null; access_ct: string | null;
  access_expires_at: string | null; version: number; status: "not_connected" | "active" | "reconnect";
};

// ---------------------------------------------------------------- OAuth

// openid + email só para mostrar que conta autorizou; o acesso à folha é só de leitura.
export function storeSheetAuthorizeUrl(state: string, challenge: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "", redirect_uri: storeSheetRedirectUri(), response_type: "code",
    scope: `openid email ${SHEETS_SCOPE}`, access_type: "offline", prompt: "consent", state, code_challenge: challenge,
    code_challenge_method: "S256", hd: "lojadoouro.pt",
  });
  return `${AUTH_URL}?${q}`;
}

type TokenResponse = { access_token: string; expires_in?: number; refresh_token?: string; scope?: string; id_token?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  let r: Response;
  try {
    r = await fetch(TOKEN_URL, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", ...params }),
    });
  } catch {
    throw new SheetError("A Google não respondeu ao pedido de acesso. Tente de novo.");
  }
  const body = (await r.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!r.ok || !body.access_token) {
    const code = body.error || "";
    throw new SheetError(
      code === "invalid_grant" ? "A Google recusou a ligação (autorização revogada ou expirada). Volte a ligar a folha."
        : code === "invalid_client" || code === "unauthorized_client" ? "A Google recusou as credenciais OAuth (GOOGLE_CLIENT_ID/SECRET)."
          : `A Google recusou o pedido de acesso (${body.error_description || code || `HTTP ${r.status}`}).`,
      r.status, code === "invalid_grant");
  }
  return body as TokenResponse;
}

async function sheetsFetch<T>(token: string, path: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${SHEETS}${path}`, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  } catch {
    throw new SheetError("O Google Sheets não respondeu a tempo.");
  }
  const body = (await r.json().catch(() => null)) as (T & { error?: { message?: string; status?: string } }) | null;
  if (!r.ok) {
    const msg = body?.error?.message || `HTTP ${r.status}`;
    throw new SheetError(
      r.status === 403 || r.status === 404 ? `A conta ligada não consegue abrir a folha (${msg}). Confirme que a folha está partilhada com essa conta.` : `Google Sheets: ${msg}`,
      r.status, r.status === 401);
  }
  if (body === null) throw new SheetError("Google Sheets: resposta ilegível.");
  return body as T;
}

// Email da conta no id_token devolvido pela Google (pedido feito diretamente à Google por TLS).
function emailFromIdToken(idToken: string | undefined) {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const email = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).email;
    return typeof email === "string" ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Troca o código, confirma que a conta consegue ler a folha configurada e cifra as chaves; quem grava é a rota de
// retorno (com a sessão do Super Admin).
export async function exchangeStoreSheetCode(code: string, verifier: string, spreadsheetId: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: storeSheetRedirectUri(), code_verifier: verifier });
  if (!t.refresh_token) throw new SheetError("A Google não devolveu a autorização permanente. Volte a carregar em Ligar folha.");
  if (t.scope && !t.scope.split(" ").includes(SHEETS_SCOPE)) throw new SheetError("Falta autorizar a leitura das folhas de cálculo. Volte a ligar e aceite o pedido.", 403);
  await sheetsFetch(t.access_token, `/${encodeURIComponent(spreadsheetId)}?fields=properties.title`);
  return {
    email: emailFromIdToken(t.id_token) || "conta Google", scope: t.scope || SHEETS_SCOPE,
    refresh_ct: seal(t.refresh_token, OWNER), access_ct: seal(t.access_token, OWNER),
    access_expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
  };
}

let tokenCache: { token: string; until: number; version: number } | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Chave de acesso válida; a renovação é feita por um só pedido de cada vez (lease de 30 s na BD, pela versão).
async function accessToken(failed?: string): Promise<{ token: string; spreadsheetId: string }> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const a = await serverRpc<Account>("ldo_store_sheet_get");
    if (a.status !== "active" || !a.refresh_ct) throw new SheetError(a.status === "reconnect" ? "É preciso voltar a ligar a folha das lojas." : "Folha das lojas por ligar.", null, true);
    if (tokenCache && tokenCache.version === a.version && tokenCache.until > Date.now() && tokenCache.token !== failed)
      return { token: tokenCache.token, spreadsheetId: a.spreadsheet_id };
    let access: string | null = null;
    try {
      access = a.access_ct ? open(a.access_ct, OWNER) : null;
    } catch {
      throw new SheetError("Não foi possível abrir a ligação à folha (a chave de cifra mudou?). Volte a ligar a folha.", null, true);
    }
    const expires = a.access_expires_at ? Date.parse(a.access_expires_at) : 0;
    if (access && access !== failed && expires - Date.now() > RENEW_MARGIN_MS) {
      tokenCache = { token: access, until: Math.min(expires - RENEW_MARGIN_MS, Date.now() + 5 * 60 * 1000), version: a.version };
      return { token: access, spreadsheetId: a.spreadsheet_id };
    }
    if (await serverRpc<boolean>("ldo_store_sheet_claim", { p_version: a.version })) {
      let t: TokenResponse;
      try {
        t = await tokenRequest({ grant_type: "refresh_token", refresh_token: open(a.refresh_ct, OWNER) });
      } catch (e) {
        if (e instanceof SheetError && e.reconnect) await serverRpc("ldo_store_sheet_fail", { p_version: a.version, p_detail: e.message }).catch(() => undefined);
        throw e;
      }
      const until = new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString();
      await serverRpc<boolean>("ldo_store_sheet_rotate", {
        p_version: a.version, p_access_ct: seal(t.access_token, OWNER), p_access_expires_at: until,
        p_refresh_ct: t.refresh_token ? seal(t.refresh_token, OWNER) : null,
      }).catch(() => false);
      tokenCache = { token: t.access_token, until: Math.min(Date.parse(until) - RENEW_MARGIN_MS, Date.now() + 5 * 60 * 1000), version: a.version + 1 };
      return { token: t.access_token, spreadsheetId: a.spreadsheet_id };
    }
    await sleep(800);
  }
  throw new SheetError("A renovação da ligação à folha demorou demasiado. Tente de novo.");
}

// Revoga a autorização na Google (melhor esforço); a ligação é apagada na BD na mesma.
export async function storeSheetRevoke() {
  const a = await serverRpc<Account>("ldo_store_sheet_get").catch(() => null);
  if (a?.refresh_ct) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(a.refresh_ct, OWNER))}`, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {
      // A ligação é apagada na BD na mesma.
    }
  }
  tokenCache = null;
}

// Todos os separadores visíveis, com os valores como estão guardados (datas em número de série, valores em número).
async function readTabs(): Promise<SheetTab[]> {
  let { token, spreadsheetId } = await accessToken();
  const get = async <T>(path: string): Promise<T> => {
    try {
      return await sheetsFetch<T>(token, path);
    } catch (e) {
      if (!(e instanceof SheetError && e.status === 401)) throw e;
      ({ token, spreadsheetId } = await accessToken(token));
      return sheetsFetch<T>(token, path);
    }
  };
  const id = encodeURIComponent(spreadsheetId);
  const meta = await get<{ sheets?: { properties?: { title?: string; hidden?: boolean } }[] }>(`/${id}?fields=sheets.properties(title,hidden)`);
  const titles = (meta.sheets || []).map((s) => s.properties).filter((p) => p?.title && !p.hidden).map((p) => p!.title!);
  if (!titles.length) return [];
  const q = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER", majorDimension: "ROWS" });
  for (const t of titles) q.append("ranges", `'${t.replace(/'/g, "''")}'!A1:O5000`);
  const values = await get<{ valueRanges?: { values?: SheetCell[][] }[] }>(`/${id}/values:batchGet?${q}`);
  return titles.map((title, i) => ({ title, rows: values.valueRanges?.[i]?.values || [] }));
}

// ---------------------------------------------------------------- importação

type State = {
  stores: { code: string; name: string; active: boolean }[];
  days: { store_code: string; day: string; hash: string }[];
  imported: { store_code: string; day: string }[];
  protected: { store_code: string; day: string; reason: "form" | "edited" }[];
};
type Applied = { changed: number; inserted: number; removed: number; skipped: { store_code: string; day: string; reason: string }[] };

export type StoreSheetResult =
  | { ran: false; reason: string }
  | { ran: true; status: "completed" | "partial" | "failed"; days: number; changed: number; inserted: number; removed: number; skipped: number; issues: number; detail: string };

const strip = (s: SheetSale) => {
  const { store_code: _store, sale_date: _date, row: _row, ...rest } = s;
  return rest;
};

// Compara a folha com o que está importado e aplica só os dias que mudaram. Nunca apaga dias de uma loja cujo
// separador falhou ou ficou muito mais curto do que a versão anterior.
export async function importStoreSheet(trigger: string): Promise<StoreSheetResult> {
  const account = await serverRpc<Account>("ldo_store_sheet_get");
  if (account.status === "not_connected") return { ran: false, reason: "Folha das lojas por ligar (Administração → Folha das lojas)." };
  const run = await serverRpc<number | null>("ldo_store_sheet_run_begin", { p_trigger: trigger });
  if (!run) return { ran: false, reason: "Já há uma importação a correr." };
  const issues: { tab: string; row: number | null; message: string }[] = [];
  let totals: Applied = { changed: 0, inserted: 0, removed: 0, skipped: [] };
  let status: "completed" | "partial" | "failed" = "completed";
  let detail = "";
  let days = 0;
  try {
    const [tabs, state] = await Promise.all([readTabs(), serverRpc<State>("ldo_store_sheet_state")]);
    const parsed = parseSalesSheet(tabs, { stores: state.stores.map((s) => ({ code: s.code, name: s.name })), today: localDate() });
    issues.push(...parsed.issues);
    const grouped = groupByDay(parsed.sales);
    days = grouped.size;
    const sheetDays = [...grouped.values()].map((sales) => ({ store_code: sales[0].store_code, day: sales[0].sale_date, hash: dayHash(sales), rows: sales.map(strip) }));
    const plan = planSheetChanges(sheetDays, parsed.tabs.filter((t) => t.store_code).map((t) => t.store_code!), state);
    issues.push(...plan.issues);
    const changes = plan.changes;

    for (let i = 0; i < changes.length; i += APPLY_BATCH) {
      const r = await serverRpc<Applied>("ldo_store_sheet_apply", { p_days: changes.slice(i, i + APPLY_BATCH) });
      totals = { changed: totals.changed + r.changed, inserted: totals.inserted + r.inserted, removed: totals.removed + r.removed, skipped: [...totals.skipped, ...r.skipped] };
    }
    if (issues.length) status = "partial";
    detail = `${days} dia(s) na folha, ${changes.length} enviado(s) para atualizar.`;
  } catch (e) {
    status = "failed";
    detail = e instanceof Error ? e.message : "Erro desconhecido.";
  }
  await serverRpc("ldo_store_sheet_run_finish", {
    p_run: run, p_status: status, p_days_changed: totals.changed, p_rows_inserted: totals.inserted, p_rows_removed: totals.removed,
    p_skipped: totals.skipped.slice(0, 200), p_issues: issues.slice(0, 200), p_detail: detail,
  }).catch(() => undefined);
  return { ran: true, status, days, changed: totals.changed, inserted: totals.inserted, removed: totals.removed, skipped: totals.skipped.length, issues: issues.length, detail };
}

