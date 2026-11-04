const { test } = require("node:test");
const assert = require("node:assert/strict");
const { hkdfSync, randomBytes } = require("node:crypto");
const c = require("../.test-build/criadores-crypto-core.js");

// Chaves de teste (32 bytes em base64, 44 caracteres). Nunca chaves reais.
const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const SUPPORT = Buffer.alloc(32, 9).toString("base64");
const ID = "4b0f6a0e-2f7a-4d55-9a3e-0d6a2b1c9e11";

test("round trip with the current key, version prefix and different ciphertexts", () => {
  const ring = c.parseKeyRing(`c1:${K1}`, SUPPORT);
  assert.equal(ring.current, "c1");
  const plain = JSON.stringify({ iban: "PT50000201231234567890154", holder: "Ana Silva" });
  const a = c.seal(ring, plain, `iban:${ID}`);
  const b = c.seal(ring, plain, `iban:${ID}`);
  assert.match(a, /^c1\.[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b, "IV aleatório: o mesmo texto não dá o mesmo valor");
  assert.equal(c.sealedVersion(a), "c1");
  assert.equal(c.open(ring, a, `iban:${ID}`), plain);
  assert.ok(!a.includes("PT50"));
});

test("wrong AAD (other person or other purpose) fails without revealing anything", () => {
  const ring = c.parseKeyRing(`c1:${K1}`);
  const sealed = c.seal(ring, "segredo", `iban:${ID}`);
  assert.throws(() => c.open(ring, sealed, "iban:outro-criador"), /Não foi possível decifrar/);
  assert.throws(() => c.open(ring, sealed, `fiscal:${ID}`), /Não foi possível decifrar/);
  assert.throws(() => c.seal(ring, "x", "outra:1"), /Finalidade de cifra inválida/);
  assert.throws(() => c.seal(ring, "x", "iban:"), /Finalidade de cifra inválida/);
  assert.throws(() => c.open(ring, "v1.abc", `iban:${ID}`), /formato desconhecido/);
  assert.throws(() => c.open(ring, "c1.AAAA", `iban:${ID}`), /incompleto/);
  // Um valor adulterado não decifra.
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
  assert.throws(() => c.open(ring, tampered, `iban:${ID}`));
});

test("invalid keys give a clear message naming CREATORS_ENCRYPTION_KEY", () => {
  assert.match(c.creatorsKeyProblem(""), /CREATORS_ENCRYPTION_KEY em falta/);
  assert.match(c.creatorsKeyProblem(K1), /versão à frente/);
  assert.match(c.creatorsKeyProblem("c1:curta"), /32 bytes aleatórios em base64/);
  assert.match(c.creatorsKeyProblem(`v1:${K1}`), /não é uma versão/);
  assert.match(c.creatorsKeyProblem(`c1:${K1},c1:${K2}`), /aparece duas vezes/);
  assert.match(c.creatorsKeyProblem(`c2:${K1},c1:${K1}`), /igual a outra do anel/);
  assert.match(c.creatorsKeyProblem(`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), /comando/);
  assert.equal(c.creatorsKeyProblem(`c1:${K1}`), null);
  assert.equal(c.creatorsKeyProblem(` c2:${K2} , c1:${K1} `), null);
  assert.throws(() => c.parseKeyRing("c1:curta"), /CREATORS_ENCRYPTION_KEY inválida/);
});

test("a key equal to SUPPORT_ENCRYPTION_KEY is refused", () => {
  assert.match(c.creatorsKeyProblem(`c1:${SUPPORT}`, SUPPORT), /SUPPORT_ENCRYPTION_KEY/);
  assert.match(c.creatorsKeyProblem(`c2:${K2},c1:${SUPPORT}`, ` ${SUPPORT} `), /SUPPORT_ENCRYPTION_KEY/);
  assert.throws(() => c.parseKeyRing(`c1:${SUPPORT}`, SUPPORT), /SUPPORT_ENCRYPTION_KEY/);
});

test("key ring c2,c1: a c1 value opens, new values come out c2, reseal moves c1 to c2", () => {
  const old = c.parseKeyRing(`c1:${K1}`);
  const v1 = c.seal(old, "dados fiscais", `fiscal:${ID}`);
  const ring = c.parseKeyRing(`c2:${K2},c1:${K1}`, SUPPORT);
  assert.equal(ring.current, "c2");
  assert.deepEqual(ring.versions, ["c2", "c1"]);
  assert.equal(c.open(ring, v1, `fiscal:${ID}`), "dados fiscais");
  const v2 = c.seal(ring, "dados fiscais", `fiscal:${ID}`);
  assert.match(v2, /^c2\./);
  // Regravação (tick com CREATORS_RESEAL_FROM=c1): mesma AAD; os c2 ficam como estão.
  const moved = c.reseal(ring, v1, `fiscal:${ID}`, "c1");
  assert.match(moved, /^c2\./);
  assert.equal(c.reseal(ring, v2, `fiscal:${ID}`, "c1"), null);
  assert.equal(c.reseal(ring, null, `fiscal:${ID}`, "c1"), null);
  // Depois de retirar c1, o valor regravado continua a abrir.
  const after = c.parseKeyRing(`c2:${K2}`);
  assert.equal(c.open(after, moved, `fiscal:${ID}`), "dados fiscais");
  assert.equal(c.resealProblem(ring, "c1"), null);
  assert.equal(c.resealProblem(ring, ""), null);
  assert.match(c.resealProblem(ring, "c2"), /já é a chave atual/);
  assert.match(c.resealProblem(after, "c1"), /já não está/);
  assert.match(c.resealProblem(ring, "1"), /inválida/);
});

test("a prefix without its key fails with the right message", () => {
  const ring2 = c.parseKeyRing(`c2:${K2}`);
  const v1 = c.seal(c.parseKeyRing(`c1:${K1}`), "x", `iban:${ID}`);
  assert.throws(() => c.open(ring2, v1, `iban:${ID}`), /Falta a chave c1 em CREATORS_ENCRYPTION_KEY/);
});

test("each purpose uses its own HKDF subkey (iban and fiscal differ)", () => {
  const master = Buffer.from(K1, "base64");
  const iban = c.subkey(master, "iban");
  const fiscal = c.subkey(master, "fiscal");
  assert.equal(iban.length, 32);
  assert.notDeepEqual(iban, fiscal);
  assert.notDeepEqual(iban, master);
  assert.deepEqual(iban, Buffer.from(hkdfSync("sha256", master, "", "ldo-cr:iban", 32)));
  // Um valor da finalidade iban não abre como outra finalidade, mesmo com o mesmo id.
  const ring = c.parseKeyRing(`c1:${K1}`);
  const s = c.seal(ring, "x", `iban:${ID}`);
  for (const p of ["fiscal", "addr", "payee", "ig", "igsel"]) assert.throws(() => c.open(ring, s, `${p}:${ID}`));
});

test("IP hash key: HKDF of the server token, deterministic and different from the token", () => {
  const token = randomBytes(32).toString("hex");
  const k = c.serverKey(token, c.IP_KEY_INFO);
  assert.equal(k.length, 32);
  assert.deepEqual(k, c.serverKey(token, "ldo-cr-ip-v1"));
  assert.notEqual(k.toString("hex"), token);
  assert.notDeepEqual(k, c.serverKey(token, c.UNSUB_KEY_INFO));
  const h = c.ipHashWith(token, "203.0.113.7");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, c.ipHashWith(token, "203.0.113.7"));
  assert.notEqual(h, c.ipHashWith(token, "203.0.113.8"));
  assert.notEqual(h, c.ipHashWith(randomBytes(32).toString("hex"), "203.0.113.7"));
  assert.ok(!h.includes(token) && h !== token);
  assert.throws(() => c.serverKey("", c.IP_KEY_INFO), /CREATORS_SERVER_TOKEN/);
});

test("server signatures verify in constant time and fail with another token or value", () => {
  const token = randomBytes(32).toString("hex");
  const sig = c.serverSign(token, c.UNSUB_KEY_INFO, ID);
  assert.equal(c.serverVerify(token, c.UNSUB_KEY_INFO, ID, sig), true);
  assert.equal(c.serverVerify(token, c.UNSUB_KEY_INFO, "outro", sig), false);
  assert.equal(c.serverVerify(randomBytes(32).toString("hex"), c.UNSUB_KEY_INFO, ID, sig), false);
  assert.equal(c.serverVerify(token, c.UNSUB_KEY_INFO, ID, ""), false);
});
