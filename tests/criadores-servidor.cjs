const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Testes estáticos dos módulos de servidor da plataforma de criadores (lib/criadores/{db,site,crypto,emails}.ts, §4):
// importam next/headers e server-only, por isso não correm em node; confirma-se o código-fonte contra a migração.
// - cada chamada a uma função ldo_cr_* passa exatamente os parâmetros da função (o PostgREST escolhe a função pelos
//   nomes: um a mais ou a menos dá 404 em produção) e todas as funções públicas da migração têm um wrapper;
// - o token de servidor é o CREATORS_SERVER_TOKEN (rev. S-M3), nunca o BI_INGEST_TOKEN;
// - cookie com o nome das regras e sem Domain (rev. S-B1); emails de conta em after() (rev. S-B2); logótipo do
//   endereço do dashboard; AAD por finalidade (rev. S-B12).
const ROOT = path.join(__dirname, "..");
const LIB = path.join(ROOT, "lib", "criadores");
const read = (f) => fs.readFileSync(path.join(LIB, f), "utf8");
// Sem as linhas de comentário (que explicam o que nunca se usa).
const code = (f) => read(f).replace(/^\s*\/\/.*$/gm, "");
const exists = fs.existsSync(path.join(LIB, "db.ts"));
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const sqlFiles = fs.readdirSync(MIGRATIONS).filter((f) => /_ldo_creators.*\.sql$/.test(f)).sort();

// Funções public.ldo_cr_* das migrações: nome → nomes dos parâmetros (a última definição ganha).
function migrationFunctions() {
  const out = new Map();
  for (const f of sqlFiles) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    const re = /create\s+(?:or\s+replace\s+)?function\s+public\.(ldo_cr_[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*returns/gi;
    let m;
    while ((m = re.exec(sql))) {
      const params = m[2].replace(/--[^\n]*/g, "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split(/\s+/)[0].toLowerCase());
      out.set(m[1], params);
    }
  }
  return out;
}

// Chamadas crServerRpc/crStaffRpc em db.ts: nome da função, tipo e chaves p_* do objeto de argumentos.
function dbCalls(src) {
  const calls = [];
  const re = /"(ldo_cr_[a-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(0, m.index);
    const server = before.lastIndexOf("crServerRpc");
    const staff = before.lastIndexOf("crStaffRpc");
    if (server < 0 && staff < 0) continue;
    const kind = server > staff ? "server" : "staff";
    let i = m.index + m[0].length;
    while (/\s/.test(src[i])) i++;
    let keys = [];
    if (src[i] === ",") {
      i++;
      while (/\s/.test(src[i])) i++;
      if (src[i] === "{") {
        let depth = 0;
        let j = i;
        for (; j < src.length; j++) {
          if (src[j] === "{") depth++;
          if (src[j] === "}" && --depth === 0) break;
        }
        keys = [...src.slice(i + 1, j).matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map((k) => k[1]);
      }
    }
    calls.push({ fn: m[1], kind, keys, line: before.split("\n").length });
  }
  return calls;
}

test("db.ts: each ldo_cr_* call passes exactly the parameters of the function", { skip: !exists && "lib/criadores/db.ts ainda não existe" }, () => {
  const fns = migrationFunctions();
  assert.ok(fns.size > 40, "a migração A tem de ter as funções ldo_cr_*");
  const calls = dbCalls(read("db.ts"));
  assert.ok(calls.length > 40);
  const problems = [];
  for (const c of calls) {
    const params = fns.get(c.fn);
    if (!params) {
      problems.push(`db.ts:${c.line} ${c.fn} não existe na migração`);
      continue;
    }
    const first = c.kind === "server" ? "p_token" : "p_session";
    if (params[0] !== first) problems.push(`db.ts:${c.line} ${c.fn} começa por ${params[0]}, mas é chamada como ${c.kind}`);
    const given = [first, ...c.keys].sort();
    const expected = [...params].sort();
    if (given.join(",") !== expected.join(",")) problems.push(`db.ts:${c.line} ${c.fn}: passa (${given}) e a função tem (${expected})`);
  }
  assert.deepEqual(problems, []);
});

test("db.ts: every public ldo_cr_* function of the migrations has a typed wrapper", { skip: !exists && "lib/criadores/db.ts ainda não existe" }, () => {
  const called = new Set(dbCalls(read("db.ts")).map((c) => c.fn));
  const missing = [...migrationFunctions().keys()].filter((fn) => !called.has(fn));
  assert.deepEqual(missing, []);
});

test("server modules: server-only, CREATORS_SERVER_TOKEN and never the BI_INGEST_TOKEN (rev. S-M3)", { skip: !exists && "lib/criadores ainda não existe" }, () => {
  for (const f of ["db.ts", "site.ts", "crypto.ts", "emails.ts", "meta.ts"]) {
    const src = code(f);
    assert.match(read(f), /^import "server-only";/, `${f} tem de começar por import "server-only"`);
    assert.ok(!src.includes("BI_INGEST_TOKEN"), `${f} não pode usar o BI_INGEST_TOKEN`);
    assert.ok(!/from "@\/lib\/support\/db"/.test(src), `${f} não pode usar o serverRpc do apoio`);
    assert.ok(!/SUPABASE_SERVICE_ROLE|service_role/i.test(src), `${f} não usa service_role`);
  }
  const db = read("db.ts");
  assert.match(db, /p_token: token/);
  assert.match(db, /const token = process\.env\.CREATORS_SERVER_TOKEN;/);
  // O hash dos IP usa a chave derivada do token próprio.
  assert.match(read("site.ts"), /ipHashWith\(token, /);
  assert.match(read("site.ts"), /process\.env\.CREATORS_SERVER_TOKEN/);
});

test("site.ts: creator cookie from the rules, never a literal name nor a Domain (rev. S-B1)", { skip: !exists && "lib/criadores ainda não existe" }, () => {
  const src = code("site.ts");
  assert.match(src, /creatorCookieName\(production\(\)\)/);
  assert.match(src, /creatorCookieOptions\(/);
  assert.match(src, /isCreatorSessionToken\(v\)/);
  assert.ok(!/["'`](?:__Host-)?ldo_criador["'`]/.test(src), "o nome do cookie vem de creatorCookieName");
  assert.ok(!/\bdomain\s*:/i.test(src), "o cookie nunca leva Domain");
  // sameOriginPost com CREATORS_URL e creatorsReady com o ambiente.
  assert.match(src, /sameOriginPostWith\(request, process\.env\.CREATORS_URL\)/);
  assert.match(src, /hasEncryptionKey: Boolean\(process\.env\.CREATORS_ENCRYPTION_KEY\)/);
});

test("emails.ts: account emails in after(), logo from the dashboard, nothing without creatorsReady (rev. S-B2, S-M4)", { skip: !exists && "lib/criadores ainda não existe" }, () => {
  const src = read("emails.ts");
  assert.match(src, /import \{ after \} from "next\/server";/);
  assert.match(src, /function later\(task: \(\) => Promise<unknown>\) \{\s*after\(/);
  const lines = src.split("\n");
  const problems = [];
  lines.forEach((line, i) => {
    if (/^\s*(?:export\s+)?const\s+send/.test(line)) return; // definições
    if (/\b(sendVerifyEmail|sendResetEmail|sendAccountExists)\(/.test(line) && !/later\(\(\) => /.test(line)) problems.push(`emails.ts:${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(problems, [], "os emails de conta saem em after() (later)");
  // Todo o HTML de email usa o endereço do dashboard para o logótipo.
  const html = [...src.matchAll(/creatorEmailHtml\(([^)]*\))\)/g)].map((m) => m[1]);
  assert.ok(html.length >= 1);
  for (const args of html) assert.match(args, /dashboardUrl\(\)$/, `creatorEmailHtml(${args})`);
  assert.match(src, /creatorsEmailReady\(\)\) return NOT_READY/);
  assert.match(src, /emailConfigured\(\) && creatorsReady\(\)/);
});

test("crypto.ts: key ring from CREATORS_ENCRYPTION_KEY (never the support key) and one AAD per purpose (rev. S-B12)", { skip: !exists && "lib/criadores ainda não existe" }, () => {
  const src = read("crypto.ts");
  assert.match(src, /creatorsKeyProblem\(process\.env\.CREATORS_ENCRYPTION_KEY, process\.env\.SUPPORT_ENCRYPTION_KEY\)/);
  assert.match(src, /parseKeyRing\(raw, support\)/);
  assert.match(src, /sealFor\("iban", creatorId/);
  assert.match(src, /openFor\("iban", creatorId/);
  assert.match(src, /sealFor\("fiscal", creatorId/);
  assert.match(src, /openFor\("fiscal", creatorId/);
  assert.ok(!/from "@\/lib\/support\/crypto"/.test(src), "não usa a cifra do apoio");
  // A regravação só corre com CREATORS_RESEAL_FROM e confere a AAD da linha.
  assert.match(src, /process\.env\.CREATORS_RESEAL_FROM/);
  assert.match(src, /x\.aad\.endsWith\(`:\$\{x\.id\}`\)/);
  // Os textos das declarações saem de CONSENT_TEXT (rev. R-B1).
  assert.match(src, /iban_owner: consentText\("iban_owner"\)/);
});
