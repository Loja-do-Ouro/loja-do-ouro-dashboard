const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Testes estáticos de integração da plataforma de criadores (PR1): o que liga o trabalho de várias partes e que o tsc
// não apanha (caminhos de páginas, rotas, níveis de acesso, regras visuais do §10.6).
const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "app", "(criadores-site)");
const PAINEL = path.join(ROOT, "app", "(painel)", "influenciadores");
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");
// Sem comentários de linha nem de bloco (que explicam o que nunca se usa).
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const exists = fs.existsSync(path.join(SITE, "c", "actions.ts"));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

// Páginas do site (caminhos públicos, sem o /c interno).
function sitePages() {
  return new Set(
    walk(path.join(SITE, "c"))
      .filter((f) => /[\\/]page\.tsx$/.test(f))
      .map((f) => path.relative(path.join(SITE, "c"), path.dirname(f)).split(path.sep).join("/"))
      .map((p) => (p ? `/${p}` : "/")),
  );
}

test("every site path used in links, redirects and emails is a page of the creators site", { skip: !exists }, () => {
  const pages = sitePages();
  const files = [...walk(SITE), ...walk(path.join(ROOT, "lib", "criadores")), ...walk(path.join(ROOT, "app", "api", "c")), path.join(ROOT, "lib", "criadores-rules.ts")];
  const found = new Set();
  const re = /(?:\$\{(?:base|b|site|siteBase\(\))\}|href=\{?["`]|redirect\(["`]|go\(["`]|tokenLink\(\w+,\s*")(\/[a-z][a-z0-9/-]*)/g;
  for (const f of files) for (const m of code(fs.readFileSync(f, "utf8")).matchAll(re)) found.add(m[1].replace(/\/+$/, ""));
  assert.ok(found.size >= 12, `poucos caminhos encontrados (${found.size}): a expressão deixou de os apanhar`);
  for (const p of found) assert.ok(pages.has(p), `«${p}» não é uma página de app/(criadores-site)/c`);
  // As ligações dos emails com token levam a páginas cujo formulário lê o #t= (useHashToken de token-from-hash.tsx).
  const forms = code(read(SITE, "c", "forms.tsx"));
  for (const p of ["/conta/confirmar", "/conta/nova-palavra-passe", "/conta/iban"]) {
    assert.ok(pages.has(p), `falta a página ${p}`);
    const page = read(SITE, "c", ...p.slice(1).split("/"), "page.tsx");
    const used = /import \{([^}]*)\} from "\.\.\/\.\.\/forms"/.exec(page);
    assert.ok(used, `${p} não usa os formulários de forms.tsx`);
    const reads = used[1].split(",").map((s) => s.trim()).filter(Boolean).some((name) => {
      const body = new RegExp(`export function ${name}\\b[\\s\\S]*?(?=\\nexport |$)`).exec(forms);
      return Boolean(body && /useHashToken\(/.test(body[0]));
    });
    assert.ok(reads, `${p} não lê o token do fragmento`);
  }
});

test("backoffice: each action checks the creators level and nothing calls the database directly", { skip: !exists }, () => {
  const actions = code(read(PAINEL, "actions.ts"));
  const parts = actions.split(/(?=^export async function )/m).filter((s) => s.startsWith("export async function"));
  assert.ok(parts.length >= 10);
  for (const p of parts) {
    const name = /export async function (\w+)/.exec(p)[1];
    assert.match(p, /requireCreatorsViewer\(|superViewer\(/, `${name} não confirma o nível`);
  }
  assert.match(actions, /async function superViewer[\s\S]*?requireCreatorsViewer\("manage"\)[\s\S]*?isSuper/);
  for (const f of [...walk(PAINEL), ...walk(SITE), ...walk(path.join(ROOT, "app", "api", "c")), ...walk(path.join(ROOT, "app", "api", "influenciadores"))]) {
    const src = code(fs.readFileSync(f, "utf8"));
    assert.doesNotMatch(src, /\b(?:rpc|crStaffRpc|crServerRpc)\s*(?:<[^>]*>)?\(\s*[^)]*?["'`]ldo_cr_/, `${path.relative(ROOT, f)} chama uma ldo_cr_* sem passar por lib/criadores`);
  }
  for (const page of ["page.tsx", "criadores/page.tsx", "criadores/[id]/page.tsx", "privacidade/page.tsx"])
    assert.match(read(PAINEL, ...page.split("/")), /requireCreatorsViewer\("view"\)/, page);
  assert.match(read(PAINEL, "definicoes", "page.tsx"), /requireCreatorsViewer\("manage"\)/);
});

test("[rev. S-M8, R-M9] the team export is POST only, same origin, and never deciphers", { skip: !exists }, () => {
  const src = code(read(ROOT, "app", "api", "influenciadores", "export", "[id]", "route.ts"));
  assert.doesNotMatch(src, /criadores\/crypto|openIban|openFiscal|openFor/);
  assert.match(src, /export async function GET\(\)[\s\S]*?405/);
  assert.match(src, /export async function POST[\s\S]*?sameOrigin\(request\)/);
  assert.match(src, /canManageCreators\(viewer\)/);
  assert.match(src, /crAdminExport\(/);
});

test("creators API routes: export checks the origin and Sec-Fetch-Site; the tick checks its token", { skip: !exists }, () => {
  const exp = code(read(ROOT, "app", "api", "c", "export", "route.ts"));
  assert.match(exp, /sameOriginPost\(/);
  assert.match(exp, /"sec-fetch-site"/);
  assert.doesNotMatch(exp, /export async function GET/);
  const tick = code(read(ROOT, "app", "api", "c", "tick", "route.ts"));
  assert.match(tick, /crTickCheck\(/);
  assert.match(tick, /maxDuration = 120/);
  assert.match(tick, /after\(/);
  assert.doesNotMatch(tick, /export async function GET/);
  // O pg_cron chama esta rota.
  const sched = read(ROOT, "supabase", "migrations", "20261105100100_ldo_creators_tick_schedule.sql");
  assert.match(sched, /\/api\/c\/tick'/);
});

test("[§10.6] creators site CSS: no gradients, shadows, blur, lifts, spaced capitals or rounded corners; nothing below 13 px", { skip: !exists }, () => {
  const css = read(SITE, "criadores.css").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const bad of [/gradient\(/, /box-shadow/, /backdrop-filter/, /translateY/, /text-transform/])
    assert.doesNotMatch(css, bad, String(bad));
  for (const m of css.matchAll(/border-radius:\s*([^;}]+)/g)) assert.match(m[1].trim(), /^0(px)?$/, `border-radius ${m[1]}`);
  for (const m of css.matchAll(/font-size:\s*([0-9.]+)px/g)) assert.ok(Number(m[1]) >= 13, `font-size ${m[1]}px`);
  for (const f of walk(SITE)) assert.doesNotMatch(code(fs.readFileSync(f, "utf8")), /dangerouslySetInnerHTML/, path.relative(ROOT, f));
});

// As fotografias do site passam pelo otimizador do próprio site, que só aceita os ficheiros de images.remotePatterns
// com a query exata: um URL que falte dá imagem partida (400 em /_next/image), um que sobre alarga a lista à toa.
test("creators site photos: each remote image is in images.remotePatterns with its exact query, and no pattern is unused", { skip: !exists }, () => {
  const cfg = code(read(ROOT, "next.config.mjs"));
  const patterns = [...cfg.matchAll(/\{\s*protocol:\s*"https",\s*hostname:\s*"([^"]+)",\s*pathname:\s*"([^"]+)",\s*search:\s*"([^"]+)"\s*\}/g)]
    .map((m) => `https://${m[1]}${m[2]}${m[3]}`);
  assert.ok(patterns.length >= 1, "images.remotePatterns deixou de ser lido pela expressão do teste");
  const used = new Set();
  for (const f of walk(SITE))
    for (const m of code(fs.readFileSync(f, "utf8")).matchAll(/https:\/\/(?:cdn\.shopify\.com|www\.lojadoouro\.pt)\/[^"'`\s)]+/g)) used.add(m[0]);
  assert.ok(used.size >= 1, "nenhuma imagem remota encontrada no site (o logótipo devia aparecer)");
  for (const u of used) assert.ok(patterns.includes(u), `${u} não está em images.remotePatterns (com a query exata)`);
  for (const p of patterns) assert.ok(used.has(p), `${p} está em images.remotePatterns mas o site já não o usa`);
});
