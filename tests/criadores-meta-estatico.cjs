const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const m = require("../.test-build/criadores-meta-rules.js");

// Testes estáticos da fase 3A (dados públicos do Instagram): leem a migração e o código e confirmam o que a Política
// de Privacidade publicada promete (só números, nada de imagens nem biografia, parar apaga na hora, autorização própria)
// e as regras de segurança (o token só no cabeçalho, nunca em registos). As regras gerais das migrações (security
// definer, acessos, cr_server_check, cr_own, R-M4, S-B6) estão em tests/criadores-sql.cjs e valem também aqui.
const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "supabase", "migrations");
const FILE = fs.readdirSync(DIR).find((f) => /_ldo_creators_meta_public\.sql$/.test(f));
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const stripComments = (s) => s.replace(/--[^\n]*/g, "");
// Sem comentários de linha nem de bloco (TypeScript).
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ [^\n"'`]*$/gm, "");

// Última definição de cada função das migrações da plataforma (corpo sem comentários, em minúsculas).
const sources = fs.readdirSync(DIR).filter((f) => /_ldo_creators.*\.sql$/.test(f)).sort()
  .map((f) => ({ file: f, sql: fs.readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n") }));
const fns = new Map();
for (const { file, sql } of sources) {
  const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z0-9_]+)\s*\([\s\S]*?\)\s*returns[\s\S]*?\bas\s+\$(\w*)\$([\s\S]*?)\$\2\$/gi;
  let x;
  while ((x = re.exec(sql))) fns.set(x[1].toLowerCase().split(".")[1], { file, body: stripComments(x[3]).toLowerCase().replace(/\s+/g, " ") });
}
const body = (name) => {
  const f = fns.get(name);
  assert.ok(f, `falta a função ${name}`);
  return f.body;
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(f)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- SQL

test("the 3A migration exists and its tables keep only numbers, all hanging from the social account (cascade)", () => {
  assert.ok(FILE, "falta supabase/migrations/*_ldo_creators_meta_public.sql");
  const sql = stripComments(sources.find((s) => s.file === FILE).sql).toLowerCase();
  const tables = [...sql.matchAll(/create table public\.(ldo_cr_public_[a-z_]+) \(([\s\S]*?)\n\);/g)];
  assert.deepEqual(tables.map((t) => t[1]).sort(), ["ldo_cr_public_accounts", "ldo_cr_public_media", "ldo_cr_public_snapshots"]);
  for (const [, name, cols] of tables) {
    const defs = cols.split("\n").map((l) => l.trim()).filter((l) => l && !/^(check|primary key|unique|constraint|foreign key)\b/.test(l));
    for (const d of defs) {
      const col = d.split(/\s+/)[0];
      assert.doesNotMatch(col, /caption|media_url|thumbnail|permalink|shortcode|bio|username|profile_picture|name/, `${name}.${col}`);
    }
    for (const ref of cols.matchAll(/references\s+public\.[a-z_]+\s*\([a-z_]+\)([^,\n]*)/g)) assert.match(ref[1], /on delete cascade/, `${name}: ${ref[0]}`);
    assert.match(cols, /references/, `${name} sem FK`);
  }
  assert.match(sql, /add column public_mode text not null default 'off'/);
  assert.match(sql, /create table ldo_private\.cr_public_state/);
});

test("authorize, renew, proof and confirm refuse suspended or restricted accounts; stopping never does", () => {
  for (const f of ["ldo_cr_public_start", "ldo_cr_public_renew", "ldo_cr_public_proof", "ldo_cr_public_confirm"]) {
    assert.match(body(f), /ldo_private\.cr_creator_require\(p_session, true\)/, f);
  }
  const stop = body("ldo_cr_public_stop");
  assert.match(stop, /ldo_private\.cr_creator_require\(p_session, false\)/);
  assert.match(stop, /ldo_private\.cr_public_purge\(/);
  assert.doesNotMatch(stop, /public_mode/, "parar funciona com a leitura desligada");
  assert.match(body("ldo_cr_public_start"), /strpos\(coalesce\(p_text, ''\), '\(@' \|\| v_a\.handle \|\| '\)'\) = 0/, "o texto nomeia o @ da conta");
});

test("the purge deletes what was read and records the withdrawal of platform_public", () => {
  const purge = body("cr_public_purge");
  assert.match(purge, /delete from public\.ldo_cr_public_accounts where account_id = p_account/);
  assert.match(purge, /'platform_public', false/);
  assert.match(purge, /set verification = 'declared'/);
  for (const f of ["cr_social_upsert", "ldo_cr_social_delete", "cr_erase_optional"]) assert.match(body(f), /ldo_private\.cr_public_purge\(/, f);
  assert.match(body("ldo_cr_public_staff_stop"), /kind = 'withdrawal' and status = 'open' and \(identity_checked/);
});

test("lockdown switches the reading off; retention keeps the 24-month window and the proof of deletion", () => {
  assert.match(body("ldo_cr_lockdown"), /public_mode = 'off'/);
  const ret = body("cr_retention");
  const statements = ret.split(";");
  for (const t of ["ldo_cr_public_snapshots", "ldo_cr_public_media"]) {
    const st = statements.find((s) => s.includes(`delete from public.${t}`));
    assert.ok(st, `cr_retention não apaga ${t}`);
    assert.match(st, /ldo_private\.cr_ret\(r, 'platform_months'\)/, t);
    assert.doesNotMatch(st, /v_restricted/, `${t}: a janela da Meta vale também com a limitação`);
  }
  assert.match(ret, /v_decisions text\[\] := array\[[^\]]*'public\.stop'/, "public.stop nas decisões de 5 anos");
  assert.match(ret, /cr_public_purge\(v\.account_id, v\.creator_id, 'proof_expired'/);
  assert.match(ret, /cr_public_purge\(v\.account_id, v\.creator_id, 'not_found'/);
});

test("the tick only reads authorized, proven accounts of creators without limitation or suspension, with the switch on", () => {
  const claim = body("ldo_cr_public_claim");
  for (const s of ["status <> 'restricted'", "status <> 'suspended'", "deleted_at is null", "public_mode", "skip locked", "ldo_private.cr_public_granted(", "verification = 'public'", "paused_until > now()"])
    assert.ok(claim.includes(s), `claim sem «${s}»`);
  const put = body("ldo_cr_public_put");
  assert.match(put, /lease_until = p_lease/);
  assert.match(put, /'other_account'/);
  assert.match(put, /status in \('restricted', 'suspended'\)/);
});

test("proof attempts: 5 a day, serialized; the code lasts PUBLIC_CODE_DAYS days (mirror of the rules)", () => {
  const proof = body("ldo_cr_public_proof");
  assert.match(proof, new RegExp(`v_n >= ${m.PUBLIC_PROOF_PER_DAY}\\b`));
  assert.match(proof, /pg_advisory_xact_lock/);
  assert.match(proof, /kind = 'public_proof'/);
  assert.match(body("ldo_cr_public_get"), new RegExp(`greatest\\(0, ${m.PUBLIC_PROOF_PER_DAY} - `));
  for (const f of ["ldo_cr_public_start", "ldo_cr_public_renew"]) assert.match(body(f), new RegExp(`interval '${m.PUBLIC_CODE_DAYS} days'`), f);
});

test("codes for the biography: at most PUBLIC_CODES_PER_DAY per creator in 24 h (authorize and renew), serialized", () => {
  const quota = body("cr_public_code_quota");
  assert.match(quota, /pg_advisory_xact_lock/);
  assert.match(quota, new RegExp(`kind = 'public_code' and creator_id = p_creator and created_at > now\\(\\) - interval '24 hours'\\) >= ${m.PUBLIC_CODES_PER_DAY}\\b`));
  assert.match(quota, /insert into public\.ldo_cr_attempts \(kind, ip_hash, creator_id\) values \('public_code'/);
  for (const f of ["ldo_cr_public_start", "ldo_cr_public_renew"]) assert.match(body(f), /ldo_private\.cr_public_code_quota\(v_id, /, f);
  assert.doesNotMatch(body("ldo_cr_public_stop"), /cr_public_code_quota/, "parar não tem limite");
  const sql = stripComments(sources.find((s) => s.file === FILE).sql).toLowerCase();
  assert.match(sql, /add constraint ldo_cr_attempts_kind_check check \(kind in \([^)]*'public_proof', 'public_code'\)\)/);
});

test("authorizing never tells whether someone else has proven the @ (no enumeration); confirming does (taken)", () => {
  const start = body("ldo_cr_public_start");
  assert.doesNotMatch(start, /verification in \('public', 'verified'\)/);
  assert.doesNotMatch(start, /já foi confirmado/);
  assert.match(body("ldo_cr_public_confirm"), /when unique_violation then return jsonb_build_object\('ok', false, 'reason', 'taken'\)/);
});

test("views are kept only on reels, in the app and in the database", () => {
  assert.match(body("ldo_cr_public_put"), /case when v_item ->> 'product_type' = 'reels' then ldo_private\.cr_public_int\(v_item -> 'view_count'\) end/);
  assert.match(read("lib", "criadores-meta-rules.ts"), /view_count: product === "REELS" \? count\(m\.view_count\) : null/);
});

test("lock order: the social account before the public row, in the purge and in the reading", () => {
  const purge = body("cr_public_purge");
  const social = purge.indexOf("perform 1 from public.ldo_cr_social_accounts where id = p_account for update;");
  assert.ok(social >= 0, "cr_public_purge não bloqueia a conta social");
  assert.ok(social < purge.indexOf("delete from public.ldo_cr_public_accounts"), "a conta social primeiro");
  const put = body("ldo_cr_public_put");
  const a = put.indexOf("from public.ldo_cr_social_accounts where id = p_account for update");
  assert.ok(a >= 0 && a < put.indexOf("from public.ldo_cr_public_accounts where account_id = p_account and lease_until = p_lease for update"));
  // Na limpeza diária, os fins (que bloqueiam contas sociais) antes da janela (que bloqueia publicações).
  const ret = body("cr_retention");
  assert.ok(ret.indexOf("'not_found', null, null, null)") < ret.indexOf("delete from public.ldo_cr_public_media"));
});

test("state machine limits: error at the 4th not_found, end at 90 days, unconfirmed at 30, 3-minute lease", () => {
  assert.match(body("ldo_cr_public_fail"), /if p_error = 'not_found' and v_n >= 4 then/);
  const ret = body("cr_retention");
  assert.match(ret, /p\.state = 'proof' and p\.proof_expires_at < now\(\) - interval '30 days'/);
  assert.match(ret, /p\.state = 'error' and p\.last_error_at < now\(\) - interval '90 days' and c\.status <> 'restricted'/);
  assert.match(body("ldo_cr_public_claim"), /v_lease timestamptz := now\(\) \+ interval '3 minutes'/);
});

test("proof attempts lost to a Meta failure come back: proof returns the attempt, refund deletes only the creator's own", () => {
  assert.match(body("ldo_cr_public_proof"), /returning id into v_attempt/);
  assert.match(body("ldo_cr_public_proof"), /'attempt', v_attempt/);
  const refund = body("ldo_cr_public_proof_refund");
  assert.match(refund, /delete from public\.ldo_cr_attempts where id = p_attempt and kind = 'public_proof' and creator_id = v_id and created_at > now\(\) - interval '10 minutes'/);
});

test("the team's stop records the GDPR request that justified it, kept with the decisions", () => {
  assert.match(body("ldo_cr_public_staff_stop"), /ldo_private\.cr_log\('staff', v_me, p_id, 'privacy\.withdrawal', p_request, jsonb_build_object\('request_id', p_request/);
  assert.match(body("cr_retention"), /'public\.stop', 'privacy\.withdrawal'\]/);
});

test("the creator sees what the team sees: the last 30 readings and the 25 latest posts", () => {
  for (const f of ["ldo_cr_public_get", "ldo_cr_public_creator"]) {
    const b = body(f);
    assert.match(b, /'history', coalesce\(/, f);
    assert.match(b, /from public\.ldo_cr_public_snapshots where account_id = a\.id order by taken_on desc limit 30\)/, f);
    assert.match(b, /from public\.ldo_cr_public_media where account_id = a\.id order by posted_at desc limit 25\)/, f);
  }
  const numbers = code(read("app", "(criadores-site)", "c", "redes", "publico.tsx"));
  assert.doesNotMatch(numbers, /media\.slice\(/, "Redes mostra todas as publicações que a BD devolve");
  assert.match(numbers, /history\.map\(/);
});

test("export includes the public data; the creators list is the one of migration A (public numbers only on the profile)", () => {
  assert.match(body("cr_export_common"), /'public_instagram'/);
  assert.match(fns.get("ldo_cr_creators_list").file, /_ldo_creators_a\.sql$/);
});

// ---------------------------------------------------------------- servidor

test("lib/criadores/meta.ts: server-only, token only in the Authorization header, logs only through redact(e)", () => {
  const src = read("lib", "criadores", "meta.ts");
  const c = code(src);
  assert.match(src, /^import "server-only";/);
  assert.match(c, /Authorization: `Bearer \$\{/);
  assert.ok(!c.includes("access_token"), "o token nunca vai no URL");
  assert.doesNotMatch(c, /\.biography\b/, "a biografia não sai de parseBiography");
  const logs = c.split("\n").filter((l) => /\bconsole\.\w+\s*\(/.test(l));
  assert.ok(logs.length >= 1);
  for (const l of logs) assert.match(l.trim(), /^console\.\w+\("criadores meta[^"]*", redact\(e\)\);$/, l.trim());
  // Só meta.ts lê o token da Meta.
  const readers = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app"))]
    .filter((f) => /process\.env(?:\.META_SYSTEM_USER_TOKEN\b|\[["'`]META_SYSTEM_USER_TOKEN)/.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
  assert.deepEqual(readers, ["lib/criadores/meta.ts"]);
});

test("no Meta image (cdninstagram, fbcdn) on the creators site or in lib/criadores", () => {
  for (const f of [...walk(path.join(ROOT, "app", "(criadores-site)")), ...walk(path.join(ROOT, "lib", "criadores")), path.join(ROOT, "lib", "criadores-meta-rules.ts")])
    assert.doesNotMatch(code(fs.readFileSync(f, "utf8")), /cdninstagram|fbcdn/, path.relative(ROOT, f));
  assert.doesNotMatch(read("next.config.mjs"), /cdninstagram|fbcdn/);
});

test("the tick runs the reading next to the other tasks", () => {
  const tick = code(read("app", "api", "c", "tick", "route.ts"));
  assert.match(tick, /await Promise\.all\(\[[\s\S]*readPublicAccounts\(\{ budgetMs \}\)\.catch\([\s\S]*\]\)/);
  assert.match(tick, /from "@\/lib\/criadores\/meta"/);
});

// ---------------------------------------------------------------- site

test("site: the stop button says what the Policy says, without a password; consent texts come from CONSENT_TEXT", () => {
  const forms = code(read("app", "(criadores-site)", "c", "forms.tsx"));
  assert.match(forms, /PUBLIC_STOP_LABEL/);
  const stop = /export function PublicStopForm[\s\S]*?(?=\nexport |$)/.exec(forms);
  assert.ok(stop, "falta PublicStopForm");
  assert.doesNotMatch(stop[0], /type="password"|name="password"/);
  assert.match(stop[0], /cr-bt-perigo/);
  const start = /export function PublicStartForm[\s\S]*?(?=\nexport |$)/.exec(forms);
  assert.ok(start && /kind="Opcional"/.test(start[0]) && !/defaultChecked=\{true\}/.test(start[0]), "a caixa da autorização é opcional e desmarcada");
  const actions = code(read("app", "(criadores-site)", "c", "actions.ts"));
  for (const name of ["publicStartAction", "publicStopAction"]) {
    const fn = new RegExp(`export async function ${name}[\\s\\S]*?(?=\\nexport |$)`).exec(actions);
    assert.ok(fn, `falta ${name}`);
    assert.match(fn[0], /consentText\("platform_public", \{ handle: ig\.handle \}\)/, name);
  }
  assert.match(actions, /checkPublicProof\(session, id\)/);
});

test("site: «Parar a leitura» is reachable with Terms to accept, a suspended or a restricted account (art. 7.º, n.º 3)", () => {
  const page = code(read("app", "(criadores-site)", "c", "redes", "page.tsx"));
  assert.match(page, /requireCreator\(\{ allowReaccept: true \}\)/, "Redes abre com Termos por aceitar");
  const reacceptBlock = /if \(reaccept\) \{[\s\S]*?\n  \}/.exec(page);
  assert.ok(reacceptBlock && reacceptBlock[0].includes("{section}"), "com Termos por aceitar, Redes mostra o bloco dos dados públicos");
  assert.ok(!/SocialAccountForm|NewSocialForm/.test(reacceptBlock[0]), "e só esse bloco");
  assert.match(page, /reaccept=\{reaccept\}/);
  // Em cada estado com autorização (proof, active, error) o formulário de parar está lá, seja qual for o estado da conta.
  const pub = code(read("app", "(criadores-site)", "c", "redes", "publico.tsx"));
  const branches = pub.split(/if \(a && state === "/).slice(1);
  assert.deepEqual(branches.map((b) => b.slice(0, b.indexOf('"'))), ["proof", "active", "error"]);
  for (const b of branches) {
    const block = b.slice(0, b.indexOf("\n  }\n"));
    assert.match(block, /<Stop accountId=\{a\.account_id\}/, b.slice(0, 6));
    assert.doesNotMatch(block.slice(0, block.indexOf("<Stop ")), /return null/);
  }
  // Limitada ou suspensa: nem passos do código nem «Confirmar» (a BD recusa), e sem «Próxima leitura» (o tick não lê).
  assert.match(branches[0], /const blocked = blockedText\(status, "confirm"\)/);
  assert.match(branches[1], /const reading = available && !blocked;[\s\S]*<Numbers a=\{a\} active=\{reading\} \/>/);
  // O texto de parar está também na página dos Termos novos.
  assert.match(code(read("app", "(criadores-site)", "c", "conta", "novos-termos", "page.tsx")), /\/redes#t-ig/);
  // A falha da BD mostra um erro; só a função em falta (antes da migração) dá «Em breve».
  assert.match(read("lib", "criadores", "db.ts"), /e instanceof SupabaseError && e\.code === "PGRST202"\) return null;/);
  assert.match(page, /crPublicGetIfReady\(session\)\.then\(/);
  assert.match(page, /<PublicLoadError \/>/);
});

test("site: the copy button's message wraps inside the list (no horizontal scroll on narrow phones)", () => {
  const forms = code(read("app", "(criadores-site)", "c", "forms.tsx"));
  const copy = /export function CopyCode[\s\S]*?(?=\nexport |$)/.exec(forms);
  assert.ok(copy, "falta CopyCode");
  assert.match(copy[0], /className="cr-meta" role="status" style=\{\{ whiteSpace: "normal" \}\}/);
});

test("package.json compiles the 3A rules for the tests", () => {
  assert.match(read("package.json"), /lib\/criadores-meta-rules\.ts/);
});
