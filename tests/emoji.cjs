const { test } = require("node:test");
const assert = require("node:assert/strict");
const e = require("../.test-build/support/emoji.js");

test("emoji list has no duplicates and every group has items", () => {
  const all = e.EMOJI_GROUPS.flatMap((g) => g.items.map((i) => i.char));
  assert.equal(new Set(all).size, all.length);
  for (const g of e.EMOJI_GROUPS) assert.ok(g.items.length > 0, g.id);
  assert.equal(new Set(e.EMOJI_GROUPS.map((g) => g.id)).size, e.EMOJI_GROUPS.length);
});

test("search ignores accents and case, matches word starts, needs every word", () => {
  const chars = (q) => e.searchEmoji(q).map((x) => x.char);
  assert.ok(chars("coracao").includes("❤️"));
  assert.ok(chars("CORAÇÃO azul").includes("💙"));
  assert.ok(!chars("coração azul").includes("❤️"));
  assert.equal(chars("coração")[0], "❤️");
  assert.equal(chars("obrigado")[0], "🙏");
  assert.ok(chars("obrigado").includes("😊"));
  assert.ok(chars("anel").includes("💍"));
  assert.ok(chars("entrega").includes("🚚"));
  assert.deepEqual(chars("ração"), []);
  assert.deepEqual(chars("   "), []);
  assert.equal(e.searchEmoji("a", 5).length, 5);
});

test("recent list keeps the newest first, no repeats, only known emojis, capped", () => {
  assert.deepEqual(e.pushRecent(["😊", "👍"], "👍"), ["👍", "😊"]);
  assert.deepEqual(e.pushRecent(["x", "😊"], "💍"), ["💍", "😊"]);
  const many = e.EMOJI_GROUPS[0].items.map((i) => i.char);
  assert.equal(e.pushRecent(many, "💍", 24).length, 24);
});

test("insertAt puts the emoji at the cursor or over the selection", () => {
  assert.deepEqual(e.insertAt("Olá !", 4, 4, "😊"), { text: "Olá 😊!", caret: 6 });
  assert.deepEqual(e.insertAt("Olá XYZ", 4, 7, "👍"), { text: "Olá 👍", caret: 6 });
  assert.deepEqual(e.insertAt("abc", 9, 9, "❤️"), { text: "abc❤️", caret: 5 });
  assert.deepEqual(e.insertAt("abc", 2, 1, "✨"), { text: "a✨c", caret: 2 });
  assert.deepEqual(e.insertAt("", 0, 0, "🇵🇹"), { text: "🇵🇹", caret: 4 });
});
