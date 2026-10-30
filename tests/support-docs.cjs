// Documentação do Apoio ao Cliente: formato dos artigos (docs/apoio), módulo gerado, desenho seguro e pesquisa.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const f = require("../.test-build/support/docs-format.js");
const s = require("../.test-build/support/docs-search.js");
const r = require("../.test-build/support/docs-render.js");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const sourcesIn = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((x) => x.endsWith(".md"))
        .sort()
        .map((file) => ({ file, source: fs.readFileSync(path.join(dir, file), "utf8") }))
    : [];
const FIXTURES = path.join(__dirname, "fixtures", "support-docs");
const HEAD = "# Exemplo\n<!-- resumo: Um artigo de exemplo. -->\n\n";
const one = (src, file = "05-exemplo.md") => f.parseSupportDoc(file, src);
const plain = (nodes) => f.inlineText(nodes);

// ---------------------------------------------------------------------------------------------------- formato

test("Article format: title, metadata, sections with anchors and questions, every supported block", () => {
  const src = [
    "# Transferir conversas",
    "<!-- resumo: Como passar uma conversa a uma colega. -->",
    "<!-- publico: super-admin -->",
    "<!-- termos: transferir, passar ,  colega -->",
    "<!-- atualizado: 2026-10-30 -->",
    "",
    "Introdução com **negrito**, *itálico*, `código` e [o RGPD](https://eur-lex.europa.eu/eli/reg/2016/679/oj).",
    "",
    "## Quem pode transferir?",
    "<!-- perguntas: Como transfiro uma conversa? | Posso devolver uma conversa? -->",
    "",
    "- O responsável",
    "  - ou o Super Admin",
    "- Ninguém mais,",
    "  com continuação.",
    "",
    "### Deixar sem responsável",
    "",
    "3. Terceiro",
    "4. Quarto",
    "",
    "| Estado | Quando |",
    "| :--- | ---: |",
    "| Novo | Sem `a\\|b` responsável |",
    "",
    "> **Lei:** art. 15.º do RGPD.",
    "> Segunda linha do aviso.",
    "",
    "Ver [a secção](#quem-pode-transferir), [a lista](/apoio/documentacao?q=prazo) e [o email](mailto:apoiocliente@lojadoouro.pt).",
  ].join("\n");
  const { doc, errors } = one(src, "05-transferir.md");
  assert.deepEqual(errors, []);
  assert.equal(doc.slug, "transferir");
  assert.equal(doc.order, 5);
  assert.equal(doc.category, "funcionamento");
  assert.equal(doc.title, "Transferir conversas");
  assert.equal(doc.resumo, "Como passar uma conversa a uma colega.");
  assert.equal(doc.publico, "super-admin");
  assert.deepEqual(doc.termos, ["transferir", "passar", "colega"]);
  assert.equal(doc.atualizado, "2026-10-30");
  assert.deepEqual(
    doc.sections.map((x) => [x.id, x.level, x.parent]),
    [["", 1, null], ["quem-pode-transferir", 2, null], ["deixar-sem-responsavel", 3, "quem-pode-transferir"]],
  );
  assert.deepEqual(doc.sections[1].perguntas, ["Como transfiro uma conversa?", "Posso devolver uma conversa?"]);
  assert.equal(doc.sections[0].text, "Introdução com negrito, itálico, código e o RGPD.");
  assert.equal(doc.sections[1].text, "O responsável ou o Super Admin Ninguém mais, com continuação.");
  assert.equal(doc.sections[2].text, "Terceiro Quarto\nEstado · Quando Novo · Sem a|b responsável\nart. 15.º do RGPD. Segunda linha do aviso.\nVer a secção, a lista e o email.");
  assert.deepEqual(doc.blocks.map((b) => b.t), ["p", "h2", "ul", "h3", "ol", "table", "callout", "p"]);
  assert.deepEqual(doc.blocks[0].c.map((n) => n.t), ["text", "strong", "text", "em", "text", "code", "text", "link", "text"]);
  const ul = doc.blocks[2];
  assert.equal(plain(ul.items[0].sub.items[0].c), "ou o Super Admin");
  assert.equal(plain(ul.items[1].c), "Ninguém mais, com continuação.");
  assert.equal(doc.blocks[4].start, 3);
  assert.deepEqual(doc.blocks[5].align, ["left", "right"]);
  assert.equal(plain(doc.blocks[5].rows[0][1]), "Sem a|b responsável");
  assert.equal(doc.blocks[6].kind, "lei");
  assert.equal(plain(doc.blocks[6].blocks[0].c), "art. 15.º do RGPD. Segunda linha do aviso.");
  const links = doc.blocks[7].c.filter((n) => n.t === "link").map((n) => n.href);
  assert.deepEqual(links, ["/apoio/documentacao/transferir#quem-pode-transferir", "/apoio/documentacao?q=prazo", "mailto:apoiocliente@lojadoouro.pt"]);
  assert.equal(f.categoryOf(19), "funcionamento");
  assert.equal(f.categoryOf(20), "legal");
  assert.equal(f.categoryOf(30), "referencia");
  assert.equal(f.slugify("O que é o RGPD? (art. 15.º)"), "o-que-e-o-rgpd-art-15-o");
});

test("Malformed articles fail loudly, with the file and the line", () => {
  const cases = [
    ["sem título", "Texto\n<!-- resumo: x -->", /:1: a primeira linha tem de ser o título/],
    ["sem resumo", "# T\n\nTexto", /falta o resumo/],
    ["público inválido", "# T\n<!-- resumo: x -->\n<!-- publico: equipa -->", /publico "equipa" inválido/],
    ["data inválida", "# T\n<!-- resumo: x -->\n<!-- atualizado: 2026-02-30 -->", /data "2026-02-30" inválida/],
    ["metadado desconhecido", "# T\n<!-- resumo: x -->\n<!-- autor: Luis -->", /:3: metadado desconhecido "autor"/],
    ["metadado repetido", "# T\n<!-- resumo: x -->\n<!-- resumo: y -->", /metadado "resumo" repetido/],
    ["âncora repetida", `${HEAD}## Prazos\n\n## Prazos!`, /:6: secção repetida: "#prazos"/],
    ["âncora reservada", `${HEAD}## Conteúdo`, /âncora reservada "#conteudo"/],
    ["perguntas fora do sítio", `${HEAD}Texto\n\n<!-- perguntas: a | b -->`, /:6: <!-- perguntas: … --> tem de ficar logo abaixo de um título/],
    ["metadado no meio do texto", `${HEAD}Texto\n\n<!-- termos: a -->`, /tem de ficar logo a seguir ao título do artigo/],
    ["HTML em bloco", `${HEAD}<div>olá</div>`, /:4: HTML não é suportado/],
    ["HTML no texto", `${HEAD}Olá <b>mundo</b>`, /HTML não é suportado \("<b>"\)/],
    ["imagem", `${HEAD}![logótipo](https://www.lojadoouro.pt/a.png)`, /imagens não são suportadas/],
    ["bloco de código", `${HEAD}\`\`\`\ncódigo\n\`\`\``, /blocos de código não são suportados/],
    ["título ####", `${HEAD}#### Fundo`, /só são suportados títulos ## e ###/],
    ["segundo título #", `${HEAD}# Outro`, /só pode haver um título #/],
    ["ligação javascript:", `${HEAD}[clique](javascript:alert(1))`, /ligação não permitida: "javascript:alert\(1\)"/],
    ["ligação data:", `${HEAD}[clique](data:text/html,<script>alert(1)</script>)`, /ligação não permitida/],
    ["outra página do dashboard", `${HEAD}[configuração](/apoio/configuracao)`, /ligação não permitida: "\/apoio\/configuracao"/],
    ["ligação sem texto", `${HEAD}[](https://www.cnpd.pt)`, /ligação sem texto/],
    ["aviso sem etiqueta", `${HEAD}> Cuidado com isto`, /tem de começar por \*\*Atenção:\*\*/],
    ["aviso com título", `${HEAD}> **Nota:** texto\n> ## Título`, /títulos não podem estar dentro de um aviso/],
    ["tabela sem separador", `${HEAD}| a | b |\n| c | d |`, /tabela sem cabeçalho/],
    ["tabela com colunas a mais", `${HEAD}| a | b |\n| --- | --- |\n| c | d | e |`, /:6: a linha da tabela tem 3 colunas e o cabeçalho 2/],
    ["lista com *", `${HEAD}* item`, /listas: use "- " ou "1. "/],
    ["linha horizontal", `${HEAD}---`, /linhas horizontais/],
    ["lista aninhada misturada", `${HEAD}- a\n  - b\n  1. c`, /não pode misturar/],
  ];
  for (const [name, src, re] of cases) {
    const { doc, errors } = one(src);
    assert.equal(doc, null, name);
    assert.ok(errors.length && errors.every((e) => /^05-exemplo\.md:\d+: /.test(e)), `${name}: ${JSON.stringify(errors)}`);
    assert.ok(errors.some((e) => re.test(e)), `${name}: ${JSON.stringify(errors)}`);
  }
  for (const bad of ["Transferir.md", "5-transferir.md", "05_transferir.md", "05-Transferir.md", "05-transferir.txt"])
    assert.match(f.parseSupportDoc(bad, `${HEAD}Texto`).errors[0], /nome inválido/, bad);
});

test("Across articles: one address per article, internal links only to articles and sections that exist", () => {
  const a = { file: "01-a.md", source: "# A\n<!-- resumo: a -->\n\n## Um\n\nVer [B](/apoio/documentacao/b#dois), [C](/apoio/documentacao/c) e [B](/apoio/documentacao/b#um)." };
  const b = { file: "02-b.md", source: "# B\n<!-- resumo: b -->\n\n## Um" };
  const dup = { file: "03-a.md", source: "# A2\n<!-- resumo: a2 -->" };
  const { docs, errors } = f.parseSupportDocs([dup, b, a]);
  assert.deepEqual(docs.map((d) => d.file), ["01-a.md", "02-b.md"]);
  assert.ok(errors.includes('03-a.md: o endereço "a" já é usado por 01-a.md'), JSON.stringify(errors));
  assert.ok(errors.some((e) => /^01-a\.md:6: a secção "#dois" não existe em 02-b\.md \(secções: #um\)$/.test(e)), JSON.stringify(errors));
  assert.ok(errors.includes("01-a.md:6: ligação para um artigo que não existe: /apoio/documentacao/c"), JSON.stringify(errors));
  assert.equal(errors.length, 3);
  // Uma âncora da própria página ("#secção") também tem de existir.
  assert.match(f.parseSupportDocs([{ file: "04-c.md", source: "# C\n<!-- resumo: c -->\n\n[x](#nada)" }]).errors[0], /secção "#nada" não existe em 04-c\.md/);
});

test("CRLF, BOM and NFD text give the same article as LF", () => {
  const lf = `${HEAD}## Atenção ao prazo\n<!-- perguntas: Qual é o prazo? -->\n\n> **Atenção:** um mês.\n`;
  const crlf = `\uFEFF${lf.normalize("NFD").replace(/\n/g, "\r\n")}`;
  const a = one(lf);
  const b = one(crlf);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.doc, a.doc);
  assert.equal(f.normalizeSource("a  \r\n\tb\r\n"), "a\n  b\n");
});

test("Only http(s), mailto and documentation links are allowed", () => {
  for (const ok of [
    "https://eur-lex.europa.eu/legal-content/PT/TXT/?uri=CELEX:32016R0679",
    "https://diariodarepublica.pt/dr/detalhe/lei/58-2019-123815982",
    "http://www.cnpd.pt",
    "mailto:apoiocliente@lojadoouro.pt",
    "/apoio/documentacao",
    "/apoio/documentacao?q=prazo%20rgpd",
    "/apoio/documentacao/protecao-de-dados",
    "/apoio/documentacao/protecao-de-dados#em-resumo",
  ])
    assert.equal(f.safeHref(ok), ok, ok);
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/x",
    "https:evil.example",
    "/apoio/configuracao",
    "/apoio/documentacao/../configuracao",
    "/apoio/documentacao/a/b",
    "/apoio/documentacao/Maiusculas",
    "apoio/documentacao/x",
    "#secao",
    "mailto:nada",
    'https://x.pt/"onmouseover="alert(1)',
    "",
  ])
    assert.equal(f.safeHref(bad), null, JSON.stringify(bad));
  assert.deepEqual(f.internalTarget("/apoio/documentacao/rgpd#prazos"), { slug: "rgpd", anchor: "prazos" });
  assert.deepEqual(f.internalTarget("/apoio/documentacao?q=x"), { slug: null, anchor: "" });
  assert.equal(f.internalTarget("https://www.cnpd.pt"), null);
});

// ---------------------------------------------------------------------------------------------------- desenho

const Link = (props) => React.createElement("a", { ...props, "data-link": "interno" });
const ctx = (visible = () => true) => ({
  h: React.createElement,
  Link,
  visible,
  headingAction: (id) => React.createElement("button", { "data-copy": id }, "copiar"),
});
const html = (blocks, c = ctx()) => renderToStaticMarkup(React.createElement(React.Fragment, null, ...r.renderBlocks(blocks, c)));

test("Renderer: text is always text (HTML is escaped), never raw HTML", () => {
  const out = html([
    { t: "p", c: [{ t: "text", v: '<img src=x onerror="alert(1)"> & <script>alert(1)</script>' }, { t: "code", v: "<b>negrito</b>" }] },
  ]);
  assert.ok(!/<img|<script|<b>/i.test(out), out);
  assert.ok(out.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;"), out);
  assert.ok(out.includes("<code>&lt;b&gt;negrito&lt;/b&gt;</code>"), out);
  // Mesmo um artigo com HTML no texto (que a geração recusa) só mostraria texto.
  const forced = one(`${HEAD}Olá <script>alert(1)</script> mundo`);
  assert.equal(forced.doc, null);
  for (const file of ["lib/support/docs-render.ts", "components/support/docs-search.tsx", "components/support/docs-client.tsx", "app/(painel)/apoio/documentacao/page.tsx", "app/(painel)/apoio/documentacao/[slug]/page.tsx"])
    assert.ok(!read(file).includes("dangerouslySetInnerHTML"), file);
});

test("Renderer: dangerous links become text; external links open in a new tab with noopener", () => {
  const link = (href, text = "clique") => ({ t: "p", c: [{ t: "link", href, c: [{ t: "text", v: text }] }] });
  for (const href of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,x", "vbscript:x", "/apoio/configuracao", "//evil.example"]) {
    const out = html([link(href)]);
    assert.equal(out, "<p>clique</p>", href);
  }
  const ext = html([link("https://www.cnpd.pt", "CNPD")]);
  assert.match(ext, /^<p><a href="https:\/\/www\.cnpd\.pt" target="_blank" rel="noopener noreferrer" class="docs-ext">CNPD<span class="sr-only"> \(abre noutro separador\)<\/span><\/a><\/p>$/);
  assert.equal(html([link("mailto:apoiocliente@lojadoouro.pt", "email")]), '<p><a href="mailto:apoiocliente@lojadoouro.pt">email</a></p>');
  assert.equal(html([link("/apoio/documentacao/rgpd#prazos", "prazos")]), '<p><a href="/apoio/documentacao/rgpd#prazos" data-link="interno">prazos</a></p>');
  // Artigo que esta pessoa não pode ver (só Super Admin): fica o texto, sem ligação.
  assert.equal(html([link("/apoio/documentacao/configuracao", "configuração")], ctx((slug) => slug !== "configuracao")), "<p>configuração</p>");
  assert.equal(html([link("/apoio/documentacao?q=rgpd", "pesquisa")], ctx(() => false)), '<p><a href="/apoio/documentacao?q=rgpd" data-link="interno">pesquisa</a></p>');
});

test("Renderer: headings keep their anchors, tables scroll, callouts are notes", () => {
  const { doc } = one(`${HEAD}## Prazos\n\n| A | B |\n| --- | :---: |\n| 1 | 2 |\n\n> **Atenção:** um *mês*.\n\n1. um\n  - dois`);
  const out = html(doc.blocks);
  assert.ok(out.includes('<div class="docs-h-row h2"><h2 id="prazos" class="docs-h">Prazos</h2><button data-copy="prazos">copiar</button></div>'), out);
  assert.ok(out.includes('<div class="docs-table" role="region" tabindex="0" aria-label="Tabela: A, B (Prazos)">'), out);
  // Cada tabela tem o seu nome (as colunas e a secção): na lista de zonas do leitor de ecrã não ficam todas iguais.
  const two = one(`${HEAD}## Prazos\n\n| Canal | Prazo |\n| --- | --- |\n| x | y |\n\n## Fornecedores\n\n| Fornecedor | Onde |\n| --- | --- |\n| x | y |`).doc;
  const labels = [...html(two.blocks).matchAll(/aria-label="(Tabela[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Tabela: Canal, Prazo (Prazos)", "Tabela: Fornecedor, Onde (Fornecedores)"]);
  assert.ok(out.includes('<th scope="col" class="align-center">B</th>'), out);
  assert.ok(out.includes('<aside class="docs-callout atencao" role="note" aria-label="Atenção"><p class="docs-callout-label">Atenção</p><p>um <em>mês</em>.</p></aside>'), out);
  assert.ok(out.includes("<ol><li>um<ul><li>dois</li></ul></li></ol>"), out);
});

// ---------------------------------------------------------------------------------------------------- pesquisa

const roots = (w) => s.analyze(w)[0];
const fixtureDocs = () => {
  const { docs, errors } = f.parseSupportDocs(sourcesIn(FIXTURES));
  assert.deepEqual(errors, []);
  return docs;
};
const teamIndex = () => s.buildSearchIndex(s.searchRecords(fixtureDocs().filter((d) => f.docVisible(d, false))));

test("Search language: accents, stopwords, plurals and verb forms of Portuguese", () => {
  assert.deepEqual(s.analyze("Como posso transferir uma conversa?"), s.analyze("transferências conversas"));
  assert.deepEqual(s.analyze("o que posso fazer para quero onde qual é que"), []);
  // "ver" é a intenção da pergunta ("posso ver as conversas das colegas?", "quem vê a nota?"): não é palavra vazia.
  assert.equal(s.analyze("posso ver").length, 1);
  assert.deepEqual(s.analyze("AÇÃO, ação; acao!"), [roots("acao"), roots("acao"), roots("acao")]);
  const same = [
    ["transferir", "transfiro", "transferi", "transferiu", "transferência", "transferências", "transferida", "transfere", "transferem", "transferimos"],
    ["conversa", "conversas", "conversar"],
    ["notificação", "notificações", "notificar", "notifica"],
    ["canal", "canais"],
    ["papel", "papéis"],
    ["mensagem", "mensagens"],
    ["colaborador", "colaboradores", "colaboradora", "colaboradoras"],
    ["automaticamente", "automática", "automático", "automáticas"],
    ["apagar", "apagado", "apague", "apaguei", "apagamento"],
    ["avaliação", "avaliações", "avaliar", "avaliado"],
    ["responsável", "responsáveis"],
    ["resolver", "resolvida", "resolvi", "resolvo"],
    ["lei", "leis"],
    ["email", "emails", "e-mail"],
  ];
  for (const group of same) for (const w of group) assert.equal(roots(w), roots(group[0]), `${w} ~ ${group[0]}`);
  assert.notEqual(roots("livre"), roots("livro"));
  assert.equal(s.editDistance("trasnferir", "transferir"), 1);
  assert.equal(s.editDistance("garantai", "garantia"), 1);
  assert.equal(s.editDistance("reclamaçao", "reclamacao", 2), 1);
  assert.ok(s.editDistance("abcdef", "uvwxyz", 2) > 2);
});

test("Search: section results, highlighted snippets, typos with «Quis dizer», prefix while typing, limits", () => {
  const index = teamIndex();
  const res = s.searchDocs(index, "como transfiro uma conversa?");
  const top = res.hits[0];
  assert.equal(top.href, "/apoio/documentacao/responsavel#transferir-uma-conversa");
  assert.equal(top.title.map((x) => x.text).join(""), "Responsável e transferências");
  assert.deepEqual(top.heading.filter((x) => x.hit).map((x) => x.text), ["Transferir", "conversa"]);
  assert.ok(top.question.some((x) => x.hit && x.text === "transfiro"), JSON.stringify(top.question));
  assert.ok(top.snippet.some((x) => x.hit), JSON.stringify(top.snippet));
  assert.equal(res.suggestion, null);
  // Erro de escrita: encontra na mesma e propõe a correção.
  const typo = s.searchDocs(index, "trasnferir conversa");
  assert.equal(typo.suggestion, "transferir conversa");
  assert.equal(typo.hits[0].anchor, "transferir-uma-conversa");
  // A meio de escrever, a última palavra é o início de outras; com espaço no fim já não.
  assert.equal(s.searchDocs(index, "transf").hits[0].anchor, "transferir-uma-conversa");
  assert.equal(s.searchDocs(index, "transf ").hits.length, 0);
  // Só palavras vazias: nada para procurar (a página mostra a ajuda, não "sem resultados").
  assert.deepEqual(s.searchDocs(index, "como é que posso"), { hits: [], terms: 0, suggestion: null });
  // No máximo 20 resultados e 3 por artigo.
  const many = s.searchDocs(index, "conversa cliente").hits;
  assert.ok(many.length <= 20 && many.length > 3);
  const perArticle = {};
  for (const h of many) perArticle[h.slug] = (perArticle[h.slug] || 0) + 1;
  assert.ok(Object.values(perArticle).every((n) => n <= 3), JSON.stringify(perArticle));
  // Mais de 3 por artigo, se alguém o pedir: os pontos continuam números e por ordem.
  const wide = s.searchDocs(index, "conversa cliente", { perArticle: 400, limit: 400 }).hits;
  assert.ok(wide.length > many.length);
  assert.ok(wide.every((h, i) => Number.isFinite(h.score) && (i === 0 || wide[i - 1].score >= h.score)));
  // Uma pesquisa enorme não pesa.
  assert.ok(Array.isArray(s.searchDocs(index, "conversa ".repeat(500)).hits));
});

test("Search never shows Super Admin articles to the rest of the team", () => {
  const docs = fixtureDocs();
  assert.ok(docs.some((d) => d.publico === "super-admin"));
  const team = s.buildSearchIndex(s.searchRecords(docs.filter((d) => f.docVisible(d, false))));
  const admin = s.buildSearchIndex(s.searchRecords(docs.filter((d) => f.docVisible(d, true))));
  for (const q of ["ligar o gmail", "configuração do apoio", "validar ligações", "sincronização"]) {
    assert.ok(!s.searchDocs(team, q).hits.some((h) => h.slug === "configuracao"), q);
  }
  assert.equal(s.searchDocs(admin, "validar ligações").hits[0].slug, "configuracao");
});

test("Search quality: realistic staff questions find the right section in the top 3", () => {
  const docs = fixtureDocs();
  const team = s.buildSearchIndex(s.searchRecords(docs.filter((d) => f.docVisible(d, false))));
  const admin = s.buildSearchIndex(s.searchRecords(docs));
  const queries = require("./fixtures/support-docs/queries.cjs");
  assert.ok(queries.length >= 40, `${queries.length} perguntas`);
  const misses = [];
  for (const [q, want, opt] of queries) {
    const hits = s.searchDocs(opt?.super ? admin : team, q).hits.slice(0, 3).map((h) => `${h.slug}#${h.anchor}`);
    if (!hits.some((k) => (want.includes("#") ? k === want : k.startsWith(`${want}#`)))) misses.push(`«${q}» → ${want} (veio ${hits.join(", ")})`);
  }
  assert.deepEqual(misses, []);
});

test("Related articles share terms", () => {
  const d = (slug, termos, order) => ({ slug, termos, order });
  const docs = [d("a", ["RGPD", "apagar dados"], 1), d("b", ["eliminar", "proteção de dados"], 2), d("c", ["garantia"], 3), d("e", ["rgpd", "dados pessoais", "apagamento"], 4)];
  assert.deepEqual(s.relatedDocs(docs[0], docs).map((x) => x.slug), ["e", "b"]);
  assert.deepEqual(s.relatedDocs(docs[2], docs), []);
});

// ---------------------------------------------------------------------------------------------------- artigos reais

test("docs/apoio: the generated module is up to date and every article is valid", async () => {
  const lib = await import(pathToFileURL(path.join(root, "scripts", "build-support-docs.mjs")).href);
  const built = await lib.buildSupportDocs();
  assert.deepEqual(built.errors, []);
  assert.equal(await lib.currentModule(), built.text, "lib/support/docs-content.generated.ts desatualizado: corra npm run docs:apoio");
  // O mesmo resultado com o formato compilado para os testes (o script transpila o mesmo ficheiro).
  assert.deepEqual(f.parseSupportDocs(built.sources).docs, built.docs);
  // E o módulo gerado não serve para mais nada que não seja o servidor.
  const docsServer = read("lib/support/docs.ts");
  assert.match(docsServer, /^import "server-only";/);
});

test("docs/apoio: every article is found by its title and most questions find their own section", () => {
  const { docs, errors } = f.parseSupportDocs(sourcesIn(path.join(root, "docs", "apoio")));
  assert.deepEqual(errors, []);
  if (!docs.length) return;
  const admin = s.buildSearchIndex(s.searchRecords(docs));
  const lost = docs.filter((d) => !s.searchDocs(admin, d.title).hits.slice(0, 3).some((h) => h.slug === d.slug)).map((d) => d.title);
  assert.deepEqual(lost, []);
  let total = 0;
  const misses = [];
  for (const d of docs)
    for (const sec of d.sections)
      for (const q of sec.perguntas) {
        total++;
        if (!s.searchDocs(admin, q).hits.slice(0, 3).some((h) => h.slug === d.slug && h.anchor === sec.id)) misses.push(`«${q}» (${d.slug}#${sec.id})`);
      }
  // Perguntas muito gerais ("O que vejo em A minha conta?") podem cair noutra secção que também responde.
  assert.ok(misses.length <= Math.floor(total * 0.1), `${misses.length}/${total} perguntas fora do top 3:\n${misses.join("\n")}`);
});

test("docs/apoio: questions written like the team writes them find the right section in the top 3", () => {
  const { docs, errors } = f.parseSupportDocs(sourcesIn(path.join(root, "docs", "apoio")));
  assert.deepEqual(errors, []);
  if (!docs.length) return;
  const team = s.buildSearchIndex(s.searchRecords(docs.filter((d) => f.docVisible(d, false))));
  const queries = require("./fixtures/support-docs/real-queries.cjs");
  assert.ok(queries.length >= 100, `${queries.length} perguntas`);
  const misses = [];
  for (const [q, want] of queries) {
    const hits = s.searchDocs(team, q).hits.slice(0, 3).map((h) => `${h.slug}#${h.anchor}`);
    if (!hits.some((k) => want.includes(k))) misses.push(`«${q}» → ${want[0]} (veio ${hits.join(", ")})`);
  }
  // Uma secção esperada que mudou de título também conta como falha: atualizar a âncora em real-queries.cjs.
  assert.ok(misses.length <= Math.floor(queries.length * 0.05), `${misses.length}/${queries.length} fora do top 3:\n${misses.join("\n")}`);
});

// ---------------------------------------------------------------------------------------------------- ligações

test("Documentation area: menu, access, Super Admin articles hidden, help links, build and tests", () => {
  const shell = read("components/shell.tsx");
  const group = shell.slice(shell.indexOf('label: "APOIO AO CLIENTE"'), shell.indexOf('label: "LOJAS FÍSICAS"'));
  assert.ok(group.includes('{ key: "apoio-docs", label: "Documentação", href: "/apoio/documentacao", icon: "list" },'));
  assert.ok(group.indexOf("apoio-docs") < group.indexOf("viewer.isSuper"), "para toda a gente do apoio");
  const list = read("app/(painel)/apoio/documentacao/page.tsx");
  const article = read("app/(painel)/apoio/documentacao/[slug]/page.tsx");
  for (const page of [list, article]) {
    assert.ok(page.includes("if (!canSupport(viewer)) redirect("), "mesmo acesso que /apoio");
    assert.ok(page.includes("visibleSupportDocs(viewer.isSuper)"), "só os artigos que a pessoa pode ver");
    assert.ok(page.includes('current="apoio-docs"'));
  }
  assert.ok(list.includes("records={searchRecords(docs)}"), "o índice só leva os artigos visíveis");
  assert.ok(list.includes("suggestions={suggestedSearches(viewer.isSuper)}"), "as pesquisas sugeridas vêm do servidor");
  assert.ok(article.includes("if (at < 0) notFound();"));
  assert.ok(read("components/support/inbox.tsx").includes('<Link href="/apoio/documentacao" className="docs-help-link"'));
  assert.ok(read("app/(painel)/apoio/configuracao/page.tsx").includes('<Link className="docs-help-link" href="/apoio/documentacao"'));
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts.build, /node scripts\/build-support-docs\.mjs && next build$/);
  assert.match(pkg.scripts.test, /^node scripts\/build-support-docs\.mjs --check && tsc /);
  for (const m of ["lib/support/docs-format.ts", "lib/support/docs-search.ts", "lib/support/docs-render.ts"]) assert.ok(pkg.scripts.test.includes(m), m);
  assert.match(read("README.md"), /docs\/apoio/);
});
