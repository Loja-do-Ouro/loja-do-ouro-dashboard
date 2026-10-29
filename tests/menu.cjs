const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const menu = require("../.test-build/menu.js");

test("Only the exact cookie value collapses the side menu", () => {
  assert.equal(menu.MENU_COOKIE, "ldo_menu");
  assert.equal(menu.menuCollapsed("recolhido"), true);
  for (const v of [undefined, null, "", "Recolhido", "1", "true", "recolhido "]) assert.equal(menu.menuCollapsed(v), false, String(v));
});

test("The menu cookie lasts a year when collapsed and is deleted when opened", () => {
  assert.equal(menu.menuCookie(true, true), "ldo_menu=recolhido; path=/; max-age=31536000; samesite=lax; secure");
  assert.equal(menu.menuCookie(true, false), "ldo_menu=recolhido; path=/; max-age=31536000; samesite=lax");
  assert.equal(menu.menuCookie(false, true), "ldo_menu=; path=/; max-age=0; samesite=lax; secure");
  assert.equal(menu.menuTitle(false), "Recolher o menu (Ctrl+\\)");
  assert.equal(menu.menuTitle(true), "Mostrar o menu (Ctrl+\\)");
});

test("Ctrl+\\ or Cmd+\\ toggles the menu, by the key typed (Portuguese keyboard), never with AltGr or Shift", () => {
  const key = (k, extra = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...extra });
  assert.equal(menu.isMenuShortcut(key("\\", { ctrlKey: true })), true);
  assert.equal(menu.isMenuShortcut(key("\\", { metaKey: true })), true);
  // AltGr no Windows chega como Ctrl+Alt.
  assert.equal(menu.isMenuShortcut(key("\\", { ctrlKey: true, altKey: true })), false);
  assert.equal(menu.isMenuShortcut(key("|", { ctrlKey: true, shiftKey: true })), false);
  assert.equal(menu.isMenuShortcut(key("\\", { ctrlKey: true, shiftKey: true })), false);
  assert.equal(menu.isMenuShortcut(key("\\", { ctrlKey: true, repeat: true })), false);
  assert.equal(menu.isMenuShortcut(key("\\")), false);
  assert.equal(menu.isMenuShortcut(key("b", { ctrlKey: true })), false);
  assert.equal(menu.isMenuShortcut(key("Enter", { ctrlKey: true })), false);
});

test("The collapsed menu only applies on desktop, with the tablet rail kept in sync", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "app", "(painel)", "globals.css"), "utf8");
  const start = css.indexOf("Menu lateral recolhido no computador");
  assert.ok(start > 0, "bloco do menu recolhido");
  const block = css.slice(start, css.indexOf("/* ---------------------------------------------------------- ranking */"));
  // Todas as regras do estado recolhido ficam dentro do bloco do computador (acima de 960 px).
  const desktop = block.indexOf("@media (min-width: 960.02px) {");
  assert.ok(desktop > 0);
  assert.ok(!block.slice(0, desktop).includes(":root[data-menu"));
  assert.match(block, /:root\[data-menu="recolhido"\] \{\s+--sidebar: 76px;/);
  assert.match(block, /#conteudo \{\s+max-width: 1830px;/);
  assert.match(css, /Editar em conjunto com :root\[data-menu="recolhido"\]/);
  // O layout lê o cookie no servidor e o menu tem o id que o botão controla.
  const layout = fs.readFileSync(path.join(__dirname, "..", "app", "(painel)", "layout.tsx"), "utf8");
  assert.match(layout, /data-menu=\{collapsed \? MENU_COLLAPSED : undefined\}/);
  const shell = fs.readFileSync(path.join(__dirname, "..", "components", "shell.tsx"), "utf8");
  assert.match(shell, /<aside className="sidebar" id="menu-lateral">/);
  const toggle = fs.readFileSync(path.join(__dirname, "..", "components", "menu-toggle.tsx"), "utf8");
  assert.match(toggle, /aria-controls="menu-lateral"/);
});
