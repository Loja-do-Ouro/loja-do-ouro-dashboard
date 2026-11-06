const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// Plataforma de criadores, fase 3A: comportamento de lib/criadores/meta.ts (o tick da leitura, a prova da posse e o
// teste da ligação) com a BD, os emails e a Meta falsos: sem rede, sem Supabase. O módulo é compilado com o
// TypeScript do projeto e as regras vêm de .test-build (npm test compila-as antes).
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "lib", "criadores", "meta.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const calls = [];
const log = (name, ...args) => calls.push([name, ...args]);
let queue = [];
let proofResult;
let putResult = async () => ({ ok: true });
const fakeDb = {
  creatorsServerConfigured: () => true,
  crPublicClaim: async (limit) => {
    log("claim", limit);
    return queue.splice(0, limit);
  },
  crPublicPut: async (id, lease, r) => {
    log("put", id, r.followers, r.media.length);
    return putResult();
  },
  crPublicFail: async (id, lease, e) => {
    log("fail", id, e);
    return { ok: true };
  },
  crPublicHealth: async (kind, code, minutes, usage) => {
    log("health", kind, code, minutes, usage);
    return { alert: kind === "token" || kind === "config" };
  },
  crPublicProof: async (s, id) => {
    log("proof", id);
    return proofResult;
  },
  crPublicProofRefund: async (s, attempt) => {
    log("refund", attempt);
    return { refunded: true };
  },
  crPublicConfirm: async (s, id, h, c, ig) => {
    log("confirm", id, h, c, ig);
    return { ok: true };
  },
};
const fakeEmails = { sendMetaAlert: async (k) => (log("alert", k), { ok: true }) };
const fakeSite = { ipHash: async () => "a".repeat(64) };

const mod = new Module(path.join(ROOT, "lib", "criadores", "meta.ts"));
const deps = {
  "server-only": {},
  "@/lib/criadores-meta-rules": require("../.test-build/criadores-meta-rules.js"),
  "@/lib/criadores-rules": require("../.test-build/criadores-rules.js"),
  "./db": fakeDb, "./emails": fakeEmails, "./site": fakeSite, "node:crypto": require("node:crypto"),
};
mod.require = (id) => {
  if (!(id in deps)) throw new Error(`require inesperado: ${id}`);
  return deps[id];
};
mod._compile(js, "meta.js");
const meta = mod.exports;

// Sem as esperas entre pedidos (1 s): este ficheiro corre num processo só dele (node --test).
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...a) => (ms >= 1000 ? (Promise.resolve().then(fn), 0) : realSetTimeout(fn, ms, ...a));

const TOKEN = "EAAtokenDeTeste1234567890";
const LOJA = "17841402274014251";
process.env.META_SYSTEM_USER_TOKEN = TOKEN;
process.env.META_IG_ACCOUNT_ID = LOJA;

// Respostas da Meta por @ (o pedido leva o @ em fields); «@:bio» para o pedido da biografia, se for diferente.
let responses = {};
const urls = [];
global.fetch = async (url, opts) => {
  urls.push(url);
  assert.equal(opts.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!String(url).includes(TOKEN), "o token não vai no URL");
  assert.equal(opts.cache, "no-store");
  const fields = new URL(url).searchParams.get("fields");
  const h = /username\(([^)]+)\)/.exec(fields)[1];
  const r = (fields.endsWith("{id,username,biography}") && responses[`${h}:bio`]) || responses[h];
  if (!r) throw new Error("sem resposta");
  return { status: r.status ?? 200, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] ?? null }, json: async () => r.json };
};
const ok = (h, id, followers = 100) => ({
  json: {
    business_discovery: {
      id, username: h, followers_count: followers, media_count: 3, biography: "bio LDO-7K3Q9P",
      media: { data: [{ id: "17900000000000001", timestamp: "2026-11-01T10:00:00+0000", media_type: "IMAGE", like_count: 1, comments_count: 0 }] },
    },
  },
});
const bio = (h, id, text) => ({ json: { business_discovery: { id, username: h, biography: text } } });
const err = (code, sub, status = 400) => ({ status, json: { error: { code, error_subcode: sub, message: "x" } } });
const item = (h, n) => ({ account_id: `acc-${n}`, handle: h, ig_user_id: "17841400000000001", lease: "2026-11-05T10:00:00Z" });
const others = () => calls.filter((c) => c[0] !== "claim");
function reset() {
  calls.length = 0;
  urls.length = 0;
  responses = {};
  queue = [];
  putResult = async () => ({ ok: true });
  proofResult = { ok: true, handle: "Ana.Silva", code: "LDO-7K3Q9P", left: 3, attempt: 41 };
}

// ---------------------------------------------------------------- tick

test("tick: reads every claimed account, one request each, and records the usage once at the end", async () => {
  reset();
  responses["ana.silva"] = { ...ok("ana.silva", "17841400000000001"), headers: { "x-app-usage": '{"call_count":10}' } };
  responses.rui = ok("rui", "17841400000000002");
  queue = [item("Ana.Silva", 1), item("rui", 2)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 2);
  assert.deepEqual(others(), [["put", "acc-1", 100, 1], ["put", "acc-2", 100, 1], ["health", "ok", null, null, 10]]);
  assert.ok(urls.every((u) => u.startsWith(`https://graph.facebook.com/v27.0/${LOJA}?fields=`)));
});

test("tick: usage at 75 % or more keeps the reading, pauses with the time the Meta asks and stops", async () => {
  reset();
  responses["ana.silva"] = {
    ...ok("ana.silva", "17841400000000001"),
    headers: { "x-business-use-case-usage": JSON.stringify({ x: [{ call_count: 80, estimated_time_to_regain_access: 12 }] }) },
  };
  queue = [item("ana.silva", 1), item("rui", 2)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 1);
  assert.deepEqual(others(), [["put", "acc-1", 100, 1], ["health", "limit", null, 12, 80]]);
});

test("tick: an account the Meta does not return fails as not_found and the run goes on", async () => {
  reset();
  responses["ana.silva"] = err(110, 2207013);
  responses.rui = ok("rui", "17841400000000002");
  queue = [item("ana.silva", 1), item("rui", 2)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 1);
  assert.deepEqual(others(), [["fail", "acc-1", "not_found"], ["put", "acc-2", 100, 1], ["health", "ok", null, null, null]]);
});

test("tick: a refused token pauses, warns the Super Admins and stops, without failing the account", async () => {
  reset();
  responses["ana.silva"] = err(190, 460);
  queue = [item("ana.silva", 1), item("rui", 2)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 0);
  assert.deepEqual(others(), [["health", "token", 190, 60, null], ["alert", "token"]]);
  assert.equal(urls.length, 1, "para logo a seguir ao erro de token");
});

test("tick: a configuration error is tested once on @lojadoouro; if it passes, the accounts fail as not_found", async () => {
  reset();
  responses["ana.silva"] = err(100, 33);
  responses.rui = err(100, 33);
  responses.lojadoouro = ok("lojadoouro", LOJA, 50000);
  queue = [item("ana.silva", 1), item("rui", 2)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 0);
  assert.deepEqual(others(), [["health", "ok", null, null, null], ["fail", "acc-1", "not_found"], ["fail", "acc-2", "not_found"]]);
  assert.equal(urls.filter((u) => u.includes("lojadoouro")).length, 1, "um só teste por execução");
});

test("tick: a configuration error confirmed by the test pauses, warns and stops", async () => {
  reset();
  responses["ana.silva"] = err(100, 33);
  responses.lojadoouro = err(10, null);
  queue = [item("ana.silva", 1), item("rui", 2)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 0);
  assert.deepEqual(others(), [["health", "config", 10, 60, null], ["alert", "config"]]);
});

test("tick: three temporary errors in a row fail each account and pause for 15 minutes", async () => {
  reset();
  for (const h of ["a1", "a2", "a3", "a4"]) responses[h] = { status: 500, json: null };
  queue = [item("a1", 1), item("a2", 2), item("a3", 3), item("a4", 4)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 0);
  assert.deepEqual(others(), [
    ["fail", "acc-1", "temporary"], ["fail", "acc-2", "temporary"], ["fail", "acc-3", "temporary"], ["health", "temporary", null, 15, null],
  ]);
});

test("tick: HTTP 429 is a limit, with the Meta's time to regain access", async () => {
  reset();
  responses["ana.silva"] = {
    status: 429, json: null,
    headers: { "x-business-use-case-usage": JSON.stringify({ x: [{ call_count: 100, estimated_time_to_regain_access: 40 }] }) },
  };
  queue = [item("ana.silva", 1), item("rui", 2)];
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 0);
  assert.deepEqual(others(), [["health", "limit", null, 40, 100]]);
});

test("tick: at most 20 requests per run, claimed 10 at a time", async () => {
  reset();
  queue = Array.from({ length: 30 }, (_, i) => item(`c${i}`, i));
  for (let i = 0; i < 30; i++) responses[`c${i}`] = ok(`c${i}`, `1784140000000${String(i).padStart(4, "0")}`);
  assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 20);
  assert.equal(urls.length, 20);
  assert.deepEqual(calls.filter((c) => c[0] === "claim").map((c) => c[1]), [10, 10]);
});

test("tick: a reading the database refuses counts as a temporary failure (never back every 5 minutes)", async () => {
  reset();
  responses["ana.silva"] = ok("ana.silva", "17841400000000001");
  putResult = async () => {
    throw new Error("Leitura inválida.");
  };
  queue = [item("ana.silva", 1)];
  const errors = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await meta.readPublicAccounts({ budgetMs: 60000 }), 0);
  } finally {
    console.error = errors;
  }
  assert.deepEqual(others(), [["put", "acc-1", 100, 1], ["fail", "acc-1", "temporary"]]);
});

// ---------------------------------------------------------------- prova da posse

test("proof: the code in the biography confirms the account with the Meta id; the biography never leaves", async () => {
  reset();
  responses["ana.silva"] = bio("ana.silva", "17841400000000001", "Joias ldo 7k3q 9p");
  assert.deepEqual(await meta.checkPublicProof("s", "acc-1"), { ok: true });
  assert.deepEqual(calls.find((c) => c[0] === "confirm"), ["confirm", "acc-1", "Ana.Silva", "LDO-7K3Q9P", "17841400000000001"]);
  assert.match(new URL(urls[0]).searchParams.get("fields"), /\{id,username,biography\}$/);
  assert.ok(!JSON.stringify(calls).includes("Joias"));
});

test("proof: a missing code and a non-professional account count as attempts", async () => {
  reset();
  responses["ana.silva"] = bio("ana.silva", "17841400000000001", "sem código");
  assert.deepEqual(await meta.checkPublicProof("s", "acc-1"), { ok: false, reason: "missing", handle: "Ana.Silva", left: 3 });
  responses["ana.silva"] = err(110, 2207013);
  assert.equal((await meta.checkPublicProof("s", "acc-1")).reason, "not_found");
  assert.deepEqual(calls.filter((c) => c[0] === "refund"), [], "a falha é da conta: a tentativa conta");
});

test("proof: a failure on the Meta's or Loja do Ouro's side gives the attempt back", async () => {
  reset();
  responses["ana.silva"] = err(190, null);
  assert.equal((await meta.checkPublicProof("s", "acc-1")).reason, "error");
  assert.deepEqual(others().filter((c) => c[0] !== "proof"), [["health", "token", 190, 60, null], ["alert", "token"], ["refund", 41]]);

  reset();
  responses["ana.silva"] = { status: 429, json: null };
  assert.equal((await meta.checkPublicProof("s", "acc-1")).reason, "busy");
  assert.deepEqual(others().filter((c) => c[0] !== "proof"), [["health", "limit", null, 60, null], ["refund", 41]]);

  reset();
  responses["ana.silva"] = { status: 500, json: null };
  assert.equal((await meta.checkPublicProof("s", "acc-1")).reason, "error");
  assert.deepEqual(others().filter((c) => c[0] !== "proof"), [["refund", 41]]);
});

test("proof: a configuration error is tested on @lojadoouro with the same biography request", async () => {
  // O teste passa: o problema é desta conta (conta como not_found, sem devolver a tentativa).
  reset();
  responses["ana.silva"] = err(100, 33);
  responses["lojadoouro:bio"] = bio("lojadoouro", LOJA, "Joias desde 1990");
  assert.equal((await meta.checkPublicProof("s", "acc-1")).reason, "not_found");
  assert.deepEqual(others().filter((c) => c[0] !== "proof"), [["health", "ok", null, null, null]]);
  assert.match(new URL(urls[1]).searchParams.get("fields"), /^business_discovery\.username\(lojadoouro\)\{id,username,biography\}$/);
  // O teste falha: configuração (estado gravado, aviso, tentativa devolvida).
  reset();
  responses["ana.silva"] = err(100, 33);
  responses.lojadoouro = err(10, null);
  assert.equal((await meta.checkPublicProof("s", "acc-1")).reason, "error");
  assert.deepEqual(others().filter((c) => c[0] !== "proof"), [["health", "config", 10, 60, null], ["alert", "config"], ["refund", 41]]);
});

test("proof: refusals from the database pass through, with no request to the Meta", async () => {
  reset();
  proofResult = { ok: false, reason: "rate" };
  assert.deepEqual(await meta.checkPublicProof("s", "acc-1"), { ok: false, reason: "rate" });
  proofResult = { ok: false, reason: "busy" };
  assert.deepEqual(await meta.checkPublicProof("s", "acc-1"), { ok: false, reason: "busy" });
  assert.equal(urls.length, 0);
});

// ---------------------------------------------------------------- teste da ligação

test("connection test: both requests (reading and biography) on @lojadoouro, with the configured id", async () => {
  reset();
  responses.lojadoouro = ok("lojadoouro", LOJA, 50000);
  responses["lojadoouro:bio"] = bio("lojadoouro", LOJA, "Joias desde 1990");
  assert.deepEqual(await meta.testMetaPublic(), { ok: true, followers: 50000 });
  assert.equal(urls.length, 2);
  assert.deepEqual(calls, [["health", "ok", null, null, null], ["health", "ok", null, null, null]]);

  // Só o pedido da biografia recusado: o teste falha (senão o estado ficava verde e todas as confirmações falhavam).
  reset();
  responses.lojadoouro = ok("lojadoouro", LOJA, 50000);
  responses["lojadoouro:bio"] = err(10, null);
  const t = await meta.testMetaPublic();
  assert.equal(t.ok, false);
  assert.match(t.detail, /^Pedido da biografia/);
  assert.deepEqual(calls.at(-2), ["health", "config", 10, 60, null]);

  // Outro id: configuração.
  reset();
  responses.lojadoouro = ok("lojadoouro", "17841400000000099", 50000);
  assert.equal((await meta.testMetaPublic()).ok, false);
});

test("without the Meta configuration nothing is read and nothing is asked", async () => {
  reset();
  delete process.env.META_SYSTEM_USER_TOKEN;
  try {
    assert.equal(meta.metaPublicConfigured(), false);
    assert.equal(await meta.readPublicAccounts({}), 0);
    assert.deepEqual(await meta.checkPublicProof("s", "acc-1"), { ok: false, reason: "off" });
    assert.equal((await meta.testMetaPublic()).ok, false);
    assert.equal(urls.length, 0);
    assert.deepEqual(calls, []);
  } finally {
    process.env.META_SYSTEM_USER_TOKEN = TOKEN;
  }
});
