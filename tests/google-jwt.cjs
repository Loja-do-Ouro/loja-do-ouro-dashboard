const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const g = require("../.test-build/support/google-jwt.js");

const R = g.JWT_REASONS;
const NOW = 1_791_400_000;
const AUD = "https://dash.lojadoouro.pt/api/support/gmail/push";
const SA = "gmail-push@loja-do-ouro.iam.gserviceaccount.com";

function keyPair(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, publicKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}
const K1 = keyPair("k1");
const K2 = keyPair("k2");
const K3 = keyPair("k3");

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const claims = (over = {}) => ({
  aud: AUD, azp: "113774264463038321964", email: SA, sub: "113774264463038321964", email_verified: true,
  iat: NOW - 100, exp: NOW + 3500, iss: "https://accounts.google.com", ...over,
});
function token(payload = claims(), { kid = "k1", key = K1.privateKey, header } = {}) {
  const input = `${b64(header || { alg: "RS256", kid, typ: "JWT" })}.${b64(payload)}`;
  return `${input}.${crypto.sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
}
const expect = { audience: AUD, email: SA, now: NOW };
const verify = (t, keys = [K1.jwk], exp = expect) => g.verifyGoogleJwt(t, keys, exp);
const reason = (r) => (r.ok ? "ok" : r.reason);

// Resposta falsa do JWKS da Google, a contar os pedidos.
function fakeGoogle(initial, cacheControl = "public, max-age=600, must-revalidate, no-transform") {
  const state = { calls: 0, keys: initial, status: 200, fail: false, body: null, urls: [], signals: [] };
  state.fetch = async (url, init) => {
    state.calls++;
    state.urls.push(String(url));
    state.signals.push(init && init.signal);
    if (state.fail) throw new TypeError("fetch failed");
    const body = state.body ?? JSON.stringify({ keys: state.keys });
    return new Response(body, { status: state.status, headers: { "content-type": "application/json", "cache-control": cacheControl } });
  };
  return state;
}

test("A valid Pub/Sub push token is accepted and only the typed claims are returned", () => {
  const r = verify(token());
  assert.equal(r.ok, true);
  assert.deepEqual(r.claims, {
    iss: "https://accounts.google.com", aud: AUD, email: SA, email_verified: true, exp: NOW + 3500, iat: NOW - 100, sub: "113774264463038321964",
  });
  // Emissor sem https://, conta de serviço com outras maiúsculas e sem sub: também válido.
  const r2 = verify(token(claims({ iss: "accounts.google.com", sub: undefined })), [K2.jwk, K1.jwk], { ...expect, email: ` ${SA.toUpperCase()} ` });
  assert.equal(r2.ok, true);
  assert.equal(r2.claims.iss, "accounts.google.com");
  assert.equal("sub" in r2.claims, false);
  // Chave sem alg/use (campos opcionais do JWKS) também serve.
  const { alg, use, ...bare } = K1.jwk;
  assert.equal(verify(token(), [bare]).ok, true);
  // Sem "now": usa o relógio do sistema.
  const real = Math.floor(Date.now() / 1000);
  assert.equal(g.verifyGoogleJwt(token(claims({ iat: real - 10, exp: real + 3600 })), [K1.jwk], { audience: AUD, email: SA }).ok, true);
});

test("Wrong issuer, audience, service account or unverified email are rejected", () => {
  assert.equal(reason(verify(token(claims({ iss: "https://evil.example" })))), R.iss);
  assert.equal(reason(verify(token(claims({ iss: "https://accounts.google.com/" })))), R.iss);
  assert.equal(reason(verify(token(claims({ iss: undefined })))), R.iss);
  // Audiência: comparação exata (sem barra final, sem maiúsculas, sem listas).
  assert.equal(reason(verify(token(claims({ aud: `${AUD}/` })))), R.aud);
  assert.equal(reason(verify(token(claims({ aud: AUD.toUpperCase() })))), R.aud);
  assert.equal(reason(verify(token(claims({ aud: [AUD] })))), R.aud);
  assert.equal(reason(verify(token(claims({ aud: undefined })))), R.aud);
  assert.equal(reason(verify(token(claims({ email: "outra@loja-do-ouro.iam.gserviceaccount.com" })))), R.email);
  assert.equal(reason(verify(token(claims({ email: undefined })))), R.email);
  assert.equal(reason(verify(token(claims({ email_verified: false })))), R.verified);
  assert.equal(reason(verify(token(claims({ email_verified: "true" })))), R.verified);
  assert.equal(reason(verify(token(claims({ email_verified: undefined })))), R.verified);
  // Sem audiência ou conta de serviço configuradas nada é aceite.
  assert.equal(reason(verify(token(), [K1.jwk], { ...expect, audience: "" })), R.config);
  assert.equal(reason(verify(token(), [K1.jwk], { ...expect, email: "  " })), R.config);
});

test("Expiry and issue time are checked with 60 s and 5 min of clock tolerance", () => {
  assert.equal(verify(token(claims({ exp: NOW - 60 }))).ok, true);
  assert.equal(reason(verify(token(claims({ exp: NOW - 61 })))), R.expired);
  assert.equal(reason(verify(token(claims({ exp: NOW - 86400 })))), R.expired);
  assert.equal(verify(token(claims({ iat: NOW + 300 }))).ok, true);
  assert.equal(reason(verify(token(claims({ iat: NOW + 301 })))), R.future);
  // Datas em falta ou que não são números.
  assert.equal(reason(verify(token(claims({ exp: undefined })))), R.malformed);
  assert.equal(reason(verify(token(claims({ iat: "1791400000" })))), R.malformed);
});

test("Only RS256 is accepted: alg none and HS256 with the public key as secret are rejected", () => {
  const p = b64(claims());
  // alg none, sem assinatura e com uma assinatura qualquer.
  assert.equal(reason(verify(`${b64({ alg: "none", kid: "k1" })}.${p}.`)), R.malformed);
  assert.equal(reason(verify(`${b64({ alg: "none", kid: "k1" })}.${p}.AAAA`)), R.alg);
  // HS256 assinado com a chave pública (PEM e JWK) como segredo.
  for (const secret of [K1.publicKey.export({ type: "spki", format: "pem" }), JSON.stringify(K1.jwk), K1.jwk.n]) {
    const input = `${b64({ alg: "HS256", kid: "k1", typ: "JWT" })}.${p}`;
    const sig = crypto.createHmac("sha256", secret).update(input).digest("base64url");
    assert.equal(reason(verify(`${input}.${sig}`)), R.alg);
  }
  for (const alg of ["RS512", "PS256", "ES256", "rs256", undefined]) {
    assert.equal(reason(verify(token(claims(), { header: { alg, kid: "k1" } }))), R.alg);
  }
  // Cabeçalho sem kid ou com extensões "crit" desconhecidas.
  assert.equal(reason(verify(token(claims(), { header: { alg: "RS256" } }))), R.malformed);
  assert.equal(reason(verify(token(claims(), { header: { alg: "RS256", kid: 1 } }))), R.malformed);
  assert.equal(reason(verify(token(claims(), { header: { alg: "RS256", kid: "k1", crit: ["exp"], exp: 1 } }))), R.malformed);
});

test("Unknown or unusable keys are rejected", () => {
  assert.equal(reason(verify(token(claims(), { kid: "k9" }))), R.kid);
  assert.equal(reason(verify(token(), [])), R.kid);
  assert.equal(reason(verify(token(), null)), R.kid);
  assert.equal(reason(verify(token(), [{ ...K1.jwk, kty: "EC" }])), R.kid);
  assert.equal(reason(verify(token(), [{ ...K1.jwk, alg: "RS512" }])), R.kid);
  assert.equal(reason(verify(token(), [{ ...K1.jwk, use: "enc" }])), R.kid);
  assert.equal(reason(verify(token(), [{ ...K1.jwk, n: "lixo!" }])), R.kid);
  assert.equal(reason(verify(token(), [{ ...K1.jwk, n: "" }])), R.kid);
});

test("A tampered payload, signature or a token signed with another key fails the signature check", () => {
  const [h, , s] = token().split(".");
  const tampered = `${h}.${b64(claims({ email: "atacante@exemplo.pt" }))}.${s}`;
  assert.equal(reason(g.verifyGoogleJwt(tampered, [K1.jwk], { ...expect, email: "atacante@exemplo.pt" })), R.signature);
  const sig = Buffer.from(s, "base64url");
  sig[10] ^= 1;
  assert.equal(reason(verify(`${h}.${token().split(".")[1]}.${sig.toString("base64url")}`)), R.signature);
  assert.equal(reason(verify(`${h}.${token().split(".")[1]}.${sig.subarray(0, 128).toString("base64url")}`)), R.signature);
  // Outra chave com o mesmo kid (ou a chave certa com outro kid na lista).
  assert.equal(reason(verify(token(claims(), { key: K2.privateKey }))), R.signature);
  assert.equal(reason(verify(token(), [{ ...K2.jwk, kid: "k1" }])), R.signature);
  // Cabeçalho trocado depois de assinado.
  const [, p2, s2] = token().split(".");
  assert.equal(reason(verify(`${b64({ alg: "RS256", kid: "k1" })}.${p2}.${s2}`)), R.signature);
});

test("Malformed tokens are rejected without throwing", () => {
  const good = token();
  const [h, p, s] = good.split(".");
  const bad = [
    "", "abc", "a.b", `${good}.x`, `${h}.${p}`, `${h}.${p}.`, `.${p}.${s}`, `${h}..${s}`,
    `${h}.${p}.${s}=`, `${h}=.${p}.${s}`, `${h}.${p}.${s.slice(0, 5)}+${s.slice(6)}`, ` ${good}`, `${good}\n`,
    `${b64("não é json")}.${p}.${s}`, `${h}.${b64("[1,2]")}.${s}`, `${b64("null")}.${p}.${s}`, `${h}.${b64("123")}.${s}`,
    `${h}.${p}.${s}${"A".repeat(9000)}`,
  ];
  for (const t of bad) assert.equal(reason(verify(t)), R.malformed, JSON.stringify(t.slice(0, 40)));
  // Escrita base64url não canónica (bits de sobra) da mesma assinatura.
  const last = s[s.length - 1];
  const alt = "AQgw".includes(last) ? String.fromCharCode(last.charCodeAt(0) + 1) : null;
  if (alt && s.length % 4 !== 0) assert.equal(reason(verify(`${h}.${p}.${s.slice(0, -1)}${alt}`)), R.malformed);
  // Entradas que nem são texto.
  for (const t of [null, undefined, 123, {}, ["a", "b", "c"]]) assert.equal(reason(g.verifyGoogleJwt(t, [K1.jwk], expect)), R.malformed);
  assert.equal(reason(g.verifyGoogleJwt(good, [K1.jwk], undefined)), R.config);
  assert.equal(reason(g.verifyGoogleJwt(good, [null, 1, "x", K1.jwk], expect)), "ok");
});

test("decodeJwtUnverified only decodes for logging", () => {
  const d = g.decodeJwtUnverified(token(claims(), { key: K2.privateKey }));
  assert.equal(d.header.kid, "k1");
  assert.equal(d.payload.email, SA);
  assert.equal(g.decodeJwtUnverified("lixo"), null);
  assert.equal(g.decodeJwtUnverified(null), null);
});

test("Key cache lifetime follows Cache-Control max-age (minus Age), between 5 min and 1 day", () => {
  assert.equal(g.keysTtl("public, max-age=19523, must-revalidate, no-transform"), 19523);
  assert.equal(g.keysTtl("public, max-age=19523, must-revalidate", "523"), 19000);
  assert.equal(g.keysTtl("Public, Max-Age=\"7200\""), 7200);
  assert.equal(g.keysTtl(null), 3600);
  assert.equal(g.keysTtl(""), 3600);
  assert.equal(g.keysTtl("no-cache"), 3600);
  assert.equal(g.keysTtl("public, s-maxage=9000"), 3600);
  assert.equal(g.keysTtl("max-age=10"), 300);
  assert.equal(g.keysTtl("max-age=0"), 300);
  assert.equal(g.keysTtl("max-age=1000", "900"), 300);
  assert.equal(g.keysTtl("max-age=99999999"), 86400);
  assert.equal(g.keysTtl("max-age=abc"), 3600);
});

test("googleKeys caches for max-age, re-fetches when forced and shares concurrent requests", async () => {
  g.clearGoogleKeysCache();
  const google = fakeGoogle([K1.jwk, { kid: "x", kty: "RSA" }, null, "lixo"]);
  const T = NOW;
  const keys = await g.googleKeys({ fetchImpl: google.fetch, now: T });
  assert.deepEqual(keys, [K1.jwk]);
  assert.equal(google.calls, 1);
  assert.equal(google.urls[0], g.GOOGLE_CERTS_URL);
  assert.ok(google.signals[0] instanceof AbortSignal);
  await g.googleKeys({ fetchImpl: google.fetch, now: T + 599 });
  assert.equal(google.calls, 1);
  google.keys = [K1.jwk, K2.jwk];
  assert.deepEqual((await g.googleKeys({ fetchImpl: google.fetch, now: T + 600 })).map((k) => k.kid), ["k1", "k2"]);
  assert.equal(google.calls, 2);
  await g.googleKeys({ fetchImpl: google.fetch, now: T + 601, force: true });
  assert.equal(google.calls, 3);
  // Pedidos em simultâneo: um só pedido à Google.
  const all = await Promise.all([1, 2, 3].map(() => g.googleKeys({ fetchImpl: google.fetch, now: T + 5000 })));
  assert.equal(google.calls, 4);
  assert.equal(all[2].length, 2);
  // Falha ao renovar à força: lança exceção e mantém as chaves que já tinha.
  google.status = 500;
  await assert.rejects(g.googleKeys({ fetchImpl: google.fetch, now: T + 5001, force: true }));
  assert.equal((await g.googleKeys({ fetchImpl: google.fetch, now: T + 5002 })).length, 2);
  assert.equal(google.calls, 5);
  // Respostas sem chaves válidas ou que não são JSON: erro.
  g.clearGoogleKeysCache();
  google.status = 200;
  google.keys = [{ kid: "x", kty: "RSA" }];
  await assert.rejects(g.googleKeys({ fetchImpl: google.fetch, now: T }));
  google.body = "<html>";
  await assert.rejects(g.googleKeys({ fetchImpl: google.fetch, now: T }));
  google.body = null;
  google.fail = true;
  await assert.rejects(g.googleKeys({ fetchImpl: google.fetch, now: T }));
  // Sem Cache-Control: uma hora.
  g.clearGoogleKeysCache();
  const plain = fakeGoogle([K1.jwk], "");
  await g.googleKeys({ fetchImpl: plain.fetch, now: T });
  await g.googleKeys({ fetchImpl: plain.fetch, now: T + 3599 });
  assert.equal(plain.calls, 1);
  await g.googleKeys({ fetchImpl: plain.fetch, now: T + 3600 });
  assert.equal(plain.calls, 2);
});

test("verifyPubSubPush parses the Authorization header and rejects bad headers without fetching keys", async () => {
  g.clearGoogleKeysCache();
  const google = fakeGoogle([K1.jwk]);
  const opts = { fetchImpl: google.fetch, now: NOW };
  const exp = { audience: AUD, email: SA };
  const t = token();
  for (const h of [null, undefined, "", "Bearer", "Bearer ", `Basic ${t}`, `Bearer${t}`, `Bearer ${t} extra`, `Token ${t}`, t, `Bearer ${"a".repeat(9000)}`, 42]) {
    assert.equal(reason(await g.verifyPubSubPush(h, exp, opts)), R.header, String(h).slice(0, 30));
  }
  assert.equal(reason(await g.verifyPubSubPush("Bearer abc.def", exp, opts)), R.malformed);
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${b64({ alg: "none", kid: "k1" })}.${b64(claims())}.AAAA`, exp, opts)), R.alg);
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${t}`, { audience: "", email: SA }, opts)), R.config);
  assert.equal(google.calls, 0);
  // Esquema sem distinção de maiúsculas; espaços extra tolerados.
  for (const h of [`Bearer ${t}`, `bearer ${t}`, `BEARER  ${t}`, `Bearer\t${t}`, `  Bearer ${t}  `]) {
    const r = await g.verifyPubSubPush(h, exp, opts);
    assert.equal(r.ok, true, h.slice(0, 12));
    assert.equal(r.claims.email, SA);
  }
  assert.equal(google.calls, 1);
  // Recusas de claims não voltam a pedir as chaves.
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${token(claims({ aud: "https://outro.example" }))}`, exp, { ...opts, now: NOW + 100 })), R.aud);
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${token(claims({ exp: NOW - 3600 }))}`, exp, { ...opts, now: NOW + 100 })), R.expired);
  assert.equal(google.calls, 1);
});

test("verifyPubSubPush re-fetches the keys once for an unknown kid, at most every 30 s", async () => {
  g.clearGoogleKeysCache();
  const google = fakeGoogle([K1.jwk], "public, max-age=20000");
  const exp = { audience: AUD, email: SA };
  const T = NOW;
  assert.equal((await g.verifyPubSubPush(`Bearer ${token()}`, exp, { fetchImpl: google.fetch, now: T })).ok, true);
  assert.equal(google.calls, 1);
  // A Google rodou as chaves: k2 ainda não está na cache, que continua válida.
  google.keys = [K1.jwk, K2.jwk];
  const t2 = token(claims({ iat: T + 50, exp: T + 3650 }), { kid: "k2", key: K2.privateKey });
  const r = await g.verifyPubSubPush(`Bearer ${t2}`, exp, { fetchImpl: google.fetch, now: T + 60 });
  assert.equal(r.ok, true);
  assert.equal(google.calls, 2);
  assert.equal((await g.verifyPubSubPush(`Bearer ${t2}`, exp, { fetchImpl: google.fetch, now: T + 61 })).ok, true);
  assert.equal(google.calls, 2);
  // kid inventado: logo a seguir a renovar não volta a pedir; depois de 30 s pede uma única vez.
  const t3 = token(claims(), { kid: "k3", key: K3.privateKey });
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${t3}`, exp, { fetchImpl: google.fetch, now: T + 70 })), R.kid);
  assert.equal(google.calls, 2);
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${t3}`, exp, { fetchImpl: google.fetch, now: T + 90 })), R.kid);
  assert.equal(google.calls, 3);
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${t3}`, exp, { fetchImpl: google.fetch, now: T + 100 })), R.kid);
  assert.equal(google.calls, 3);
  // Cache vazia e kid desconhecido: um só pedido (as chaves acabaram de chegar).
  g.clearGoogleKeysCache();
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${t3}`, exp, { fetchImpl: google.fetch, now: T + 200 })), R.kid);
  assert.equal(google.calls, 4);
  // Falha ao renovar: fica a recusa original.
  google.fail = true;
  assert.equal(reason(await g.verifyPubSubPush(`Bearer ${t3}`, exp, { fetchImpl: google.fetch, now: T + 300 })), R.kid);
  assert.equal(google.calls, 5);
});

test("verifyPubSubPush never throws on network errors or bad responses", async () => {
  const exp = { audience: AUD, email: SA };
  const t = `Bearer ${token()}`;
  g.clearGoogleKeysCache();
  const down = fakeGoogle([K1.jwk]);
  down.fail = true;
  assert.equal(reason(await g.verifyPubSubPush(t, exp, { fetchImpl: down.fetch, now: NOW })), R.keys);
  g.clearGoogleKeysCache();
  const html = fakeGoogle([K1.jwk]);
  html.body = "<html>erro</html>";
  assert.equal(reason(await g.verifyPubSubPush(t, exp, { fetchImpl: html.fetch, now: NOW })), R.keys);
  g.clearGoogleKeysCache();
  const status = fakeGoogle([K1.jwk]);
  status.status = 503;
  assert.equal(reason(await g.verifyPubSubPush(t, exp, { fetchImpl: status.fetch, now: NOW })), R.keys);
  g.clearGoogleKeysCache();
  const throws = () => { throw new Error("síncrono"); };
  assert.equal(reason(await g.verifyPubSubPush(t, exp, { fetchImpl: throws, now: NOW })), R.keys);
  assert.equal(reason(await g.verifyPubSubPush(t, undefined, { now: NOW })), R.config);
  // Recupera quando a Google volta a responder.
  assert.equal((await g.verifyPubSubPush(t, exp, { fetchImpl: fakeGoogle([K1.jwk]).fetch, now: NOW })).ok, true);
  g.clearGoogleKeysCache();
});
