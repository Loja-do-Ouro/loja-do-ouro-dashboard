const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Testes estáticos das migrações da plataforma de criadores (*_ldo_creators*.sql), como migration-grants.cjs: leem o
// SQL e confirmam as regras de segurança e de RGPD da especificação (§0.3, §2.1, §2.4 e §8 PR1). Valem também para
// as migrações B, C1 e C2 quando entrarem (os «create or replace» herdam os acessos da primeira definição).
const root = path.join(__dirname, "..");
const dir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => /_ldo_creators.*\.sql$/.test(f)).sort();
const sources = files.map((f) => ({ file: f, sql: fs.readFileSync(path.join(dir, f), "utf8") }));

const stripComments = (s) => s.replace(/--[^\n]*/g, "");
// Corpos e textos entre $tag$ … $tag$ fora, para olhar só para as instruções de topo.
const stripDollar = (s) => s.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "$$$$");

const TYPE_ALIASES = { int: "integer", int4: "integer", int8: "bigint", bool: "boolean", "timestamp with time zone": "timestamptz" };
const normType = (t) => {
  const v = t.trim().toLowerCase().replace(/\s+/g, " ");
  return TYPE_ALIASES[v] || v;
};
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Todas as funções: nome, parâmetros, cabeçalho (returns … language … security …) e corpo (sem comentários).
const functions = [];
for (const { file, sql } of sources) {
  const re = /create\s+(or\s+replace\s+)?function\s+([a-z_]+\.[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*(returns[\s\S]*?)\bas\s+\$(\w*)\$([\s\S]*?)\$\5\$/gi;
  let m;
  while ((m = re.exec(sql))) {
    const params = splitTop(stripComments(m[3]))
      .map((p) => p.trim().replace(/\s+default\s+[\s\S]*$/i, ""))
      .filter(Boolean)
      .map((p) => {
        const [, name, type] = /^([a-z_][a-z0-9_]*)\s+([\s\S]+)$/i.exec(p.trim());
        return { name: name.toLowerCase(), type: normType(type) };
      });
    const name = m[2].toLowerCase();
    functions.push({
      file, replace: Boolean(m[1]), name, short: name.split(".")[1], params,
      sig: `${name}(${params.map((p) => p.type).join(", ")})`,
      header: stripComments(m[4]).toLowerCase().replace(/\s+/g, " "),
      body: stripComments(m[6]).toLowerCase(),
    });
  }
}
const creators = functions.filter((f) => f.name.startsWith("public.ldo_cr_"));
const privates = functions.filter((f) => f.name.startsWith("ldo_private.cr_"));
const fn = (short) => functions.filter((f) => f.short === short);
const last = (short) => fn(short).at(-1);

// Instruções revoke/grant sobre funções: assinaturas e destinatários.
function grantStatements(kind) {
  const out = [];
  for (const { file, sql } of sources) {
    const top = stripDollar(stripComments(sql)).toLowerCase();
    const re = kind === "revoke"
      ? /revoke\s+all\s+on\s+function\s+([\s\S]*?)\s+from\s+([^;]*);/g
      : /grant\s+execute\s+on\s+function\s+([\s\S]*?)\s+to\s+([^;]*);/g;
    let m;
    while ((m = re.exec(top))) {
      const sigs = [];
      const sr = /([a-z_]+\.[a-z0-9_]+)\s*\(([^)]*)\)/g;
      let s;
      while ((s = sr.exec(m[1]))) sigs.push(`${s[1]}(${s[2].split(",").map((t) => t.trim()).filter(Boolean).map(normType).join(", ")})`);
      out.push({ file, sigs, roles: m[2].split(",").map((r) => r.trim()) });
    }
  }
  return out;
}
const revokes = grantStatements("revoke");
const grants = grantStatements("grant");
const covered = (list, f, roles) =>
  list.some((st) => (f.replace || st.file === f.file) && st.sigs.includes(f.sig) && roles.every((r) => st.roles.includes(r)));

// Argumentos de cada chamada a `name(` (com parênteses equilibrados).
function calls(body, name) {
  const out = [];
  let i = body.indexOf(name + "(");
  while (i !== -1) {
    let depth = 0;
    let j = i + name.length;
    for (; j < body.length; j++) {
      if (body[j] === "(") depth++;
      else if (body[j] === ")" && --depth === 0) break;
    }
    out.push(body.slice(i + name.length + 1, j));
    i = body.indexOf(name + "(", j);
  }
  return out;
}

// Passa por `needle` em todos os caminhos até à posição idx? Segue os blocos if/elsif/else e loop do PL/pgSQL.
function executedBefore(body, idx, needle) {
  const stack = [{ found: false }];
  const re = new RegExp(`\\bend\\s+if\\b|\\bend\\s+loop\\b|\\belsif\\b|\\belse\\b|\\bif\\b|\\bloop\\b|${needle.replace(/[.(]/g, "\\$&")}`, "g");
  let m;
  while ((m = re.exec(body)) && m.index < idx) {
    const t = m[0].replace(/\s+/g, " ");
    if (t === "if" || t === "loop") stack.push({ found: false });
    else if (t === "end if" || t === "end loop") stack.pop();
    else if (t === "elsif" || t === "else") stack[stack.length - 1].found = false;
    else stack[stack.length - 1].found = true;
  }
  return stack.some((f) => f.found);
}

test("há a migração A da plataforma de criadores e as funções foram lidas", () => {
  assert.ok(files.some((f) => /_ldo_creators_a\.sql$/.test(f)), "falta a migração A");
  assert.ok(creators.length >= 50, `só ${creators.length} funções public.ldo_cr_*`);
  assert.ok(privates.length >= 20, `só ${privates.length} funções ldo_private.cr_*`);
});

test("cada public.ldo_cr_* é security definer com search_path vazio, revogada a public/authenticated e dada a anon", () => {
  const problems = [];
  for (const f of creators) {
    if (!/\bsecurity definer\b/.test(f.header) || !/set search_path = ''/.test(f.header)) problems.push(`${f.file}: ${f.sig} sem security definer/search_path ''`);
    if (!covered(revokes, f, ["public", "authenticated"])) problems.push(`${f.file}: ${f.sig} sem revoke … from public, authenticated`);
    if (!covered(grants, f, ["anon"])) problems.push(`${f.file}: ${f.sig} sem grant execute … to anon`);
  }
  assert.deepEqual(problems, []);
});

test("cada ldo_private.cr_* é revogada a public, anon e authenticated", () => {
  const problems = privates.filter((f) => !covered(revokes, f, ["public", "anon", "authenticated"])).map((f) => `${f.file}: ${f.sig}`);
  assert.deepEqual(problems, []);
});

test("[rev. S-M3] com p_token como 1.º parâmetro, a primeira instrução é cr_server_check(p_token); nunca bi_check", () => {
  const problems = [];
  for (const { file, sql } of sources) if (/bi_check/i.test(stripComments(sql))) problems.push(`${file}: usa bi_check`);
  for (const f of creators.filter((x) => x.params[0] && x.params[0].name === "p_token")) {
    const afterBegin = f.body.slice(f.body.search(/\bbegin\b/) + 5).trim();
    if (!afterBegin.startsWith("perform ldo_private.cr_server_check(p_token);")) problems.push(`${f.file}: ${f.sig} não começa por cr_server_check(p_token)`);
  }
  assert.deepEqual(problems, []);
});

test("com p_session como 1.º parâmetro, a função chama cr_require, cr_finance ou support_super", () => {
  const problems = creators
    .filter((f) => f.params[0] && f.params[0].name === "p_session")
    .filter((f) => !/ldo_private\.(cr_require|cr_finance|support_super)\(p_session/.test(f.body))
    .map((f) => `${f.file}: ${f.sig}`);
  assert.deepEqual(problems, []);
});

// [rev. S-B4] Exceções, cada uma com o motivo.
const OWN_EXEMPT = {
  ldo_cr_legal_accept: "só aceita o documento legal publicado (não é um objeto do criador)",
  ldo_cr_apply: "só aceita campanhas publicadas e abertas (não é um objeto do criador)",
};
test("[rev. S-B4] as funções de site que recebem um uuid verificam a posse com ldo_private.cr_own", () => {
  const problems = creators
    .filter((f) => f.params[0]?.name === "p_token" && f.params[1]?.name === "p_session")
    .filter((f) => f.params.some((p) => p.type === "uuid") && !(f.short in OWN_EXEMPT))
    .filter((f) => !f.body.includes("ldo_private.cr_own("))
    .map((f) => `${f.file}: ${f.sig}`);
  assert.deepEqual(problems, []);
  // cr_own recusa sempre com o mesmo erro (não revela se o id existe).
  for (const f of fn("cr_own")) assert.match(f.body, /errcode = 'p0002'/);
});

test("nenhum grant a authenticated", () => {
  for (const { file, sql } of sources) {
    const top = stripDollar(stripComments(sql)).toLowerCase();
    const re = /grant\s[^;]*?\sto\s([^;]*);/g;
    let m;
    while ((m = re.exec(top))) assert.ok(!/\bauthenticated\b/.test(m[1]), `${file}: grant … to ${m[1]}`);
  }
});

test("[rev. S-B2] em ldo_cr_register, os caminhos quiet, pending e exists correm o bcrypt antes do return", () => {
  for (const f of fn("ldo_cr_register")) {
    const seen = new Set();
    const re = /return\s+jsonb_build_object\(\s*'status',\s*'(quiet|pending|exists)'/g;
    let m;
    while ((m = re.exec(f.body))) {
      seen.add(m[1]);
      assert.ok(executedBefore(f.body, m.index, "extensions.crypt("), `${f.file}: caminho ${m[1]} sem extensions.crypt( antes do return`);
    }
    assert.deepEqual([...seen].sort(), ["exists", "pending", "quiet"]);
  }
});

test("[rev. S-M8, R-M9] iban_ct só sai de ldo_cr_finance_reveal e de ldo_cr_export; iban_pending_ct nunca; a exportação da equipa sem *_ct", () => {
  const problems = [];
  for (const f of functions) {
    for (const args of calls(f.body, "jsonb_build_object")) {
      if (/'iban_ct'/.test(args) && !["ldo_cr_finance_reveal", "ldo_cr_export"].includes(f.short)) problems.push(`${f.file}: ${f.sig} devolve iban_ct`);
      // («iban_pending_ct is not null» só diz se há um IBAN pendente; não o devolve.)
      if (/iban_pending_ct(?!\s+is\s+(not\s+)?null)/.test(args)) problems.push(`${f.file}: ${f.sig} devolve iban_pending_ct`);
    }
    // Uma linha inteira (to_jsonb(f), row_to_json(x), jsonb_agg(f)) numa função que lê ldo_cr_finance levaria os cifrados.
    if (/ldo_cr_finance\b/.test(f.body) && /\b(to_jsonb|row_to_json|jsonb_agg)\(\s*[a-z_]+\s*\)/.test(f.body)
      && !["ldo_cr_reseal_batch"].includes(f.short)) problems.push(`${f.file}: ${f.sig} converte linhas inteiras em JSON e lê ldo_cr_finance`);
  }
  for (const short of ["ldo_cr_admin_export", "cr_export_common"]) {
    for (const f of fn(short)) if (/\b(iban_ct|fiscal_ct|address_ct|payee_ct|token_ct)\b/.test(f.body)) problems.push(`${f.file}: ${f.sig} tem dados cifrados`);
  }
  assert.deepEqual(problems, []);
  assert.ok(calls(last("ldo_cr_finance_reveal").body, "jsonb_build_object").some((a) => /'iban_ct'/.test(a)));
  assert.ok(calls(last("ldo_cr_export").body, "jsonb_build_object").some((a) => /'iban_ct'/.test(a)));
});

test("[rev. S-M8] ldo_cr_finance_reveal pede a palavra-passe e a falha não levanta erro (fica gravada)", () => {
  for (const f of fn("ldo_cr_finance_reveal")) {
    const i = f.body.indexOf("extensions.crypt(");
    assert.ok(i > 0, `${f.file}: sem crypt(`);
    const ret = f.body.indexOf("return", i);
    assert.ok(ret > i);
    assert.ok(!/\braise\b/.test(f.body.slice(i, ret)), `${f.file}: raise entre a falha da palavra-passe e o return`);
    assert.match(f.body.slice(i, ret), /failed_logins/);
  }
});

test("[rev. R-M3] auditoria e consentimentos só de acrescento (before update or delete); eventos e revisões before update", () => {
  const all = sources.map((s) => stripComments(s.sql).toLowerCase().replace(/\s+/g, " ")).join("\n");
  for (const t of ["ldo_cr_audit", "ldo_cr_consents"]) {
    assert.match(all, new RegExp(`create trigger \\w+ before update or delete on public\\.${t} for each row execute function ldo_private\\.cr_append_only\\(\\)`), t);
  }
  for (const t of ["ldo_cr_application_events", "ldo_cr_submission_reviews"]) {
    if (!new RegExp(`create table public\\.${t}\\b`).test(all)) continue;
    assert.match(all, new RegExp(`create trigger \\w+ before update (or delete )?on public\\.${t} for each row execute function ldo_private\\.cr_append_only\\(\\)`), t);
  }
});

test("[rev. R-M3] a exceção do «on delete set null» só vale dentro da ação referencial e TRUNCATE é recusado", () => {
  const versions = fn("cr_append_only");
  assert.ok(versions.length >= 1);
  for (const f of versions) {
    assert.match(f.body, /pg_trigger_depth\(\) > 1 and \(to_jsonb\(new\) - v_fk\) = \(to_jsonb\(old\) - v_fk\)/, f.file);
    assert.match(f.body, /if tg_op = 'truncate' then/, f.file);
  }
  const all = sources.map((s) => stripComments(s.sql).toLowerCase().replace(/\s+/g, " ")).join("\n");
  for (const t of ["ldo_cr_audit", "ldo_cr_consents"]) {
    assert.match(all, new RegExp(`create trigger \\w+ before truncate on public\\.${t} for each statement execute function ldo_private\\.cr_append_only\\(\\)`), t);
  }
});

test("[rev. S-B6] todos os prazos de cr_retention passam por cr_ret (nunca r ->> 'chave')", () => {
  const versions = fn("cr_retention");
  assert.ok(versions.length >= 1);
  for (const f of versions) {
    assert.ok(!f.body.includes("(r ->> '"), `${f.file}: cr_retention lê (r ->> '…')`);
    assert.ok(!/\br\s*->>?\s*'/.test(f.body), `${f.file}: cr_retention lê r -> '…'`);
    for (const args of calls(f.body, "make_interval")) assert.match(args, /ldo_private\.cr_ret\(r, '/, `${f.file}: make_interval(${args}) sem cr_ret`);
  }
  for (const f of fn("cr_ret")) assert.match(f.body, /'payments_years' then 10/);
});

test("[rev. R-A1] a auditoria e o registo de sincronização nunca gravam o username da Meta", () => {
  const problems = [];
  for (const f of functions) {
    for (const args of calls(f.body, "ldo_private.cr_log")) if (/'meta\./.test(args) && /username/.test(args)) problems.push(`${f.file}: ${f.sig} cr_log meta com username`);
    // Fase 3A: a auditoria da camada pública leva só ids e motivos, nunca o @ nem números lidos da Meta.
    for (const args of calls(f.body, "ldo_private.cr_log")) {
      if (/'public\./.test(args) && /username|handle|followers|media_count|like_count|comments_count|view_count|biography/.test(args))
        problems.push(`${f.file}: ${f.sig} cr_log public com dados da Meta`);
    }
    const re = /insert\s+into\s+public\.ldo_cr_sync_log\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(f.body))) if (/username/.test(m[1])) problems.push(`${f.file}: ${f.sig} grava username em ldo_cr_sync_log`);
  }
  assert.deepEqual(problems, []);
});

test("[rev. R-M4] nenhum raise exception depois de um cr_log no mesmo ramo", () => {
  const problems = [];
  for (const f of functions) {
    let i = f.body.indexOf("ldo_private.cr_log(");
    while (i !== -1) {
      const r = f.body.indexOf("raise exception", i);
      if (r !== -1 && !/end if;|\belse\b|\breturn\b|\bexception\b/.test(f.body.slice(i, r))) problems.push(`${f.file}: ${f.sig}`);
      i = f.body.indexOf("ldo_private.cr_log(", i + 1);
    }
  }
  assert.deepEqual(problems, []);
});

test("[rev. R-B1] cr_consent recusa um texto vazio (22023) e nunca usa a finalidade como texto", () => {
  for (const f of fn("cr_consent")) {
    assert.match(f.body, /if coalesce\(btrim\(p_text\), ''\) = '' then\s+raise exception [^;]*errcode = '22023'/);
    for (const args of calls(f.body, "coalesce")) assert.ok(!/p_purpose/.test(args), `${f.file}: coalesce(${args})`);
  }
});

test("[rev. R-B1] c/actions.ts não lê textos de consentimento do formulário (só as caixas)", (t) => {
  const file = path.join(root, "app", "(criadores-site)", "c", "actions.ts");
  if (!fs.existsSync(file)) return t.skip("app/(criadores-site)/c/actions.ts ainda não existe");
  const src = fs.readFileSync(file, "utf8");
  assert.match(src, /CONSENT_TEXT/);
  assert.ok(!/\.get\(\s*["'`](texts?([._[]|$)|text_|[^"'`]*consent[^"'`]*text|[^"'`]*text_shown)/i.test(src), "um texto de consentimento vem do FormData");
});

test("[rev. META-15] a migração A já leva os valores de esquema da camada pública, sem comportamento", () => {
  const a = stripComments(sources.find((s) => /_ldo_creators_a\.sql$/.test(s.file)).sql);
  assert.match(a, /verification in \('declared', 'public', 'verified', 'revoked'\)/);
  assert.match(a, /where verification in \('public', 'verified'\)/);
  assert.match(a, /'platform_public'/);
  assert.match(a, /'public_proof'/);
});

test("tabelas de ldo_private com RLS e sem privilégios; a linha de cr_token não vem na migração", () => {
  for (const { file, sql } of sources) {
    const top = stripDollar(stripComments(sql)).toLowerCase().replace(/\s+/g, " ");
    for (const m of top.matchAll(/create table ldo_private\.([a-z0-9_]+)/g)) {
      assert.match(top, new RegExp(`alter table ldo_private\\.${m[1]} enable row level security`), `${file}: ${m[1]}`);
      assert.match(top, new RegExp(`revoke all on ldo_private\\.${m[1]} from public, anon, authenticated`), `${file}: ${m[1]}`);
    }
    assert.ok(!/insert into ldo_private\.cr_token/.test(top), `${file}: o hash do token entra à mão, depois do merge`);
  }
});

test("agendamentos: limpeza diária às 03:41 e tick de 5 em 5 minutos com o segredo do Vault", () => {
  const all = sources.map((s) => s.sql).join("\n");
  assert.match(all, /cron\.schedule\('ldo-creators-retention', '41 3 \* \* \*', \$\$select ldo_private\.cr_retention\(\)\$\$\)/);
  const tick = sources.find((s) => /_ldo_creators_tick_schedule\.sql$/.test(s.file));
  assert.ok(tick, "falta …_ldo_creators_tick_schedule.sql");
  assert.match(tick.sql, /cron\.schedule\('ldo-creators-tick', '\*\/5 \* \* \* \*'/);
  assert.match(tick.sql, /\/api\/c\/tick/);
  assert.match(tick.sql, /name = 'ldo_creators_tick'/);
  assert.match(all, /vault\.create_secret\([^;]*'ldo_creators_tick'/);
});

// Rascunhos legais da migração A (o teste do texto também está em tests/criadores.cjs, do lado da aplicação).
function seed(kind) {
  const a = sources.find((s) => /_ldo_creators_a\.sql$/.test(s.file)).sql;
  const m = new RegExp(`\\$${kind}\\$([\\s\\S]*?)\\$${kind}\\$`).exec(a);
  assert.ok(m, `falta o rascunho ${kind}`);
  return m[1];
}
test("[rev. R-M12, META-4] rascunhos legais 0.1, por publicar, com a Política corrigida e as instruções da Meta", () => {
  const privacy = seed("privacy");
  for (const s of ["Cloudinary", "fornecedor de autenticação", "data de nascimento", "[30] dias", "adequação temática",
    "autenticação forte", "encaminhamento de pedidos de IA", "Instagram Login"]) assert.ok(!privacy.includes(s), `privacy contém «${s}»`);
  for (const s of ["www.cnpd.pt", "/dados-meta", "biografia"]) assert.ok(privacy.includes(s), `privacy sem «${s}»`);
  const meta = seed("meta_data");
  for (const s of ["Parar a leitura e apagar os dados públicos", "Integrações"]) assert.ok(meta.includes(s), `meta_data sem «${s}»`);
  for (const k of ["terms", "cookies"]) assert.ok(seed(k).includes("Em revisão jurídica"));
  const a = stripComments(sources.find((s) => /_ldo_creators_a\.sql$/.test(s.file)).sql);
  const insert = /insert into public\.ldo_cr_legal_documents \(([^)]*)\)/.exec(a);
  assert.ok(insert && !/status|published/.test(insert[1]), "os rascunhos não podem entrar publicados");
});
