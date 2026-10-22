const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../.test-build/easypay-rules.js");

const customer = { name: "Ana Silva", email: "ana@exemplo.pt", phone: "+351912345678" };

test("base URL follows the environment", () => {
  assert.equal(r.easypayBase("test"), "https://api.test.easypay.pt/2.0");
  assert.equal(r.easypayBase("prod"), "https://api.prod.easypay.pt/2.0");
});

test("Portuguese mobiles are split as easypay expects", () => {
  assert.deepEqual(r.splitPhone("+351912345678"), { phone_indicative: "+351", phone: "912345678" });
  assert.deepEqual(r.splitPhone("+351 912 345 678"), { phone_indicative: "+351", phone: "912345678" });
  assert.deepEqual(r.splitPhone("+34612345678"), { phone: "+34612345678" });
  assert.deepEqual(r.splitPhone("abc"), {});
  assert.deepEqual(r.splitPhone(null), {});
});

test("deposit is an authorisation (hold) with our id as key", () => {
  const b = r.authorisationBody({ id: "6b1f0c1e-0000-4000-8000-000000000001", amount: 300, method: "mbw", customer, phone: "+351933333333" });
  assert.equal(b.type, "authorisation");
  assert.equal(b.method, "mbw");
  assert.equal(b.value, 300);
  assert.equal(b.currency, "EUR");
  assert.equal(b.key, "6b1f0c1e-0000-4000-8000-000000000001");
  assert.equal(b.customer.phone, "933333333");
  assert.equal(b.customer.phone_indicative, "+351");
});

test("lot payment is a sale; Multibanco uses MB and expires at the payment deadline", () => {
  const mb = r.saleBody({ id: "x".repeat(36), amount: 3300.004, method: "mb", customer, lot: "outono lote 3", dueAt: "2026-11-04T21:00:00.000Z" });
  assert.equal(mb.type, "sale");
  assert.equal(mb.method, "MB");
  assert.equal(mb.value, 3300);
  assert.equal(mb.multibanco.expiration_time, "2026-11-04T21:00:00Z");
  assert.equal(mb.capture.descriptive, "Leilão outono lote 3");
  const cc = r.saleBody({ id: "y", amount: 10, method: "cc", customer, lot: "a<b>", dueAt: null });
  assert.equal(cc.method, "cc");
  assert.equal(cc.multibanco, undefined);
  assert.equal(cc.capture.descriptive, "Leilão ab");
});

test("created response gives the reference, card page and Multibanco data", () => {
  assert.deepEqual(r.readCreated({ status: "ok", id: "66d5", method: { type: "CC", status: "pending", url: "https://cc.test.easypay.pt/v3/public/card-details/66d5" } }),
    { ref: "66d5", url: "https://cc.test.easypay.pt/v3/public/card-details/66d5", entity: null, reference: null, expires_at: null });
  const mb = r.readCreated({ status: "ok", id: "e95d", method: { type: "MB", entity: "11683", reference: "663000450" }, multibanco: { expiration_time: "2025-08-24T10:22:52Z" } });
  assert.equal(mb.entity, "11683");
  assert.equal(mb.reference, "663000450");
  assert.equal(mb.expires_at, "2025-08-24T10:22:52Z");
  assert.equal(r.readCreated({ status: "error", message: ["x"] }), null);
  assert.equal(r.readCreated({ status: "ok", id: "z", method: { url: "http://insecure" } }).url, null);
});

test("status and errors are read safely", () => {
  assert.equal(r.readStatus({ payment_status: "authorised" }), "authorised");
  assert.equal(r.readStatus({ payment_status: "paid" }), "paid");
  assert.equal(r.readStatus({ payment_status: "deleted" }), "failed");
  assert.equal(r.readStatus({ payment_status: "active" }), null);
  assert.equal(r.readStatus(null), null);
  assert.equal(r.readError({ message: ["Invalid phone"] }, 400), "Invalid phone");
  assert.equal(r.readError({}, 500), "easypay recusou o pedido (500).");
  assert.equal(r.notificationId({ id: "5eca7446-14e9-47bb-aabb-5ee237159b8b", type: "capture" }), "5eca7446-14e9-47bb-aabb-5ee237159b8b");
  assert.equal(r.notificationId({ id: "../x" }), null);
  assert.equal(r.notificationId("nada"), null);
});

test("card checkout session: CC only, hold for deposits and sale for lots, keyed by our id", () => {
  const id = "6b1f0c1e-0000-4000-8000-000000000002";
  const dep = r.checkoutBody({ id, amount: 300, type: "authorisation", customer, description: "Caução leilão lote 3" });
  assert.deepEqual(dep.type, ["single"]);
  assert.deepEqual(dep.payment.methods, ["CC"]);
  assert.equal(dep.payment.type, "authorisation");
  assert.equal(dep.payment.key, id);
  assert.equal(dep.payment.capture, undefined);
  assert.equal(dep.order.value, 300);
  assert.equal(dep.order.items[0].key, id);
  const sale = r.checkoutBody({ id, amount: 3300, type: "sale", customer, description: "Leilão outono lote 3" });
  assert.equal(sale.payment.type, "sale");
  assert.equal(sale.payment.capture.descriptive, "Leilão outono lote 3");
  assert.ok(r.CHECKOUT_SDK.startsWith("https://cdn.easypay.pt/checkout/"));
});

test("checkout manifest, payment id and key are read safely", () => {
  assert.deepEqual(r.readManifest({ id: "10d3", session: "XkhR", config: null }), { id: "10d3", session: "XkhR", config: null });
  assert.equal(r.readManifest({ id: "10d3" }), null);
  assert.equal(r.checkoutPaymentId({ payment: { id: "df9d691d-f7fe-4ce4-8205-323888a769f3", status: "success" } }), "df9d691d-f7fe-4ce4-8205-323888a769f3");
  assert.equal(r.checkoutPaymentId({ payment: {} }), null);
  assert.equal(r.readKey({ key: "6b1f0c1e-0000-4000-8000-000000000002" }), "6b1f0c1e-0000-4000-8000-000000000002");
  assert.equal(r.readKey({ key: "merchant key" }), null);
});
