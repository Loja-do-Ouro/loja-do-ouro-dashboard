// Teste funcional da migração 3A (dados públicos do Instagram): aplica as migrações reais do repositório numa base
// PGlite local (Postgres em WASM, em memória) e percorre autorizar → provar → ler → falhar → limpar → parar, com as
// recusas, os limites e os acessos. Não toca em nada remoto. Não corre no npm test (precisa do @electric-sql/pglite,
// que não é dependência do projeto):
//   npm i --no-save @electric-sql/pglite@0.5.8 && node scripts/criadores-meta-smoke.mjs
// (ou PGLITE_MODULES=<pasta node_modules com o pglite> node scripts/criadores-meta-smoke.mjs)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const lib = (p) => (process.env.PGLITE_MODULES ? pathToFileURL(path.join(process.env.PGLITE_MODULES, "@electric-sql", "pglite", "dist", p)).href : `@electric-sql/pglite${p === "index.js" ? "" : "/contrib/pgcrypto"}`);
const { PGlite } = await import(lib("index.js"));
const { pgcrypto } = await import(lib("contrib/pgcrypto.js"));

// ---------------------------------------------------------------- base

// O que a Supabase fornece e as migrações usam (papéis, extensões, Vault, pg_cron, pg_net) e as tabelas que vêm de
// fora do histórico de migrações.
const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema extensions; create extension pgcrypto with schema extensions;
create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(p_secret text, p_name text, p_description text default '') returns uuid language sql as
  $$ insert into vault.secrets (name, secret, description) values (p_name, p_secret, p_description) returning id $$;
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$ delete from cron.job where jobname = p_name returning true $$;
create table public.stores (id uuid primary key default gen_random_uuid(), code text, slug text, name text, city text,
  sort_order integer default 1, active boolean default true);
insert into public.stores (code, slug, name, city) values ('lisboa', 'lisboa', 'Loja do Ouro — Lisboa', 'Lisboa'),
  ('porto', 'porto', 'Loja do Ouro — Porto', 'Porto');
create schema net;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 1000)
  returns bigint language sql as $$ select 1::bigint $$;
` + ["daily", "datasets", "quality", "raw", "reports", "runs", "members"]
  .map((t) => `create table public.ldo_bi_${t} (id bigserial primary key${t === "members" ? ", user_id uuid" : ""}, payload jsonb);
alter table public.ldo_bi_${t} enable row level security;
grant select on public.ldo_bi_${t} to authenticated;`).join("\n") + `
create policy ldo_bi_member_read on public.ldo_bi_daily for select to authenticated using (true);
create policy ldo_bi_member_read on public.ldo_bi_runs for select to authenticated using (true);
create policy ldo_bi_member_self on public.ldo_bi_members for select to authenticated using (true);`;

// Instruções de um ficheiro SQL, separadas nos «;» de topo (fora de textos, identificadores, $tag$ e comentários).
function statements(sql) {
  const out = [];
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      i = j < 0 ? sql.length : j + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      i = j < 0 ? sql.length : j + 2;
    } else if (c === "'") {
      const escapes = /[eE]/.test(sql[i - 1] || "") && !/[A-Za-z0-9_]/.test(sql[i - 2] || "");
      i++;
      while (i < sql.length) {
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
    } else if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      i = j < 0 ? sql.length : j + 1;
    } else if (c === "$" && !/[A-Za-z0-9_]/.test(sql[i - 1] || "")) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const j = sql.indexOf(m[0], i + m[0].length);
        i = j < 0 ? sql.length : j + m[0].length;
      } else i++;
    } else if (c === ";") {
      out.push(sql.slice(start, i + 1));
      start = ++i;
    } else i++;
  }
  if (sql.slice(start).trim()) out.push(sql.slice(start));
  return out.filter((s) => s.replace(/--[^\n]*/g, "").trim() && s.replace(/--[^\n]*/g, "").trim() !== ";");
}

// As migrações da plataforma de criadores aplicam-se inteiras e sem erros; as do histórico, instrução a instrução,
// ignorando o que depende de objetos que só existem em produção.
const STRICT = (f) => /_ldo_creators|_ldo_bi_auth_unlink/.test(f);
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(STUBS);
const skipped = [];
for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
  // Em produção o ficheiro chega com LF; o checkout no Windows pode ter CRLF.
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8").replace(/\r\n/g, "\n")
    .replace(/create extension if not exists (pg_net|pg_cron|pgcrypto)[^;]*;/gi, "");
  if (STRICT(f)) {
    try {
      await db.exec(sql);
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
    continue;
  }
  for (const st of statements(sql)) {
    try {
      await db.exec(st);
    } catch (e) {
      skipped.push(`${f}: ${e.message}`);
    }
  }
}
if (process.env.VERBOSE) console.log("instruções do histórico ignoradas:\n  " + skipped.join("\n  "));

const T = "token-do-servidor-de-teste";
const h = (s) => crypto.createHash("sha256").update(s).digest("hex");
const ip = h("ip1");
let n = 0;
const step = (m) => console.log(`${++n}. ${m}`);

async function q(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function one(sql, params = []) {
  const r = await q(sql, params);
  return r[0] ? Object.values(r[0])[0] : undefined;
}
async function fails(sql, params, code, re) {
  try {
    await db.query(sql, params);
  } catch (e) {
    if (code) assert.equal(e.code, code, `${sql}: código ${e.code} (${e.message})`);
    if (re) assert.match(e.message, re);
    return e;
  }
  assert.fail(`devia falhar: ${sql}`);
}

// ---------------------------------------------------------------- equipa, documentos, criadores

const mkUser = async (username, extra) => {
  const id = await one(`insert into public.ldo_app_users (username, full_name, password_hash, password_changed_at, ${Object.keys(extra).join(", ")})
    values ($1, $1, extensions.crypt('palavra-passe-1', extensions.gen_salt('bf', 4)), now() - interval '1 minute', ${Object.keys(extra).map((_, i) => "$" + (i + 2)).join(", ")}) returning id`,
    [username, ...Object.values(extra)]);
  return { id, s: await one("select ldo_private.new_session($1)", [id]) };
};
const sup = await mkUser("superadmin", { is_super_admin: true, email: "super@lojadoouro.pt" });
const viewer = await mkUser("consulta", { creators_access: "view" });
const manager = await mkUser("gestor", { creators_access: "manage" });
await q("insert into ldo_private.cr_token values (1, decode($1, 'hex'))", [h(T)]);

for (const k of ["terms", "privacy"]) {
  await q("select public.ldo_cr_legal_publish($1, (select id from public.ldo_cr_legal_documents where kind = $2))", [sup.s, k]);
}
await q("select public.ldo_cr_settings_save($1, '{\"registrations_open\": true}')", [sup.s]);
const texts = { terms: "Aceito os Termos.", privacy_notice: "Li a Política.", adult: "Tenho 18 anos." };
async function creator(email, name, ipx) {
  await q(`select public.ldo_cr_register($1, $2, 'segredo12345', $3, (select id from public.ldo_cr_legal_documents where kind = 'terms' and status = 'published'),
    (select id from public.ldo_cr_legal_documents where kind = 'privacy' and status = 'published'), true, $4::jsonb, $5)`, [T, email, name, JSON.stringify(texts), ipx]);
  const id = await one("select id from public.ldo_cr_creators where email = $1", [email]);
  await q("update public.ldo_cr_creators set email_verified_at = now() where id = $1", [id]);
  const s = (await one("select public.ldo_cr_login($1, $2, 'segredo12345', $3)", [T, email, ipx])).session;
  return { id, s };
}
const ana = await creator("ana@exemplo.pt", "Ana Silva", h("ipa"));
const rui = await creator("rui@exemplo.pt", "Rui Lopes", h("ipr"));
const eva = await creator("eva@exemplo.pt", "Eva Costa", h("ipe"));
await q("select public.ldo_cr_profile_save($1, $2, 'networks', $3)", [T, ana.s,
  { accounts: [{ platform: "instagram", handle: "@Ana.Silva", metrics: { followers: "12000" } }, { platform: "tiktok", handle: "ana-silva" }] }]);
const anaIg = await one("select id from public.ldo_cr_social_accounts where creator_id = $1 and platform = 'instagram'", [ana.id]);
const anaTk = await one("select id from public.ldo_cr_social_accounts where creator_id = $1 and platform = 'tiktok'", [ana.id]);
const TEXT = (hd) => `Autorizo a Loja do Ouro a ler, através da Meta, os números públicos da minha conta profissional do Instagram (@${hd}): seguidores…`;

const get = (s) => one("select public.ldo_cr_public_get($1, $2)", [T, s]);
const start = (s, acc, text) => one("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, s, acc, text, ip]);
const renew = (s, acc) => one("select public.ldo_cr_public_renew($1, $2, $3)", [T, s, acc]);
const proof = (s, acc) => one("select public.ldo_cr_public_proof($1, $2, $3, $4)", [T, s, acc, ip]);
const refund = (s, attempt) => one("select public.ldo_cr_public_proof_refund($1, $2, $3)", [T, s, attempt]);
const confirm = (s, acc, hd, code, ig) => one("select public.ldo_cr_public_confirm($1, $2, $3, $4, $5, $6)", [T, s, acc, hd, code, ig]);
const claim = (lim = 10) => one("select public.ldo_cr_public_claim($1, $2)", [T, lim]);
const put = (acc, lease, ig, f, mc, media) => one("select public.ldo_cr_public_put($1, $2, $3, $4, $5, $6, $7)", [T, acc, lease, ig, f, mc, JSON.stringify(media)]);
const fail = (acc, lease, err) => one("select public.ldo_cr_public_fail($1, $2, $3, $4)", [T, acc, lease, err]);
const health = (kind, code = null, mins = null, usage = null) => one("select public.ldo_cr_public_health($1, $2, $3, $4, $5)", [T, kind, code, mins, usage]);
const consentNow = async (id) => (await one("select ldo_private.cr_consent_state($1)", [id])).platform_public;
const due = (acc) => q("update public.ldo_cr_public_accounts set next_at = now() - interval '1 minute' where account_id = $1", [acc]);
// Passa o tempo dos limites diários (códigos e tentativas de confirmação).
const nextDay = () => q("update public.ldo_cr_attempts set created_at = created_at - interval '25 hours' where kind in ('public_code', 'public_proof')");

// ---------------------------------------------------------------- passos

step("auxiliares: código, inteiros, kinds de ldo_cr_attempts");
for (let i = 0; i < 200; i++) assert.match(await one("select ldo_private.cr_public_code()"), /^LDO-[2-9A-HJ-NP-Z]{6}$/);
for (const [v, want] of [["12", 12], ["0", 0], ["-1", null], ["1.5", null], ['"12"', null], ["null", null], ["1e13", null], ["123456789012", 123456789012]])
  assert.equal(await one(`select ldo_private.cr_public_int('${v}'::jsonb)`), want, v);
assert.equal(await one("select ldo_private.cr_public_int(null)"), null);
await fails("insert into public.ldo_cr_attempts (kind) values ('xpto')", [], "23514");
for (const kind of ["login_fail", "iban_resend", "public_proof", "public_code"]) await q("insert into public.ldo_cr_attempts (kind) values ($1)", [kind]);
await q("delete from public.ldo_cr_attempts");

step("estado inicial e interruptor (só o Super Admin)");
let g = await get(ana.s);
assert.equal(g.mode, "off");
assert.equal(g.granted, false);
assert.equal(g.proof_left, 5);
assert.equal(g.account.state, null);
assert.equal(g.account.handle, "Ana.Silva");
assert.deepEqual(g.account.media, []);
assert.deepEqual(g.account.history, []);
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, ana.s, anaIg, TEXT("Ana.Silva"), ip], "22023", /desligada/);
await fails("select public.ldo_cr_public_mode($1, 'on')", [manager.s], "42501", /Super Admin/);
await fails("select public.ldo_cr_public_mode($1, 'on')", [viewer.s], "42501");
await fails("select public.ldo_cr_public_mode($1, 'talvez')", [sup.s], "22023");
assert.deepEqual(await one("select public.ldo_cr_public_mode($1, 'on')", [sup.s]), { public_mode: "on" });
assert.deepEqual(await one("select details from public.ldo_cr_audit where action = 'settings.save' order by id desc limit 1"),
  { before: { public_mode: "off" }, after: { public_mode: "on" } });
await q("select public.ldo_cr_public_mode($1, 'on')", [sup.s]);
assert.equal(await one(`select count(*)::int from public.ldo_cr_audit where action = 'settings.save'
  and details = '{"before": {"public_mode": "off"}, "after": {"public_mode": "on"}}'::jsonb`), 1, "sem mudança, sem registo");
assert.equal((await one("select public.ldo_cr_settings_get($1)", [viewer.s])).public_mode, "on");
await q("select public.ldo_cr_settings_save($1, '{\"session_days\": 10}')", [sup.s]);
assert.equal(await one("select public_mode from public.ldo_cr_settings"), "on", "ldo_cr_settings_save não mexe no interruptor");

step("autorizar: recusas e sucesso");
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, ana.s, anaIg, TEXT("outra"), ip], "22023", /não corresponde/);
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, ana.s, anaTk, TEXT("ana-silva"), ip], "22023", /Só as contas do Instagram/);
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, rui.s, anaIg, TEXT("Ana.Silva"), ip], "P0002");
assert.equal(await one("select count(*)::int from public.ldo_cr_attempts where kind = 'public_code'"), 0, "as recusas não contam");
let r = await start(ana.s, anaIg, TEXT("Ana.Silva"));
assert.equal(r.state, "proof");
assert.match(r.code, /^LDO-[2-9A-HJ-NP-Z]{6}$/);
const exp = Date.parse(r.expires_at) - Date.now();
assert.ok(exp > 6.9 * 86400e3 && exp < 7.1 * 86400e3);
assert.equal((await consentNow(ana.id)).granted, true);
assert.equal((await consentNow(ana.id)).document_id, null);
assert.equal(await one("select count(*)::int from public.ldo_cr_audit where action = 'public.start' and creator_id = $1", [ana.id]), 1);
assert.equal(await one("select count(*)::int from public.ldo_cr_attempts where kind = 'public_code' and creator_id = $1", [ana.id]), 1);
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, ana.s, anaIg, TEXT("Ana.Silva"), ip], "22023", /Já autorizou/);
g = await get(ana.s);
assert.equal(g.account.state, "proof");
assert.equal(g.account.code, r.code);
assert.equal(g.granted, true);
let code = r.code;

step("código novo");
r = await renew(ana.s, anaIg);
assert.match(r.code, /^LDO-/);
code = r.code;
await fails("select public.ldo_cr_public_renew($1, $2, $3)", [T, ana.s, anaTk], "22023", /já não está à espera/);
assert.equal(await one("select count(*)::int from public.ldo_cr_attempts where kind = 'public_code' and creator_id = $1", [ana.id]), 2);

step("@ inválido para o Instagram (hífen); outra pessoa declara o mesmo @ e autoriza antes da dona confirmar");
await q("select public.ldo_cr_profile_save($1, $2, 'networks', $3)", [T, rui.s, { accounts: [{ platform: "instagram", handle: "rui-lopes" }] }]);
const ruiIg = await one("select id from public.ldo_cr_social_accounts where creator_id = $1 and platform = 'instagram'", [rui.id]);
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, rui.s, ruiIg, TEXT("rui-lopes"), ip], "22023", /não é um nome de utilizador válido/);
await q("select public.ldo_cr_social_save($1, $2, $3)", [T, rui.s, { id: ruiIg, platform: "instagram", handle: "ana.silva" }]);
const ruiStart = await start(rui.s, ruiIg, TEXT("ana.silva"));

step("tentativas de confirmação: pausa, validade, limite de 5 por dia, devolução");
await q("update ldo_private.cr_public_state set paused_until = now() + interval '1 hour'");
assert.deepEqual(await proof(ana.s, anaIg), { ok: false, reason: "busy" });
await q("update ldo_private.cr_public_state set paused_until = null");
await q("update public.ldo_cr_public_accounts set proof_expires_at = now() - interval '1 minute' where account_id = $1", [anaIg]);
assert.deepEqual(await proof(ana.s, anaIg), { ok: false, reason: "expired" });
await q("update public.ldo_cr_public_accounts set proof_expires_at = now() + interval '7 days' where account_id = $1", [anaIg]);
assert.deepEqual(await proof(ana.s, anaTk), { ok: false, reason: "state" });
let lastAttempt = null;
for (let i = 0; i < 5; i++) {
  r = await proof(ana.s, anaIg);
  assert.equal(r.ok, true);
  assert.equal(r.left, 4 - i);
  assert.equal(r.handle, "Ana.Silva");
  assert.equal(r.code, code);
  assert.ok(Number.isInteger(Number(r.attempt)));
  lastAttempt = r.attempt;
}
assert.deepEqual(await proof(ana.s, anaIg), { ok: false, reason: "rate" });
assert.equal(await one("select count(*)::int from public.ldo_cr_attempts where kind = 'public_proof' and creator_id = $1", [ana.id]), 5);
assert.equal((await get(ana.s)).proof_left, 0);
// Uma falha da Meta devolve a tentativa; só a do próprio, só public_proof, só dos últimos 10 minutos.
assert.deepEqual(await refund(rui.s, lastAttempt), { refunded: false });
assert.deepEqual(await refund(ana.s, lastAttempt), { refunded: true });
assert.deepEqual(await refund(ana.s, lastAttempt), { refunded: false });
assert.equal((await get(ana.s)).proof_left, 1);
const codeAttempt = await one("select id from public.ldo_cr_attempts where kind = 'public_code' and creator_id = $1 limit 1", [ana.id]);
assert.deepEqual(await refund(ana.s, codeAttempt), { refunded: false }, "só tentativas de confirmação");
r = await proof(ana.s, anaIg);
assert.equal(r.ok, true);
await q("update public.ldo_cr_attempts set created_at = now() - interval '11 minutes' where id = $1", [r.attempt]);
assert.deepEqual(await refund(ana.s, r.attempt), { refunded: false }, "passados 10 minutos já não se devolve");
await nextDay();
assert.equal((await get(ana.s)).proof_left, 5);

step("confirmar: mudanças, desligada, validade, sucesso e @ já provado (taken)");
const IG = "17841400000000001";
await fails("select public.ldo_cr_public_confirm($1, $2, $3, $4, $5, $6)", [T, ana.s, anaIg, "Ana.Silva", code, "abc"], "22023");
assert.deepEqual(await confirm(ana.s, anaIg, "Ana.Silva", "LDO-AAAAAA", IG), { ok: false, reason: "changed" });
assert.deepEqual(await confirm(ana.s, anaIg, "outra", code, IG), { ok: false, reason: "changed" });
await q("select public.ldo_cr_public_mode($1, 'off')", [sup.s]);
assert.deepEqual(await confirm(ana.s, anaIg, "Ana.Silva", code, IG), { ok: false, reason: "off" });
assert.deepEqual(await proof(ana.s, anaIg), { ok: false, reason: "off" });
await q("select public.ldo_cr_public_mode($1, 'on')", [sup.s]);
await q("update public.ldo_cr_public_accounts set proof_expires_at = now() - interval '1 minute' where account_id = $1", [anaIg]);
assert.deepEqual(await confirm(ana.s, anaIg, "Ana.Silva", code, IG), { ok: false, reason: "expired" });
await q("update public.ldo_cr_public_accounts set proof_expires_at = now() + interval '7 days' where account_id = $1", [anaIg]);
assert.deepEqual(await confirm(ana.s, anaIg, "ana.silva", code, IG), { ok: true });
let acc = (await q("select * from public.ldo_cr_public_accounts where account_id = $1", [anaIg]))[0];
assert.equal(acc.state, "active");
assert.equal(acc.proof_code, null);
assert.equal(acc.ig_user_id, IG);
assert.equal(await one("select verification from public.ldo_cr_social_accounts where id = $1", [anaIg]), "public");
assert.equal(await one("select count(*)::int from public.ldo_cr_audit where action = 'public.verified'"), 1);
assert.deepEqual(await confirm(rui.s, ruiIg, "ana.silva", ruiStart.code, "17841400000000002"), { ok: false, reason: "taken" });
assert.equal(await one("select verification from public.ldo_cr_social_accounts where id = $1", [ruiIg]), "declared");
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, rui.s, ruiIg, TEXT("ana.silva"), ip], "22023", /Já autorizou/);

step("autorizar não revela se outra pessoa já provou o @ (sem enumeração); só a confirmação recusa");
await q("select public.ldo_cr_profile_save($1, $2, 'networks', $3)", [T, eva.s, { accounts: [{ platform: "instagram", handle: "ana.silva" }] }]);
const evaIg = await one("select id from public.ldo_cr_social_accounts where creator_id = $1 and platform = 'instagram'", [eva.id]);
const evaStart = await start(eva.s, evaIg, TEXT("ana.silva"));
assert.equal(evaStart.state, "proof", "a resposta é a de qualquer @");
assert.deepEqual(await confirm(eva.s, evaIg, "ana.silva", evaStart.code, IG), { ok: false, reason: "taken" });
assert.equal(await one("select state from public.ldo_cr_public_accounts where account_id = $1", [evaIg]), "proof");

step("limite de códigos: 5 por pessoa em 24 h entre autorizar e gerar; parar não tem limite");
// A Eva já pediu 1 (autorizar): mais 4 códigos novos chegam ao limite.
for (let i = 0; i < 4; i++) await renew(eva.s, evaIg);
await fails("select public.ldo_cr_public_renew($1, $2, $3)", [T, eva.s, evaIg], "22023", /Já pediu 5 códigos/);
assert.deepEqual(await one("select public.ldo_cr_public_stop($1, $2, $3, $4, $5)", [T, eva.s, evaIg, TEXT("ana.silva"), ip]), { ok: true, stopped: true });
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, eva.s, evaIg, TEXT("ana.silva"), ip], "22023", /Já pediu 5 códigos/);
assert.equal((await consentNow(eva.id)).granted, false, "a recusa não grava a autorização");
assert.equal(await one("select count(*)::int from public.ldo_cr_attempts where kind = 'public_code' and creator_id = $1", [eva.id]), 5);
await nextDay();
assert.equal((await start(eva.s, evaIg, TEXT("ana.silva"))).state, "proof", "no dia seguinte volta a poder");
await one("select public.ldo_cr_public_stop($1, $2, $3, $4, $5)", [T, eva.s, evaIg, TEXT("ana.silva"), ip]);

step("leitura: claim, lease, put com normalização, visualizações só nos reels, janela");
let items = await claim();
assert.equal(items.length, 1);
assert.equal(items[0].account_id, anaIg);
assert.equal(items[0].handle, "Ana.Silva");
assert.equal(items[0].ig_user_id, IG);
const lease = items[0].lease;
assert.deepEqual(await claim(), []);
const now = Date.now();
const iso = (days) => new Date(now - days * 86400e3).toISOString();
const media = [
  { media_id: "17900000000000001", posted_at: iso(1), media_type: "VIDEO", product_type: "REELS", like_count: 100, comments_count: 5, view_count: 4000 },
  { media_id: "17900000000000002", posted_at: iso(3), media_type: "IMAGE", product_type: "FEED", like_count: null, comments_count: 2, view_count: 777 },
  { media_id: "17900000000000003", posted_at: iso(5), media_type: "CAROUSEL_ALBUM", product_type: "XPTO", like_count: "12", comments_count: -1, view_count: 1.5 },
  { media_id: "17900000000000004", posted_at: iso(6), media_type: "STORY", product_type: "STORY" },
  { media_id: "abc", posted_at: iso(6), media_type: "IMAGE" },
  { media_id: "17900000000000005", posted_at: iso(800), media_type: "IMAGE" },
  { media_id: "17900000000000006", posted_at: "2026-11-01T10:00:00+0000", media_type: "IMAGE" },
  { media_id: "17900000000000007", posted_at: new Date(now + 3 * 86400e3).toISOString(), media_type: "IMAGE" },
  { media_id: "17900000000000008", posted_at: iso(2), media_type: "VIDEO", product_type: "FEED", like_count: 9, view_count: 555 },
  "texto",
];
assert.deepEqual(await put(anaIg, "2020-01-01T00:00:00Z", IG, 1234, 56, media), { ok: false, reason: "lease" });
await fails("select public.ldo_cr_public_put($1, $2, $3, $4, $5, $6, $7)", [T, anaIg, lease, "x", 1, 1, "[]"], "22023");
await fails("select public.ldo_cr_public_put($1, $2, $3, $4, $5, $6, $7)", [T, anaIg, lease, IG, -1, 1, "[]"], "22023");
await fails("select public.ldo_cr_public_put($1, $2, $3, $4, $5, $6, $7)", [T, anaIg, lease, IG, 1, 1, "{}"], "22023");
assert.deepEqual(await put(anaIg, lease, IG, 1234, 56, media), { ok: true });
const rows = await q("select media_id, media_type, product_type, like_count, comments_count, view_count from public.ldo_cr_public_media where account_id = $1 order by media_id", [anaIg]);
assert.deepEqual(rows.map((x) => x.media_id), ["17900000000000001", "17900000000000002", "17900000000000003", "17900000000000008"]);
assert.equal(Number(rows[0].view_count), 4000, "reel: fica");
assert.equal(rows[1].view_count, null, "fotografia: as visualizações não se guardam");
assert.equal(rows[3].view_count, null, "vídeo do feed: as visualizações não se guardam");
assert.equal(Number(rows[3].like_count), 9);
assert.equal(rows[1].like_count, null);
assert.equal(rows[2].product_type, null);
assert.equal(rows[2].like_count, null);
assert.equal(rows[2].comments_count, null);
assert.equal(rows[2].view_count, null);
acc = (await q("select * from public.ldo_cr_public_accounts where account_id = $1", [anaIg]))[0];
assert.equal(acc.lease_until, null);
assert.ok(acc.last_read_at);
const nx = acc.next_at.getTime() - Date.now();
assert.ok(nx > 23.9 * 3600e3 && nx < 24.1 * 3600e3, "leitura diária");
assert.equal(await one("select count(*)::int from public.ldo_cr_public_snapshots where account_id = $1", [anaIg]), 1);
// Segunda leitura no mesmo dia: substitui.
await due(anaIg);
items = await claim();
assert.deepEqual(await put(anaIg, items[0].lease, IG, 1300, 57, media.slice(0, 1)), { ok: true });
assert.equal(await one("select count(*)::int from public.ldo_cr_public_snapshots where account_id = $1", [anaIg]), 1);
assert.equal(await one("select followers from public.ldo_cr_public_snapshots where account_id = $1", [anaIg]), 1300);
g = await get(ana.s);
assert.equal(g.account.state, "active");
assert.equal(g.account.snapshot.followers, 1300);
assert.equal(g.account.history.length, 1);
assert.equal(g.account.media.length, 4);
assert.ok(!JSON.stringify(g).includes("1790000000000"), "o site não recebe o id das publicações");
assert.equal(g.account.code, null);
// Sem atividade há mais de 90 dias → semanal.
await q("update public.ldo_cr_creators set last_login_at = now() - interval '100 days' where id = $1", [ana.id]);
await due(anaIg);
items = await claim();
await put(anaIg, items[0].lease, IG, 1300, 57, []);
const wk = (await one("select next_at from public.ldo_cr_public_accounts where account_id = $1", [anaIg])).getTime() - Date.now();
assert.ok(wk > 6.9 * 86400e3, "leitura semanal");
await q("update public.ldo_cr_creators set last_login_at = now() where id = $1", [ana.id]);

step("o criador vê o mesmo que a equipa: as últimas 30 leituras e as 25 publicações mais recentes");
for (let d = 1; d <= 40; d++) {
  await q("insert into public.ldo_cr_public_snapshots (account_id, taken_on, followers, media_count) values ($1, (now() - make_interval(days => $2))::date, $3, 50)", [anaIg, d, 1000 + d]);
}
for (let i = 0; i < 40; i++) {
  await q("insert into public.ldo_cr_public_media (account_id, media_id, posted_at, media_type) values ($1, $2, now() - make_interval(days => $3), 'IMAGE')", [anaIg, `178000000000${String(i).padStart(5, "0")}`, 10 + i]);
}
g = await get(ana.s);
let card = await one("select public.ldo_cr_public_creator($1, $2)", [viewer.s, ana.id]);
assert.equal(g.account.history.length, 30);
assert.equal(g.account.media.length, 25);
assert.deepEqual(g.account.history, card.account.history);
assert.deepEqual(g.account.media, card.account.media);
assert.equal(g.account.history[0].followers, 1300, "a mais recente primeiro");
await q("delete from public.ldo_cr_public_snapshots where account_id = $1 and taken_on < (now() at time zone 'Europe/Lisbon')::date", [anaIg]);
await q("delete from public.ldo_cr_public_media where account_id = $1 and media_id like '178%'", [anaIg]);

step("falhas: temporárias com espera crescente, not_found até ao estado error");
await due(anaIg);
items = await claim();
assert.deepEqual(await fail(anaIg, items[0].lease, "temporary"), { ok: true, state: "active" });
acc = (await q("select * from public.ldo_cr_public_accounts where account_id = $1", [anaIg]))[0];
assert.equal(acc.attempts, 1);
assert.equal(acc.last_error, "temporary");
assert.ok(acc.next_at.getTime() - Date.now() > 0.9 * 3600e3 && acc.next_at.getTime() - Date.now() < 1.1 * 3600e3);
await fails("select public.ldo_cr_public_fail($1, $2, $3, $4)", [T, anaIg, items[0].lease, "token"], "22023");
assert.deepEqual(await fail(anaIg, items[0].lease, "temporary"), { ok: false, reason: "lease" });
let firstNotFound = null;
for (let i = 1; i <= 4; i++) {
  await due(anaIg);
  items = await claim();
  r = await fail(anaIg, items[0].lease, "not_found");
  acc = (await q("select * from public.ldo_cr_public_accounts where account_id = $1", [anaIg]))[0];
  if (i === 1) {
    firstNotFound = acc.last_error_at.getTime();
    assert.equal(acc.attempts, 1, "o tipo mudou: recomeça");
    assert.ok(acc.next_at.getTime() - Date.now() > 11.9 * 3600e3);
  }
  assert.equal(r.state, i < 4 ? "active" : "error", `falha ${i}`);
}
assert.equal(acc.state, "error");
assert.equal(acc.last_error, "not_found");
assert.equal(acc.last_error_at.getTime(), firstNotFound, "desde a primeira falha");
assert.equal(await one("select count(*)::int from public.ldo_cr_outbox where kind = 'public_error' and creator_id = $1", [ana.id]), 1);
assert.deepEqual(await one("select details from public.ldo_cr_audit where action = 'public.error'"), { error: "not_found" });
await due(anaIg);
items = await claim();
assert.equal(items.length, 1, "em erro continua a ser lida (semanal)");
assert.deepEqual(await fail(anaIg, items[0].lease, "temporary"), { ok: true, state: "error" });
acc = (await q("select * from public.ldo_cr_public_accounts where account_id = $1", [anaIg]))[0];
assert.equal(acc.last_error, "not_found");
assert.equal(acc.last_error_at.getTime(), firstNotFound);
assert.ok(acc.next_at.getTime() - Date.now() > 6.9 * 86400e3);
assert.equal(await one("select count(*)::int from public.ldo_cr_outbox where kind = 'public_error' and creator_id = $1", [ana.id]), 1);
// Uma leitura certa volta a active.
await due(anaIg);
items = await claim();
await put(anaIg, items[0].lease, IG, 1400, 58, []);
acc = (await q("select * from public.ldo_cr_public_accounts where account_id = $1", [anaIg]))[0];
assert.equal(acc.state, "active");
assert.equal(acc.attempts, 0);
assert.equal(acc.last_error, null);
assert.equal(acc.last_error_at, null);

step("ligação: saúde, pausa, aviso uma vez por 24 h");
await fails("select public.ldo_cr_public_health($1, 'x', null, null, null)", [T], "22023");
assert.deepEqual(await health("token", 190, 60, 10), { alert: true });
assert.deepEqual(await health("token", 190, 60, null), { alert: false });
let st = (await q("select * from ldo_private.cr_public_state"))[0];
assert.equal(st.usage_pct, 10, "uso desconhecido não apaga o último");
assert.ok(st.paused_until > new Date());
assert.deepEqual(await health("config", 100, 60, 20), { alert: true });
await due(anaIg);
assert.deepEqual(await claim(), [], "em pausa não se lê");
assert.deepEqual(await health("ok", null, null, 5), { alert: false });
st = (await q("select * from ldo_private.cr_public_state"))[0];
assert.equal(st.paused_until, null, "um pedido certo acaba com a pausa de configuração");
assert.ok(st.last_ok_at);
assert.equal(st.usage_pct, 5);
await health("limit", 4, 30, 90);
await health("ok", null, null, 50);
st = (await q("select * from ldo_private.cr_public_state"))[0];
assert.ok(st.paused_until > new Date(), "a pausa por limite fica");
const pmins = (st.paused_until.getTime() - Date.now()) / 60000;
assert.ok(pmins > 29 && pmins < 31);
const status = await one("select public.ldo_cr_public_status($1)", [viewer.s]);
assert.equal(status.mode, "on");
assert.equal(status.last_error, "limit");
assert.equal(status.active, 1);
assert.equal(status.proof, 1, "a autorização do Rui por confirmar");
await q("update ldo_private.cr_public_state set paused_until = null");

step("@ que passou a ser de outra conta do Instagram");
items = await claim();
assert.equal(items.length, 1);
assert.deepEqual(await put(anaIg, items[0].lease, "17841400000000099", 1, 1, media), { ok: false, reason: "other_account" });
assert.equal(await one("select count(*)::int from public.ldo_cr_public_accounts where account_id = $1", [anaIg]), 0);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_snapshots"), 0);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_media"), 0);
assert.equal(await one("select verification from public.ldo_cr_social_accounts where id = $1", [anaIg]), "declared");
assert.equal((await consentNow(ana.id)).granted, false);
assert.match(await one("select text_shown from public.ldo_cr_consents where creator_id = $1 and purpose = 'platform_public' order by id desc limit 1", [ana.id]), /outra conta/);
assert.deepEqual(await one("select payload from public.ldo_cr_outbox where kind = 'public_stopped' and creator_id = $1", [ana.id]), { reason: "other_account" });
assert.deepEqual(await one("select details from public.ldo_cr_audit where action = 'public.stop' order by id desc limit 1"), { why: "other_account" });
assert.equal(await one("select actor_kind from public.ldo_cr_audit where action = 'public.stop' order by id desc limit 1"), "system");

async function activate(c, accId, hd, ig) {
  await nextDay();
  const s = await start(c.s, accId, TEXT(hd));
  assert.deepEqual(await confirm(c.s, accId, hd, s.code, ig), { ok: true });
  const it = (await claim()).find((x) => x.account_id === accId);
  assert.deepEqual(await put(accId, it.lease, ig, 2000, 60, media.slice(0, 2)), { ok: true });
}

step("parar pelo criador: apaga, retira, pedido RGPD concluído; suspenso, limitado e com Termos por aceitar também param");
await activate(ana, anaIg, "Ana.Silva", IG);
await q("update public.ldo_cr_creators set status = 'suspended' where id = $1", [ana.id]);
await due(anaIg);
assert.deepEqual((await claim()).filter((x) => x.account_id === anaIg), [], "conta suspensa não é lida");
await fails("select public.ldo_cr_public_start($1, $2, $3, $4, $5)", [T, ana.s, anaTk, TEXT("x"), ip], "42501", /suspensa/);
await fails("select public.ldo_cr_public_renew($1, $2, $3)", [T, ana.s, anaIg], "42501", /suspensa/);
await fails("select public.ldo_cr_public_proof($1, $2, $3, $4)", [T, ana.s, anaIg, ip], "42501", /suspensa/);
assert.equal((await get(ana.s)).account.state, "active", "Redes abre com a conta suspensa");
await fails("select public.ldo_cr_public_stop($1, $2, $3, $4, $5)", [T, ana.s, anaIg, "", ip], "22023");
r = await one("select public.ldo_cr_public_stop($1, $2, $3, $4, $5)", [T, ana.s, anaIg, TEXT("Ana.Silva"), ip]);
assert.deepEqual(r, { ok: true, stopped: true });
assert.equal(await one("select count(*)::int from public.ldo_cr_public_accounts where account_id = $1", [anaIg]), 0);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_media"), 0);
assert.equal((await consentNow(ana.id)).granted, false);
assert.equal(await one("select text_shown from public.ldo_cr_consents where creator_id = $1 and purpose = 'platform_public' order by id desc limit 1", [ana.id]), TEXT("Ana.Silva"));
assert.equal(await one("select count(*)::int from public.ldo_cr_privacy_requests where creator_id = $1 and kind = 'withdrawal' and status = 'done' and channel = 'self_service'", [ana.id]), 1);
assert.equal(await one("select actor_kind from public.ldo_cr_audit where action = 'public.stop' order by id desc limit 1"), "creator");
r = await one("select public.ldo_cr_public_stop($1, $2, $3, $4, $5)", [T, ana.s, anaIg, TEXT("Ana.Silva"), ip]);
assert.deepEqual(r, { ok: true, stopped: false });
assert.equal(await one("select count(*)::int from public.ldo_cr_privacy_requests where creator_id = $1 and kind = 'withdrawal'", [ana.id]), 1);
await fails("select public.ldo_cr_public_stop($1, $2, $3, $4, $5)", [T, rui.s, anaIg, TEXT("x"), ip], "P0002");
await q("update public.ldo_cr_creators set status = 'approved' where id = $1", [ana.id]);
// Termos novos com «exige nova aceitação»: autorizar e confirmar recusam; ver e parar funcionam.
await activate(ana, anaIg, "Ana.Silva", IG);
const termsV2 = await one(`insert into public.ldo_cr_legal_documents (kind, version, title, body, requires_reacceptance)
  select kind, '0.2', title, body, true from public.ldo_cr_legal_documents where kind = 'terms' and status = 'published' returning id`);
await q("select public.ldo_cr_legal_publish($1, $2)", [sup.s, termsV2]);
assert.deepEqual((await one("select public.ldo_cr_me($1, $2)", [T, ana.s])).reaccept, ["terms"]);
await fails("select public.ldo_cr_public_proof($1, $2, $3, $4)", [T, ana.s, anaIg, ip], "42501", /Termos/);
assert.equal((await get(ana.s)).account.state, "active");
assert.deepEqual(await one("select public.ldo_cr_public_stop($1, $2, $3, $4, $5)", [T, ana.s, anaIg, TEXT("Ana.Silva"), ip]), { ok: true, stopped: true });
await q("select public.ldo_cr_legal_accept($1, $2, $3, $4, $5)", [T, ana.s, termsV2, "Aceito os Termos de participação (v0.2).", ip]);
assert.deepEqual((await one("select public.ldo_cr_me($1, $2)", [T, ana.s])).reaccept, []);

step("equipa: ficha, retirada por email com o pedido registado");
await activate(ana, anaIg, "Ana.Silva", IG);
card = await one("select public.ldo_cr_public_creator($1, $2)", [viewer.s, ana.id]);
assert.equal(card.account.state, "active");
assert.equal(card.account.history.length, 1);
assert.equal(card.account.media.length, 2);
assert.ok(!("code" in card.account));
assert.ok(!JSON.stringify(card).includes("1790000000000"));
await fails("select public.ldo_cr_public_creator($1, $2)", [viewer.s, crypto.randomUUID()], "P0002");
await fails("select public.ldo_cr_public_staff_stop($1, $2, $3)", [viewer.s, ana.id, crypto.randomUUID()], "42501");
const reqNo = await one("select public.ldo_cr_privacy_register($1, $2, 'withdrawal', 'email', 'Quer parar a leitura', null, '', false)", [manager.s, ana.id]);
await fails("select public.ldo_cr_public_staff_stop($1, $2, $3)", [manager.s, ana.id, reqNo], "22023", /confirme a identidade/);
await q("select public.ldo_cr_privacy_update($1, $2, null, null, null, true)", [manager.s, reqNo]);
r = await one("select public.ldo_cr_public_staff_stop($1, $2, $3)", [manager.s, ana.id, reqNo]);
assert.deepEqual(r, { ok: true, stopped: true });
assert.equal(await one("select actor_kind from public.ldo_cr_audit where action = 'public.stop' order by id desc limit 1"), "staff");
assert.equal(await one("select staff_id from public.ldo_cr_audit where action = 'public.stop' order by id desc limit 1"), manager.id);
const withdrawal = (await q("select * from public.ldo_cr_audit where action = 'privacy.withdrawal' order by id desc limit 1"))[0];
assert.equal(withdrawal.actor_kind, "staff");
assert.equal(withdrawal.staff_id, manager.id);
assert.equal(withdrawal.creator_id, ana.id);
assert.equal(withdrawal.target, reqNo);
assert.deepEqual(withdrawal.details, { request_id: reqNo, stopped: true });
assert.equal(await one("select status from public.ldo_cr_privacy_requests where id = $1", [reqNo]), "open", "a equipa responde em Privacidade");
assert.match(await one("select text_shown from public.ldo_cr_consents where creator_id = $1 and purpose = 'platform_public' order by id desc limit 1", [ana.id]), /pedido registado pela equipa/);

step("mudar o @ ou a rede, apagar a conta, apagamento com colaboração");
await activate(ana, anaIg, "Ana.Silva", IG);
await q("select public.ldo_cr_social_save($1, $2, $3)", [T, ana.s, { id: anaIg, platform: "instagram", handle: "Ana.Silva", profile_url: "https://instagram.com/ana.silva" }]);
assert.equal(await one("select state from public.ldo_cr_public_accounts where account_id = $1", [anaIg]), "active", "só o endereço mudou");
await q("select public.ldo_cr_social_save($1, $2, $3)", [T, ana.s, { id: anaIg, platform: "instagram", handle: "ana.silva2" }]);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_accounts where account_id = $1", [anaIg]), 0);
assert.equal(await one("select verification from public.ldo_cr_social_accounts where id = $1", [anaIg]), "declared");
assert.match(await one("select text_shown from public.ldo_cr_consents where creator_id = $1 and purpose = 'platform_public' order by id desc limit 1", [ana.id]), /mudou em Redes/);
// Mudança para uma rede onde já tem conta: falha e a purga desfaz-se.
await activate(ana, anaIg, "ana.silva2", IG);
await fails("select public.ldo_cr_social_save($1, $2, $3)", [T, ana.s, { id: anaIg, platform: "tiktok", handle: "ana.silva2" }], "22023", /Já tem uma conta/);
assert.equal(await one("select state from public.ldo_cr_public_accounts where account_id = $1", [anaIg]), "active");
assert.equal((await consentNow(ana.id)).granted, true);
await q("select public.ldo_cr_social_delete($1, $2, $3)", [T, ana.s, anaIg]);
assert.equal((await consentNow(ana.id)).granted, false);
assert.match(await one("select text_shown from public.ldo_cr_consents where creator_id = $1 and purpose = 'platform_public' order by id desc limit 1", [ana.id]), /apagar a conta do Instagram/);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_snapshots"), 0);
await q("select public.ldo_cr_social_save($1, $2, $3)", [T, ana.s, { platform: "instagram", handle: "ana.silva" }]);
const anaIg2 = await one("select id from public.ldo_cr_social_accounts where creator_id = $1 and platform = 'instagram'", [ana.id]);
await activate(ana, anaIg2, "ana.silva", IG);
await q("select ldo_private.cr_erase_optional($1)", [ana.id]);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_accounts where account_id = $1", [anaIg2]), 0);
assert.equal((await consentNow(ana.id)).granted, false);
assert.match(await one("select text_shown from public.ldo_cr_consents where creator_id = $1 and purpose = 'platform_public' order by id desc limit 1", [ana.id]), /apagamento da conta/);

step("exportação com os dados públicos");
await activate(ana, anaIg2, "ana.silva", IG);
const ex = await one("select ldo_private.cr_export_common($1)", [ana.id]);
assert.equal(ex.public_instagram.state, "active");
assert.equal(ex.public_instagram.readings.length, 1);
assert.equal(ex.public_instagram.posts.length, 2);
assert.equal(ex.public_instagram.ig_user_id, IG);
assert.ok(!JSON.stringify(ex).includes("_ct"));
const exr = await one("select ldo_private.cr_export_common($1)", [rui.id]);
assert.equal(exr.public_instagram.state, "proof");
assert.deepEqual(exr.public_instagram.readings, []);

step("limpeza diária: janela de 24 meses, autorizações por confirmar, conta não encontrada há 90 dias");
await q("insert into public.ldo_cr_public_snapshots (account_id, taken_on, followers) values ($1, (now() - interval '25 months')::date, 10)", [anaIg2]);
await q("insert into public.ldo_cr_public_media (account_id, media_id, posted_at, media_type) values ($1, '17900000000000099', now() - interval '25 months', 'IMAGE')", [anaIg2]);
await q("update public.ldo_cr_public_accounts set proof_expires_at = now() - interval '31 days' where account_id = $1", [ruiIg]);
await q("select ldo_private.cr_retention()");
assert.equal(await one("select count(*)::int from public.ldo_cr_public_snapshots where account_id = $1", [anaIg2]), 1);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_media where account_id = $1", [anaIg2]), 2);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_accounts where account_id = $1", [ruiIg]), 0);
assert.equal((await consentNow(rui.id)).granted, false);
assert.deepEqual(await one("select payload from public.ldo_cr_outbox where kind = 'public_stopped' and creator_id = $1", [rui.id]), { reason: "proof_expired" });
await q("update public.ldo_cr_public_accounts set state = 'error', last_error = 'not_found', last_error_at = now() - interval '91 days' where account_id = $1", [anaIg2]);
await q("update public.ldo_cr_creators set status = 'restricted' where id = $1", [ana.id]);
await q("select ldo_private.cr_retention()");
assert.equal(await one("select count(*)::int from public.ldo_cr_public_accounts where account_id = $1", [anaIg2]), 1, "não durante a limitação");
await q("update public.ldo_cr_creators set status = 'approved' where id = $1", [ana.id]);
await q("select ldo_private.cr_retention()");
assert.equal(await one("select count(*)::int from public.ldo_cr_public_accounts where account_id = $1", [anaIg2]), 0);
assert.equal(await one("select count(*)::int from public.ldo_cr_public_media where account_id = $1", [anaIg2]), 0);
assert.deepEqual(await one("select payload from public.ldo_cr_outbox where kind = 'public_stopped' and creator_id = $1 order by id desc limit 1", [ana.id]), { reason: "not_found" });
assert.match(await one("select text_shown from public.ldo_cr_consents where creator_id = $1 and purpose = 'platform_public' order by id desc limit 1", [ana.id]), /90 dias/);
assert.ok(await one("select count(*)::int from public.ldo_cr_audit where action in ('public.stop', 'privacy.withdrawal')") > 0);

step("lista de criadores sem mudanças; paragem de emergência desliga a leitura");
const list = await one("select public.ldo_cr_creators_list($1, $2)", [viewer.s, { q: "ana" }]);
assert.ok(list.items[0].networks.every((x) => x.followers_source !== "public"), "a lista não mostra números públicos");
await one("select public.ldo_cr_lockdown($1, 'incidente de teste')", [sup.s]);
assert.equal(await one("select public_mode from public.ldo_cr_settings"), "off");
assert.equal((await one("select details from public.ldo_cr_audit where action = 'incident.lockdown' order by id desc limit 1")).public_mode, "off");
assert.deepEqual(await claim(), []);

step("acessos: tabelas novas com RLS e sem privilégios; funções só para anon; privadas revogadas");
assert.equal(await one(`select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'ldo\\_cr\\_public\\_%' and c.relkind = 'r'
  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') or not c.relrowsecurity)`), 0);
assert.equal(await one("select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'ldo\\_cr\\_public\\_%' and c.relkind = 'r'"), 3);
assert.equal(await one("select relrowsecurity from pg_class where oid = 'ldo_private.cr_public_state'::regclass"), true);
assert.equal(await one(`select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'ldo\\_cr\\_%' and (has_function_privilege('authenticated', p.oid, 'execute')
  or not has_function_privilege('anon', p.oid, 'execute') or not p.prosecdef)`), 0);
assert.equal(await one(`select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'ldo_private' and p.proname like 'cr\\_%' and (has_function_privilege('anon', p.oid, 'execute')
  or has_function_privilege('authenticated', p.oid, 'execute'))`), 0);
assert.equal(await one("select count(*)::int from pg_proc where proname like 'ldo\\_cr\\_public\\_%'"), 15);

console.log("tudo certo");
await db.close();
