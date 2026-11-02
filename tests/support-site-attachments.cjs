const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const site = require("../.test-build/support/site-rules.js");
const rules = require("../.test-build/support/rules.js");

// Anexos da equipa no chat do site: migração, rota do widget, emails e caixa de entrada.
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261102120000_ldo_support_site_attachments.sql";
const SQL = read(MIGRATION);
const HEADER = SQL.slice(0, SQL.indexOf("-- ----"));
// Definição de uma função na migração (do cabeçalho até "$$;").
const fn = (sql, head) => {
  const start = sql.indexOf(head);
  assert.ok(start >= 0, head);
  return sql.slice(start, sql.indexOf("$$;", start) + 3);
};
const body = (def) => def.slice(def.indexOf("$$") + 2, def.lastIndexOf("$$;"));
const before = (def) => def.slice(0, def.indexOf("$$"));
// Corpo de uma função numa migração anterior (com LF).
const source = (file, head) => fn(read(`supabase/migrations/${file}`), head);
const md5 = (t) => crypto.createHash("md5").update(t).digest("hex");
// Linhas do texto de origem que já não estão na cópia (subsequência mais longa comum).
function removedLines(a, b) {
  const x = a.split("\n"), y = b.split("\n");
  const dp = Array.from({ length: x.length + 1 }, () => new Int32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) i++, j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(x[i++]);
    else j++;
  }
  return out.concat(x.slice(i));
}
const BEGIN = "create or replace function public.ldo_support_begin_send(";
const MESSAGES = "create or replace function public.ldo_support_site_messages(";
const CLAIM = "create or replace function public.ldo_support_site_notify_claim(";
const END = "create or replace function public.ldo_support_site_end(";

// ---------------------------------------------------------------- migração

test("Site attachments migration: the copied functions start from the production text (md5 in the header) and only the marked lines change", () => {
  const COPIES = [
    ["20261013100000_ldo_support_post_comments.sql", BEGIN, "c6515c635e40a584dae2eed5ad4a833e", [
      "      if v_platform not in ('zendesk', 'metricool', 'gmail') then",
      "            and (v_platform in ('zendesk', 'gmail') or u.content_type in ('image/jpeg', 'image/png'))) <> cardinality(v_uploads) then",
    ]],
    ["20261030120000_ldo_support_survey.sql", MESSAGES, "e32eaa7e483cd3be4250efc2856973ae", [
      "      'body', m.body, 'created_at', m.created_at, 'inserted_at', m.inserted_at) order by m.created_at, m.inserted_at), '[]'::jsonb),",
    ]],
    ["20261030120000_ldo_support_survey.sql", CLAIM, "e7d97d254175ddd33a35fa81a1c83a7a", [
      "      jsonb_agg(jsonb_build_object('body', r.body, 'author', ldo_private.support_first_name(r.author_user_id)) order by r.inserted_at),",
      "    from (select m.body, m.author_user_id, m.inserted_at from public.ldo_support_messages m",
      "      'locale', v.locale, 'site', v.site, 'country', v.country));",
    ]],
    ["20261015120000_ldo_support_site_locale.sql", END, "b8fd71533cbefbb709b3bc17a3e1de7b", [
      "            'body', m.body, 'at', m.created_at) as item",
      "  return jsonb_build_object('email', v.email, 'name', v.name, 'transcript', v_copy, 'messages', v_items,",
    ]],
  ];
  for (const [file, head, live, removed] of COPIES) {
    const src = source(file, head);
    assert.equal(md5(body(src)), live, `${head}: o texto da migração de origem é o de produção`);
    assert.ok(HEADER.includes(live) && HEADER.includes(file.slice(0, 14)), `${head}: md5 e migração de origem no cabeçalho`);
    const copy = fn(SQL, head);
    // Assinatura e atributos iguais (create or replace mantém os acessos).
    assert.equal(before(copy), before(src), `${head}: assinatura e atributos`);
    assert.deepEqual(removedLines(body(src), body(copy)), removed, head);
  }
  assert.ok(HEADER.includes("Os privilégios mantêm-se (create or replace)."));
  // Só as duas funções novas; nada de tabelas novas nem alterações às tabelas.
  assert.deepEqual([...SQL.matchAll(/^create function ([\w.]+)\(/gm)].map((m) => m[1]), ["ldo_private.site_files", "public.ldo_support_site_attachment"]);
  assert.ok(!/^\s*(create|alter|drop) table/im.test(SQL.replace(/--[^\n]*/g, "")));
});

test("begin_send: the site chat takes images and PDF in replies; notes, the limit of 5 and the empty body stay", () => {
  const begin = fn(SQL, BEGIN);
  assert.ok(begin.includes("      if v_platform not in ('zendesk', 'metricool', 'gmail', 'site') then"));
  assert.ok(begin.includes("and (v_platform in ('zendesk', 'gmail', 'site') or u.content_type in ('image/jpeg', 'image/png'))) <> cardinality(v_uploads) then"));
  assert.ok(begin.includes("      if p_kind = 'note' and v_platform <> 'zendesk' then"), "notas internas sem anexos fora do Zendesk");
  assert.ok(begin.includes("  if cardinality(v_uploads) > 5 then"));
  // "Segue em anexo." só no Zendesk: no chat do site uma resposta só com ficheiros fica sem texto.
  assert.ok(begin.includes("if v_body = '' and cardinality(v_uploads) > 0 and v_platform = 'zendesk' and not v_off then"));
  // Cada anexo continua a ser da própria pessoa, desta conversa, por enviar e com os bytes.
  assert.ok(begin.includes("where u.id = any (v_uploads) and u.user_id = v_me and u.conversation_id = p_id and u.message_id is null and u.data is not null"));
});

test("Files in the site chat functions: positions, names, types and sizes for the visitor; the ids only for the server; never the reference", () => {
  const files = fn(SQL, "create function ldo_private.site_files(");
  // O id só com p_with_ids; 'ref' só é lido, nunca devolvido.
  assert.ok(files.includes("|| case when p_with_ids then jsonb_build_object('id', substr(a.x ->> 'ref', 8)) else '{}'::jsonb end"));
  assert.equal(files.split("'id'").length - 1, 1);
  for (const m of files.matchAll(/'ref'/g)) assert.equal(files.slice(m.index - 4, m.index), "->> ", "'ref' só lido");
  assert.ok(files.includes("jsonb_build_object('i', a.n - 1, 'name', left(coalesce(a.x ->> 'name', ''), 200),\n      'type', a.x ->> 'type', 'size', a.x -> 'size')"));
  assert.ok(files.includes("where a.x ->> 'ref' ~ '^upload:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"));
  assert.ok(files.includes("and a.x ->> 'type' in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf');"));
  assert.ok(files.includes("language sql immutable set search_path = ''"));
  // O que vai para o widget (passado tal e qual pela rota) nunca leva os ids; os emails, sim.
  const messages = fn(SQL, MESSAGES);
  assert.ok(messages.includes("'attachments', case when m.kind = 'outbound' then ldo_private.site_files(m.attachments, false) else '[]'::jsonb end)"));
  assert.ok(!/site_files\([^)]*true\)/.test(messages));
  assert.ok(!messages.includes("'ref'") && !/'attachments', m\.attachments/.test(messages));
  assert.ok(fn(SQL, CLAIM).includes("'files', ldo_private.site_files(r.attachments, true)) order by r.inserted_at),"));
  assert.ok(fn(SQL, CLAIM).includes("'ended', v.ended_at is not null"));
  assert.ok(fn(SQL, END).includes("'files', case when m.kind = 'outbound' then ldo_private.site_files(m.attachments, true) else '[]'::jsonb end) as item"));
  assert.ok(fn(SQL, END).includes("'conversation', v.conversation_id,"));
});

test("site_attachment: only a delivered team reply of the visitor's own conversation, with the file still stored", () => {
  const one = fn(SQL, "create function public.ldo_support_site_attachment(p_token text, p_token_hash text, p_identity_email text, p_message uuid, p_index integer)");
  for (const s of [
    "language plpgsql stable security definer set search_path = ''",
    "perform ldo_private.bi_check(p_token);",
    "v := ldo_private.site_visitor(p_token_hash, p_identity_email);",
    "if p_message is null or p_index is null or p_index not between 0 and 4 then",
    "where m.id = p_message and m.conversation_id = v.conversation_id and m.kind = 'outbound' and m.deleted_at is null",
    "and m.delivery in ('accepted', 'delivered', 'read');",
    "v_ref !~ '^upload:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'",
    "where u.id = substr(v_ref, 8)::uuid and u.conversation_id = v.conversation_id and u.message_id = p_message",
    "and u.data is not null);",
    // Só o ficheiro: nunca ids, a pessoa que o enviou nem a referência.
    "jsonb_build_object('name', u.name, 'type', u.content_type, 'size', u.size, 'data', encode(u.data, 'base64'))",
  ]) assert.ok(one.includes(s), s);
  // Cada erro tem o seu código para o widget (tests/support-site.cjs lê todas as funções do chat).
  assert.deepEqual([...one.matchAll(/raise exception '([^']+)'/g)].map((x) => x[1]), ["Pedido inválido."]);
  assert.equal(site.errorCode("Pedido inválido."), "invalid_request");
});

test("Site attachments migration: the new function only for the server (anon with the server token); the helper for nobody", () => {
  const stmts = SQL.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").split(";").map((s) => s.trim());
  assert.ok(stmts.includes("revoke all on function public.ldo_support_site_attachment(text, text, text, uuid, integer) from public, authenticated"));
  assert.ok(stmts.includes("grant execute on function public.ldo_support_site_attachment(text, text, text, uuid, integer) to anon"));
  assert.ok(stmts.includes("revoke all on function ldo_private.site_files(jsonb, boolean) from public, anon, authenticated"));
  assert.ok(!stmts.some((s) => /^grant .*site_files/.test(s)));
  // As funções copiadas mantêm os privilégios (sem revoke/grant novos).
  assert.ok(!stmts.some((s) => /^(revoke|grant) .*(begin_send|site_messages|notify_claim|site_end)/.test(s)));
});

// ---------------------------------------------------------------- regras

test("Site chat rules: the unavailable file has its own code; files for an email follow the order and the cap, and skip what does not fit", () => {
  assert.equal(site.errorCode("Este ficheiro já não está disponível."), "attachment_unavailable");
  assert.ok(site.CHAT_ERROR_CODES.includes("attachment_unavailable"));
  assert.deepEqual(site.SITE_FILE_TYPES, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  assert.equal(site.EMAIL_FILES_MAX_BYTES, 7 * 1024 * 1024);
  const MB = 1024 * 1024;
  const plan = (files, max = site.EMAIL_FILES_MAX_BYTES) => [...site.planEmailFiles(files, max)];
  assert.deepEqual(plan([{ id: "a", size: 3 * MB }, { id: "b", size: 3 * MB }, { id: "c", size: 2 * MB }, { id: "d", size: MB }]), ["a", "b", "d"],
    "c não cabe; d, mais pequeno, ainda cabe");
  assert.deepEqual(plan([{ id: "a", size: 7 * MB }]), ["a"], "exatamente o máximo");
  assert.deepEqual(plan([{ id: "a", size: 7 * MB + 1 }, { id: "b", size: 10 }]), ["b"]);
  assert.deepEqual(plan([{ id: "a", size: MB }, { id: "a", size: MB }, { id: "b", size: 6 * MB }]), ["a", "b"], "um id repetido conta uma vez");
  assert.deepEqual(plan([{ id: "a", size: 2 * MB }, { id: "b", size: 2 * MB }], 3 * MB), ["a"]);
  assert.deepEqual(plan([]), []);
  assert.deepEqual(plan([{ id: "a", size: 0 }, { id: "b", size: Number.NaN }]), []);
});

test("asciiName keeps the Content-Disposition safe (no quotes or line breaks)", () => {
  assert.equal(rules.asciiName('certificado "1"\r\n.pdf'), "certificado _1_.pdf");
  assert.equal(rules.asciiName(""), "anexo");
  assert.equal(rules.asciiName("x".repeat(300)).length, 120);
  assert.match(rules.asciiName("Fatura nº 12 — ouro.pdf"), /^[\w.\- ]+$/);
  // A rota dos anexos do dashboard usa a mesma função (sem cópia própria).
  const dash = read("app/api/support/attachments/route.ts");
  assert.ok(dash.includes("import { asciiName, isUuid, previewKind, sniffType } from \"@/lib/support/rules\";"));
  assert.ok(!dash.includes("function asciiName("));
});

// ---------------------------------------------------------------- servidor

test("Visitor route: token in the header, the conversation checked in the DB, real type, isolated and never cached", () => {
  const route = read("app/api/chat/attachments/route.ts");
  for (const s of [
    "export const dynamic = \"force-dynamic\";", "export const maxDuration = 30;",
    "export function OPTIONS(request: Request) {\n  return preflight(request);", "return chatHandle(request, async () => {",
    "checkOrigin(request);", "const tokenHash = visitorTokenHash(request);", "p_identity_email: identityEmail(request)",
    "!isUuid(message) || !/^[0-4]$/.test(index)", "\"ldo_support_site_attachment\"",
    "const real = bytes ? sniffType(bytes) : null;", "!SITE_FILE_TYPES.includes(real) || bytes.byteLength > MAX_BYTES",
    "throw new ChatError(404, \"Este ficheiro já não está disponível.\");",
    "...corsHeaders(request),", "\"Content-Type\": real,", "\"X-Content-Type-Options\": \"nosniff\"",
    "\"Content-Security-Policy\": \"default-src 'none'; sandbox\"", "\"Referrer-Policy\": \"no-referrer\"",
    "${real === \"application/pdf\" ? \"attachment\" : \"inline\"}; filename=\"${asciiName(name)}\"",
  ]) assert.ok(route.includes(s), s);
  // O widget lê-o de outro site: nada de CORP same-origin. Number(null) seria 0: a posição é validada como texto.
  assert.ok(!route.includes("Cross-Origin-Resource-Policy"));
  assert.ok(!route.includes("Number(q.get(\"i\"))"));
  // O token nunca vem no endereço.
  assert.ok(!/searchParams\.get\("(t|token|tok)"\)|q\.get\("(t|token|tok)"\)/.test(route));
  // Sem cache: corsHeaders põe no-store em todas as respostas do chat.
  assert.ok(read("lib/support/site-chat.ts").includes("\"Cache-Control\": \"no-store\","));
  // /api/chat/* é público (sem sessão do dashboard).
  assert.ok(read("proxy.ts").includes("/api/chat/"));
});

test("Emails with the team files: real attachments through Resend, up to 7 MB, only files of the conversation; nothing reaches the widget", () => {
  const email = read("lib/email.ts");
  assert.ok(email.includes("attachments?: { filename: string; content: string }[]"));
  assert.ok(email.includes("...(opts.attachments?.length ? { attachments: opts.attachments } : {}),"));
  const chat = read("lib/support/site-chat.ts");
  assert.ok(chat.includes("if (!u || u.conversation_id !== conversation || !SITE_FILE_TYPES.includes(u.type)) continue;"));
  assert.ok(chat.includes("const plan = planEmailFiles(files, maxBytes);"));
  assert.equal(chat.split("attachments: f.attachments, timeoutMs: f.attachments.length ? 30000 : 8000,").length - 1, 2, "aviso e cópia");
  assert.ok(chat.includes("loadEmailFiles(p.conversation, all, EMAIL_FILES_MAX_BYTES, p.ended ? \"missing\" : \"chat\")"));
  assert.ok(chat.includes("loadEmailFiles(t.conversation, all, EMAIL_FILES_MAX_BYTES, \"missing\")"));
  // A passagem pelos avisos tem um orçamento de ficheiros; o primeiro visitante segue sempre.
  assert.ok(chat.includes("if (!first && bytes > budget) break;"));
  assert.ok(chat.includes("fileBudget: 3 * EMAIL_FILES_MAX_BYTES"));
  // O widget só recebe ok, emailed e email ao terminar.
  assert.ok(read("app/api/chat/end/route.ts").includes("return chatJson(request, { ok: true, emailed: Boolean(sent?.ok), email: sent?.ok ? t.email : null });"));
  for (const route of ["app/api/chat/end/route.ts", "app/api/support/conversations/route.ts"])
    assert.ok(read(route).includes("export const maxDuration = 60;"), route);
});

// ---------------------------------------------------------------- caixa de entrada

test("Inbox: 📎 in site chat replies (up to 5, PDF too), never in its notes; no product photo next to the card", () => {
  const inbox = read("components/support/inbox.tsx");
  assert.ok(inbox.includes("const isSiteChat = c?.conversation.platform === \"site\";"));
  assert.ok(inbox.includes("const maxAttachments = !c || isComment ? 0 : zendeskLive || ((isGmail || isSiteChat) && mode === \"reply\") ? 5 :"));
  assert.ok(inbox.includes(": isSiteChat ? (mode === \"reply\" ? \"Até 5 imagens ou PDF: o cliente vê-os no chat (30 dias)"));
  assert.ok(inbox.includes("!zendeskLive && !isGmail && !isSiteChat) throw new Error(\"PDF só no email, no chat do site e nos tickets Zendesk.\");"));
  assert.ok(inbox.includes("accept={isZendesk || isGmail || isSiteChat ? \"image/jpeg,image/png,image/webp,image/heic,application/pdf\""));
  assert.ok(inbox.includes("<CatalogPicker canAttach={!isSiteChat && maxAttachments > pendingHere.length}"));
  const insert = inbox.slice(inbox.indexOf("async function insertCatalog("), inbox.indexOf("// Responsável: só ele responde"));
  assert.ok(insert.includes("if (withImage && !isSiteChat && item.photo && maxAttachments > (pending[slot] || []).length"));
  assert.ok(!inbox.includes("ainda não aceita anexos"));
});
