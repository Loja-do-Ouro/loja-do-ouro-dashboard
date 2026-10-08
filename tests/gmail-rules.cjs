const { test } = require("node:test");
const assert = require("node:assert/strict");
const g = require("../.test-build/support/gmail-rules.js");

const b64u = (s, enc = "utf8") => Buffer.from(s, enc).toString("base64url");
const h = (name, value) => ({ name, value });
const textPart = (partId, mimeType, text, charset = "UTF-8", extra = {}) => ({
  partId, mimeType, filename: "",
  headers: [h("Content-Type", `${mimeType}; charset="${charset}"`)],
  body: { size: Buffer.byteLength(text), data: b64u(text, /8859-1|latin1|1252/i.test(charset) ? "latin1" : "utf8") },
  ...extra,
});
const msg = (headers, labelIds = ["INBOX", "UNREAD"]) => ({ id: "m1", threadId: "t1", labelIds, payload: { partId: "", mimeType: "text/plain", headers, body: { size: 0 } } });
const customer = (extra = []) => msg([h("From", "Ana Silva <ana@cliente.pt>"), h("To", "apoio@lojadoouro.pt"), h("Subject", "Encomenda"), ...extra]);
const opts = { mailbox: "apoio@lojadoouro.pt", ownDomains: ["lojadoouro.pt"] };

test("Headers are read case-insensitively, first match only, on the part itself", () => {
  const part = { headers: [h("Subject", "Primeiro"), h("subject", "Segundo"), h("X-Vazio", "")], parts: [{ headers: [h("From", "x@y.pt")] }] };
  assert.equal(g.header(part, "SUBJECT"), "Primeiro");
  assert.equal(g.header(part, "x-vazio"), "");
  assert.equal(g.header(part, "From"), null);
  assert.equal(g.header(undefined, "From"), null);
  assert.equal(g.header({}, "From"), null);
});

test("RFC 2047 encoded-words are decoded (B and Q, UTF-8 / latin1 / windows-1252), plain text untouched", () => {
  const b = Buffer.from("Encomenda nº 1234 – não chegou").toString("base64");
  assert.equal(g.decodeWords(`=?UTF-8?B?${b}?=`), "Encomenda nº 1234 – não chegou");
  assert.equal(g.decodeWords("=?ISO-8859-1?Q?Jo=E3o_Gon=E7alves?="), "João Gonçalves");
  assert.equal(g.decodeWords("=?windows-1252?q?Pre=E7o_=80_50?="), "Preço € 50");
  assert.equal(g.decodeWords("=?utf-8?b?w6k=?="), "é");
  // Palavras seguidas: o espaço entre elas não conta; texto à volta fica.
  assert.equal(g.decodeWords("=?UTF-8?Q?Ol=C3=A1?= =?UTF-8?Q?_mundo?="), "Olá mundo");
  assert.equal(g.decodeWords("=?UTF-8?Q?Ol=C3=A1?=\r\n =?ISO-8859-1?Q?_Jos=E9?="), "Olá José");
  assert.equal(g.decodeWords("Re: =?UTF-8?Q?devolu=C3=A7=C3=A3o?= do anel"), "Re: devolução do anel");
  // Carácter partido entre duas palavras (não devia acontecer, mas acontece).
  assert.equal(g.decodeWords("=?UTF-8?Q?n=C3?= =?UTF-8?Q?=A3o?="), "não");
  // Charset desconhecido: UTF-8. Língua da RFC 2231 ("UTF-8*pt") ignorada.
  assert.equal(g.decodeWords("=?x-desconhecido?Q?caf=C3=A9?="), "café");
  assert.equal(g.decodeWords("=?UTF-8*pt?Q?caf=C3=A9?="), "café");
  // Texto simples (mesmo com "=?") não muda.
  assert.equal(g.decodeWords("Olá =? isto não é codificado ?="), "Olá =? isto não é codificado ?=");
  assert.equal(g.decodeWords("Encomenda 1234"), "Encomenda 1234");
  // Quebras de linha codificadas não chegam ao resultado.
  const evil = g.decodeWords("=?UTF-8?Q?Ana=0D=0ABcc:_x@y.pt?=");
  assert.ok(!/[\r\n]/.test(evil));
  assert.equal(evil, "Ana Bcc: x@y.pt");
});

test("Single addresses are parsed in every usual form; emails lowercased and validated", () => {
  assert.deepEqual(g.parseAddress('"Ana Silva" <Ana@X.pt>'), { name: "Ana Silva", email: "ana@x.pt" });
  assert.deepEqual(g.parseAddress("Ana Silva <ana@x.pt>"), { name: "Ana Silva", email: "ana@x.pt" });
  assert.deepEqual(g.parseAddress("ana@x.pt"), { name: null, email: "ana@x.pt" });
  assert.deepEqual(g.parseAddress("<ana@x.pt>"), { name: null, email: "ana@x.pt" });
  assert.deepEqual(g.parseAddress("  ANA@X.PT (Ana Silva) "), { name: "Ana Silva", email: "ana@x.pt" });
  assert.deepEqual(g.parseAddress('"Silva, Ana \\"Nita\\"" <ana@x.pt>'), { name: 'Silva, Ana "Nita"', email: "ana@x.pt" });
  assert.deepEqual(g.parseAddress("'Rui Costa' <rui@x.pt>"), { name: "Rui Costa", email: "rui@x.pt" });
  assert.deepEqual(g.parseAddress("=?UTF-8?Q?Jo=C3=A3o_Gon=C3=A7alves?= <joao@x.pt>"), { name: "João Gonçalves", email: "joao@x.pt" });
  assert.deepEqual(g.parseAddress('"=?ISO-8859-1?Q?Jos=E9?=" <jose@x.pt>'), { name: "José", email: "jose@x.pt" });
  // Nome igual ao email não é nome.
  assert.deepEqual(g.parseAddress('"ana@x.pt" <ana@x.pt>'), { name: null, email: "ana@x.pt" });
  // Inválidos ou vazios.
  assert.deepEqual(g.parseAddress("Ana <não é email>"), { name: "Ana", email: null });
  assert.deepEqual(g.parseAddress("ana@x"), { name: null, email: null });
  assert.deepEqual(g.parseAddress("ana..silva@x.pt"), { name: null, email: null });
  assert.deepEqual(g.parseAddress("undisclosed-recipients:;"), { name: null, email: null });
  assert.deepEqual(g.parseAddress(""), { name: null, email: null });
  assert.deepEqual(g.parseAddress(null), { name: null, email: null });
  assert.equal(g.validEmail("a.b+loja@sub.exemplo.com.pt"), true);
  assert.equal(g.validEmail("a@xn--exmplo-cua.pt"), true);
  assert.equal(g.validEmail("a b@x.pt"), false);
});

test("Address lists split on commas outside quotes, angle brackets and comments", () => {
  assert.deepEqual(g.parseAddressList('"Silva, Ana" <ana@x.pt>, Rui <RUI@y.pt>,carla@z.pt; (Equipa, loja) <loja@w.pt>'), [
    { name: "Silva, Ana", email: "ana@x.pt" },
    { name: "Rui", email: "rui@y.pt" },
    { name: null, email: "carla@z.pt" },
    { name: "Equipa, loja", email: "loja@w.pt" },
  ]);
  assert.deepEqual(g.parseAddressList('"a, \\"b\\"" <a@x.pt>'), [{ name: 'a, "b"', email: "a@x.pt" }]);
  assert.deepEqual(g.parseAddressList("Equipa: a@x.pt, b@x.pt;"), [{ name: null, email: "a@x.pt" }, { name: null, email: "b@x.pt" }]);
  assert.deepEqual(g.parseAddressList("undisclosed-recipients:;"), []);
  assert.deepEqual(g.parseAddressList("lixo, , <>"), []);
  assert.deepEqual(g.parseAddressList(null), []);
});

test("Gmail bodies are base64url; charsets come from Content-Type, unknown ones read as UTF-8", () => {
  assert.deepEqual([...g.base64UrlDecode("-__-")], [0xfb, 0xff, 0xfe]);
  assert.equal(g.base64UrlDecode(b64u("Olá")).toString("utf8"), "Olá");
  assert.equal(g.base64UrlDecode(Buffer.from("Olá!").toString("base64")).toString("utf8"), "Olá!"); // com padding
  assert.equal(g.decodeBody(b64u("Não recebi a encomenda", "latin1"), "iso-8859-1"), "Não recebi a encomenda");
  assert.equal(g.decodeBody(b64u("Preço €", "utf8"), null), "Preço €");
  assert.equal(g.decodeBody(b64u("café"), "x-inexistente"), "café");
  assert.equal(g.decodeBody(undefined, "utf-8"), "");
  assert.equal(g.charsetOf({ headers: [h("Content-Type", 'text/plain; charset="ISO-8859-1"; format=flowed')] }), "iso-8859-1");
  assert.equal(g.charsetOf({ headers: [h("content-type", "text/html;charset=windows-1252")] }), "windows-1252");
  assert.equal(g.charsetOf({ headers: [h("Content-Type", "text/plain")] }), null);
  assert.equal(g.charsetOf(undefined), null);
});

test("Plain text bodies: latin1 accents, CRLF, quoted history and blank lines are handled", () => {
  const body = "Bom dia,\r\n\r\nNão recebi a encomenda nº 1234.   \r\n\r\n\r\n\r\n\r\nObrigado,\r\nJoão\r\n\r\nEm qua., 7/10/2026 às 10:12, Loja do Ouro <apoio@lojadoouro.pt> escreveu:\r\n> Olá João,\r\n> a sua encomenda foi enviada.\r\n";
  const payload = textPart("", "text/plain", body, "ISO-8859-1");
  assert.equal(g.messageText(payload), "Bom dia,\n\nNão recebi a encomenda nº 1234.\n\n\nObrigado,\nJoão");
  assert.equal(g.messageText(undefined), "");
  assert.equal(g.messageText({ partId: "", mimeType: "multipart/mixed", parts: [] }), "");
});

test("Nested multiparts with an HTML-only body: the reply without Gmail's quote, never the attachment text", () => {
  const html = `<html><head><title>Lixo</title><style>p{color:red}</style></head><body><div dir="ltr">Bom dia,<div><br></div><div>A minha encomenda <b>#1234</b> ainda não chegou. Podem ver em <a href="https://www.lojadoouro.pt/account">a minha conta</a>?</div><div><br></div><div>Obrigada,<br>Ana</div></div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">Em qua., 7/10/2026 às 10:12, Loja do Ouro &lt;<a href="mailto:apoio@lojadoouro.pt">apoio@lojadoouro.pt</a>&gt; escreveu:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex"><div>Olá Ana,<div>histórico antigo</div><div class="gmail_quote">mais antigo</div></div></blockquote></div></body></html>`;
  const payload = {
    partId: "", mimeType: "multipart/mixed", headers: [h("Content-Type", 'multipart/mixed; boundary="x"')], body: { size: 0 },
    parts: [
      { partId: "0", mimeType: "text/plain", filename: "notas.txt", headers: [h("Content-Type", "text/plain"), h("Content-Disposition", 'attachment; filename="notas.txt"')], body: { size: 14, data: b64u("texto do anexo") } },
      { partId: "1", mimeType: "text/plain", filename: "", headers: [h("Content-Disposition", "attachment")], body: { size: 5, data: b64u("outro") } },
      {
        partId: "2", mimeType: "multipart/related", body: { size: 0 },
        parts: [
          { partId: "2.0", mimeType: "multipart/alternative", body: { size: 0 }, parts: [textPart("2.0.0", "text/html", html)] },
          { partId: "2.1", mimeType: "image/png", filename: "image001.png", headers: [h("Content-ID", "<ii_1>"), h("Content-Disposition", 'inline; filename="image001.png"')], body: { size: 2048, attachmentId: "ANGjdJ_1" } },
        ],
      },
    ],
  };
  const text = g.messageText(payload);
  assert.equal(text, "Bom dia,\n\nA minha encomenda #1234 ainda não chegou. Podem ver em a minha conta (https://www.lojadoouro.pt/account)?\n\nObrigada,\nAna");
  for (const bad of ["histórico", "antigo", "escreveu", "Lixo", "color", "anexo", "outro"]) assert.ok(!text.includes(bad), bad);
});

test("An empty text/plain alternative falls back to the HTML; the text/plain wins when it has content", () => {
  const alt = (plain) => ({ partId: "", mimeType: "multipart/alternative", parts: [textPart("0", "text/plain", plain), textPart("1", "text/html", "<p>Olá <b>mundo</b></p><p>Linha&nbsp;2 &amp; mais</p>")] });
  assert.equal(g.messageText(alt("  \r\n")), "Olá mundo\nLinha 2 & mais");
  assert.equal(g.messageText(alt("Texto simples")), "Texto simples");
});

test("Outlook HTML: everything from div#appendonsend / divRplyFwdMsg on is history", () => {
  const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]--></head><body><div class="elementToProof" style="font-family:Aptos">Boa tarde,<br>Quero trocar o anel pelo tamanho 14, não serve.</div><div class="elementToProof">Cumprimentos,<br>Rui</div><div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri"><b>De:</b> Loja do Ouro &lt;apoio@lojadoouro.pt&gt;<br><b>Enviado:</b> 7 de outubro de 2026 10:12<br><b>Assunto:</b> RE: Troca</font></div><div>Olá Rui, histórico</div></body></html>`;
  const text = g.messageText(textPart("", "text/html", html, "iso-8859-1"));
  assert.equal(text, "Boa tarde,\nQuero trocar o anel pelo tamanho 14, não serve.\nCumprimentos,\nRui");
  const noAppend = html.replace('<div id="appendonsend"></div>', "");
  assert.equal(g.messageText(textPart("", "text/html", noAppend, "iso-8859-1")), text);
});

test("Apple Mail / Thunderbird blockquotes (nested) are removed; Gmail forwards are kept", () => {
  const apple = `<html><body><div>Sim, pode ser na loja de Braga.</div><div><br><blockquote type="cite"><div>A 7 out 2026, às 10:12, Loja do Ouro &lt;apoio@lojadoouro.pt&gt; escreveu:</div><br><div><blockquote type="cite">antigo</blockquote> mais antigo</div></blockquote></div></body></html>`;
  assert.equal(g.messageText(textPart("", "text/html", apple)), "Sim, pode ser na loja de Braga.");
  const tb = `<p>Obrigado!</p><div class="moz-cite-prefix">On 07/10/2026 10:12, Loja wrote:<br></div><blockquote type="cite">antigo</blockquote>`;
  assert.equal(g.messageText(textPart("", "text/html", tb)), "Obrigado!");
  const fwd = `<div dir="ltr">Vejam abaixo.<br><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong>CTT</strong> &lt;<a href="mailto:info@ctt.pt">info@ctt.pt</a>&gt;<br>Date: ter., 6/10/2026<br>Subject: Envio RR123PT<br></div><br>O seu envio RR123PT está em distribuição.</div></div>`;
  const text = g.messageText(textPart("", "text/html", fwd));
  assert.ok(text.startsWith("Vejam abaixo."));
  assert.ok(text.includes("From: CTT <info@ctt.pt>"));
  assert.ok(text.includes("O seu envio RR123PT está em distribuição."));
  // Só citação: devolve o texto todo em vez de nada.
  const onlyQuote = `<div class="gmail_quote">Em 7/10/2026, Loja escreveu:<blockquote>texto citado</blockquote></div>`;
  assert.equal(g.messageText(textPart("", "text/html", onlyQuote)), "Em 7/10/2026, Loja escreveu:\ntexto citado");
});

test("An attached email (message/rfc822) is not the body, unless there is nothing else", () => {
  const inner = { partId: "1", mimeType: "message/rfc822", filename: "Envio.eml", headers: [h("Content-Disposition", 'attachment; filename="Envio.eml"')], body: { size: 900, attachmentId: "ANG_eml" }, parts: [textPart("1.0", "text/plain", "Conteúdo do email anexado")] };
  inner.parts[0].filename = "";
  const withBody = { partId: "", mimeType: "multipart/mixed", parts: [textPart("0", "text/html", "<p>Segue o email da transportadora.</p>"), inner] };
  assert.equal(g.messageText(withBody), "Segue o email da transportadora.");
  const onlyAttached = { partId: "", mimeType: "multipart/mixed", parts: [{ ...inner, filename: "", headers: [] }] };
  assert.equal(g.messageText(onlyAttached), "Conteúdo do email anexado");
});

test("Malformed or hostile HTML and long inputs are processed quickly", () => {
  const html = (s) => textPart("", "text/html", s);
  const cases = [
    html("<!--".repeat(50000) + "fim"),
    html("<head>".repeat(50000) + "fim"),
    html("<script>".repeat(30000) + "fim"),
    html('<a href="https://x.pt">'.repeat(30000) + "fim"),
    html("<a href='x' ".repeat(30000) + ">fim"),
    html("<".repeat(300000) + "fim"),
    html("<blockquote ".repeat(50000) + "fim"),
    html("<p>Olá</p>" + "<blockquote>x</blockquote>".repeat(50000)),
    html('<div class="gmail_quote">Forwarded message '.repeat(5000)),
    textPart("", "text/plain", " ".repeat(300000) + "x\n" + "On x 1 wrote\n".repeat(50000)),
  ];
  const t = Date.now();
  for (const p of cases) g.messageText(p);
  g.parseAddressList(" ".repeat(100000) + "x");
  g.parseAddress("a@".repeat(50000));
  g.safeFileName(".".repeat(100000) + "x");
  g.textToHtml("https://x.pt" + ")".repeat(100000));
  assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
  // HTML enorme é cortado sem deixar meia etiqueta; o texto continua certo em HTML estragado.
  assert.equal(g.messageText(html("<p>Olá</p>" + "<blockquote>x</blockquote>".repeat(50000))), "Olá");
  assert.equal(g.messageText(html("<head><title>t</title>Olá <b>Ana</b> 1 < 2 <a href='https://x.pt'>site</a> <a>solta")), "Olá Ana 1 < 2 site (https://x.pt) solta");
  assert.equal(g.messageText(html("<html><head><meta charset=utf-8><body><p>Sem fecho do head</p>")), "Sem fecho do head");
});

test("The message text is capped at 60000 characters and blank-line runs are limited", () => {
  assert.equal(g.messageText(textPart("", "text/plain", "a".repeat(70000))).length, g.MAX_MESSAGE_TEXT);
  assert.equal(g.MAX_MESSAGE_TEXT, 60000);
  assert.equal(g.messageText(textPart("", "text/plain", "a  \r\n\r\n\r\n\r\n\r\n\r\nb\r\n")), "a\n\n\nb");
});

test("Reply history is cut in pt / en / fr / es, Outlook blocks and trailing quotes", () => {
  assert.equal(g.stripQuoted("Obrigado!\n\nOn Wed, Oct 7, 2026 at 10:12 AM Loja do Ouro <apoio@lojadoouro.pt> wrote:\n> Olá\n> antigo"), "Obrigado!");
  // Cabeçalho da citação partido em duas linhas.
  assert.equal(g.stripQuoted("Bom dia,\nJá recebi.\n\nEm qua., 7/10/2026 às 10:12, Loja do Ouro <\napoio@lojadoouro.pt> escreveu:\n> texto"), "Bom dia,\nJá recebi.");
  assert.equal(g.stripQuoted("Ok\r\n\r\nOn Wed, Oct 7, 2026 at 10:12 AM Loja do Ouro <\r\napoio@lojadoouro.pt> wrote:\r\n\r\n> texto"), "Ok");
  assert.equal(g.stripQuoted("Sim.\n\nA 7/10/2026, à(s) 10:12, Loja do Ouro <apoio@lojadoouro.pt> escreveu:\n\n> antigo"), "Sim.");
  assert.equal(g.stripQuoted("Merci\n\nLe mer. 7 oct. 2026 à 10:12, Loja <a@b.pt> a écrit :\n> x"), "Merci");
  assert.equal(g.stripQuoted("Gracias\n\nEl mié, 7 oct 2026 a las 10:12, Loja (<a@b.pt>) escribió:\n> x"), "Gracias");
  assert.equal(g.stripQuoted("Ok\n\n-----Original Message-----\nFrom: Loja\nantigo"), "Ok");
  assert.equal(g.stripQuoted("Ok\n\n-----Mensagem original-----\nDe: Loja\nantigo"), "Ok");
  const outlookPt = "Obrigada\n\nDe: Loja do Ouro <apoio@lojadoouro.pt>\nEnviado: quarta-feira, 7 de outubro de 2026 10:12\nPara: Ana\nAssunto: RE: Troca\n\nhistórico";
  assert.equal(g.stripQuoted(outlookPt), "Obrigada");
  assert.equal(g.stripQuoted("Obrigada\n\n*From:* Loja <a@b.pt>\n*Sent:* Wednesday\n*To:* Ana\n\nhistórico"), "Obrigada");
  assert.equal(g.stripQuoted("Ok, obrigado\n\n________________________________\nFrom: Loja do Ouro\nSent: Wednesday, October 7, 2026 10:12 AM\nantigo"), "Ok, obrigado");
  assert.equal(g.stripQuoted("Ok\n__________\n\nDe: Loja\nhistórico"), "Ok");
  // Citação final com "> " (e o "Ana escreveu:" sem data que a anuncia).
  assert.equal(g.stripQuoted("Sim, pode ser.\n\n> Quer trocar?\n>\n> Obrigado\n\n"), "Sim, pode ser.");
  assert.equal(g.stripQuoted("Sim.\n\nLoja do Ouro escreveu:\n> Quer trocar?"), "Sim.");
});

test("Quote stripping never empties a message and leaves ordinary text alone", () => {
  // Respostas intercaladas: as citações do meio ficam.
  assert.equal(g.stripQuoted("> pergunta 1\nresposta 1\n> pergunta 2\nresposta 2"), "> pergunta 1\nresposta 1\n> pergunta 2\nresposta 2");
  // Só citação, ou corte na primeira linha: devolve o original.
  assert.equal(g.stripQuoted("  > só citação\n> mais\n"), "> só citação\n> mais");
  assert.equal(g.stripQuoted("On Wed, Oct 7, 2026 Loja <a@b.pt> wrote:\n> x"), "On Wed, Oct 7, 2026 Loja <a@b.pt> wrote:\n> x");
  // Frases parecidas que não são cabeçalhos de citação.
  assert.equal(g.stripQuoted("Em 2025 comprei um anel.\nDe: Ana\nPara: o meu marido"), "Em 2025 comprei um anel.\nDe: Ana\nPara: o meu marido");
  assert.equal(g.stripQuoted("On Monday I will go to the store."), "On Monday I will go to the store.");
  // Reencaminhamentos não são histórico.
  const fwd = "Ver abaixo.\n\n---------- Forwarded message ---------\nFrom: CTT <info@ctt.pt>\nDate: ter., 6/10/2026\nSubject: Envio\n\nO seu envio está em distribuição.";
  assert.equal(g.stripQuoted(fwd), fwd);
  const fwdPt = "Ver abaixo.\n\n---------- Mensagem encaminhada ---------\nDe: CTT <info@ctt.pt>\nData: ter., 6/10/2026\n\nO seu envio.";
  assert.equal(g.stripQuoted(fwdPt), fwdPt);
  assert.equal(g.stripQuoted(""), "");
});

test("Attachments and inline images are listed with stable refs and safe names", () => {
  const payload = {
    partId: "", mimeType: "multipart/mixed", body: { size: 0 },
    parts: [
      { partId: "0", mimeType: "multipart/related", body: { size: 0 }, parts: [
        textPart("0.0", "text/html", "<p>Olá</p>"),
        { partId: "0.1", mimeType: "image/png", filename: "image001.png", headers: [h("Content-ID", "<ii_1>"), h("Content-Disposition", 'inline; filename="image001.png"')], body: { size: 2048, attachmentId: "A1" } },
        { partId: "0.2", mimeType: "image/jpeg", filename: "", headers: [h("Content-ID", "<logo>")], body: { size: 512, attachmentId: "A2" } },
      ] },
      { partId: "1", mimeType: "application/pdf", filename: "../../Fatura nº 12.pdf", headers: [h("Content-Disposition", "attachment")], body: { size: 51234, attachmentId: "A3" } },
      { partId: "2", mimeType: "image/jpeg", filename: "C:\\Users\\Ana\\foto anel.jpg", headers: [h("Content-ID", "<f1>"), h("Content-Disposition", "attachment")], body: { size: 900000, attachmentId: "A4" } },
      { partId: "3", mimeType: "application/pdf", filename: "Recibo.pdf", headers: [h("Content-Disposition", 'inline; filename="Recibo.pdf"')], body: { size: 100, attachmentId: "A5" } },
      { partId: "4", mimeType: "message/rfc822", filename: "Envio.eml", headers: [], body: { size: 900, attachmentId: "A6" }, parts: [
        { partId: "4.0", mimeType: "application/pdf", filename: "interno.pdf", body: { size: 10, attachmentId: "A7" } },
      ] },
      { partId: "5", mimeType: "application/octet-stream", filename: `${"x".repeat(300)}.docx`, body: { attachmentId: "A8" } },
      { partId: "6", mimeType: "text/plain", filename: 'a"b<c>|?*:\u0007.txt', body: { size: 3, data: b64u("abc") } },
      { partId: "7", mimeType: "Application/PDF", filename: "..", body: { size: 1, attachmentId: "A9" } },
    ],
  };
  const list = g.messageAttachments("18c2f", payload);
  assert.deepEqual(list.slice(0, 5), [
    { name: "image001.png", type: "image/png", size: 2048, ref: "gmail:18c2f:0.1", inline: true },
    { name: "anexo-0-2.jpg", type: "image/jpeg", size: 512, ref: "gmail:18c2f:0.2", inline: true },
    { name: "Fatura nº 12.pdf", type: "application/pdf", size: 51234, ref: "gmail:18c2f:1" },
    { name: "foto anel.jpg", type: "image/jpeg", size: 900000, ref: "gmail:18c2f:2" }, // "attachment" explícito: não é inline
    { name: "Recibo.pdf", type: "application/pdf", size: 100, ref: "gmail:18c2f:3" }, // Apple Mail: PDF "inline" é anexo
  ]);
  // O email anexado conta como um anexo (o que tem dentro vai com ele).
  assert.deepEqual(list[5], { name: "Envio.eml", type: "message/rfc822", size: 900, ref: "gmail:18c2f:4" });
  assert.ok(!list.some((a) => a.name === "interno.pdf"));
  assert.equal(list[6].name.length, 200);
  assert.ok(list[6].name.endsWith("x.docx"));
  assert.equal(list[6].size, null);
  assert.equal(list[7].name, "a_b_c_ .txt");
  assert.deepEqual(list[8], { name: "anexo-7.pdf", type: "application/pdf", size: 1, ref: "gmail:18c2f:7" });
  assert.equal(list.length, 9);
  for (const a of list) assert.ok(!/[\\/\u0000-\u001f]/.test(a.name), a.name);
  assert.deepEqual(g.messageAttachments("m", undefined), []);
  assert.deepEqual(g.messageAttachments("m", textPart("", "text/plain", "só texto")), []);
  assert.equal(g.safeFileName("=?UTF-8?Q?Garantia_n=C2=BA_7.pdf?="), "Garantia nº 7.pdf");
});

test("Spam, trash, drafts and Gmail's automatic tabs are excluded", () => {
  for (const l of ["SPAM", "TRASH", "DRAFT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"]) assert.equal(g.labelExcluded(["INBOX", l]), true, l);
  // Atualizações e Fóruns entram (ex.: formulário de contacto da loja), mas sem resposta automática.
  for (const l of ["CATEGORY_FORUMS", "CATEGORY_UPDATES"]) {
    assert.equal(g.labelExcluded(["INBOX", l]), false, l);
    assert.equal(g.autoReplyAllowed({ id: "m", threadId: "t", labelIds: ["INBOX", l], payload: { headers: [{ name: "From", value: "Ana <ana@cliente.pt>" }] } }, { mailbox: "apoiocliente@lojadoouro.pt", ownDomains: ["lojadoouro.pt"] }).ok, false, l);
  }
  assert.equal(g.labelExcluded(["INBOX", "UNREAD", "CATEGORY_PERSONAL", "IMPORTANT"]), false);
  assert.equal(g.labelExcluded([]), false);
  assert.equal(g.labelExcluded(undefined), false);
});

test("Automatic replies go only to people: labels, own mailbox and domain, system senders", () => {
  assert.deepEqual(g.autoReplyAllowed(customer(), opts), { ok: true });
  assert.deepEqual(g.autoReplyAllowed(msg([h("From", "info@cliente.pt")]), opts), { ok: true });
  const no = (m) => {
    const r = g.autoReplyAllowed(m, opts);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0);
    return r.reason;
  };
  assert.match(no(msg([h("From", "ana@cliente.pt")], ["SPAM"])), /SPAM/);
  assert.match(no(msg([h("From", "ana@cliente.pt")], ["INBOX", "CATEGORY_PROMOTIONS"])), /CATEGORY_PROMOTIONS/);
  no(msg([h("From", "ana@cliente.pt")], ["SENT"]));
  assert.match(no(msg([h("To", "apoio@lojadoouro.pt")])), /Remetente/);
  no(msg([h("From", "Ana <não-é-email>")]));
  assert.match(no(msg([h("From", "Loja do Ouro <APOIO@lojadoouro.pt>")])), /própria caixa/);
  assert.match(no(msg([h("From", "rui@lojadoouro.pt")])), /domínio da loja/);
  no(msg([h("From", "rui@braga.lojadoouro.pt")]));
  assert.deepEqual(g.autoReplyAllowed(msg([h("From", "rui@naolojadoouro.pt")]), opts), { ok: true });
  for (const from of ["MAILER-DAEMON@googlemail.com", "Mail Delivery Subsystem <mailer-daemon@google.com>", "no-reply@shopify.com", "noreply@ctt.pt", "do-not-reply@x.pt", "donotreply@x.pt", "nao-responder@ctt.pt", "bounce+12ab@x.pt", "bounces-99@x.pt", "notifications@github.com", "notification@x.pt", "alerts@banco.pt", "newsletter@x.pt", "postmaster@x.pt", "owner-lista@x.pt", "lista-request@x.pt", "shop-noreply@x.pt"])
    assert.match(no(msg([h("From", from)])), /automático/, from);
});

test("Automatic replies respect Auto-Submitted, Precedence, list headers, X-Auto* and null Return-Path", () => {
  assert.match(g.autoReplyAllowed(customer([h("Auto-Submitted", "auto-replied")]), opts).reason, /Auto-Submitted/);
  assert.equal(g.autoReplyAllowed(customer([h("auto-submitted", "auto-generated")]), opts).ok, false);
  assert.equal(g.autoReplyAllowed(customer([h("Auto-Submitted", "No")]), opts).ok, true);
  for (const p of ["bulk", "list", "junk", "auto_reply", " Bulk "]) assert.equal(g.autoReplyAllowed(customer([h("Precedence", p)]), opts).ok, false, p);
  assert.equal(g.autoReplyAllowed(customer([h("Precedence", "first-class")]), opts).ok, true);
  assert.match(g.autoReplyAllowed(customer([h("List-Id", "<clientes.x.pt>")]), opts).reason, /Lista/);
  assert.equal(g.autoReplyAllowed(customer([h("List-Unsubscribe", "<mailto:sair@x.pt>")]), opts).ok, false);
  assert.equal(g.autoReplyAllowed(customer([h("X-Autoreply", "yes")]), opts).ok, false);
  assert.equal(g.autoReplyAllowed(customer([h("X-Autorespond", "Ausente")]), opts).ok, false);
  assert.equal(g.autoReplyAllowed(customer([h("X-Auto-Response-Suppress", "DR, RN, NRN, OOF, AutoReply")]), opts).ok, false);
  assert.equal(g.autoReplyAllowed(customer([h("X-Auto-Response-Suppress", "All")]), opts).ok, false);
  assert.equal(g.autoReplyAllowed(customer([h("X-Auto-Response-Suppress", "DR")]), opts).ok, true);
  assert.match(g.autoReplyAllowed(customer([h("Return-Path", " < > ")]), opts).reason, /retorno/);
  assert.equal(g.autoReplyAllowed(customer([h("Return-Path", "<ana@cliente.pt>")]), opts).ok, true);
});

test("Subjects lose repeated reply/forward prefixes; replies get 'Re: '", () => {
  assert.equal(g.cleanSubject("Re: RE: Fwd: FW: Enc: RV: Res: Encomenda 1234"), "Encomenda 1234");
  assert.equal(g.cleanSubject("Re[2]: re : Fwd[3]:  Anel   em ouro "), "Anel em ouro");
  assert.equal(g.cleanSubject("=?UTF-8?Q?Re:_Devolu=C3=A7=C3=A3o?="), "Devolução");
  assert.equal(g.cleanSubject("Reembolso: pedido"), "Reembolso: pedido");
  assert.equal(g.cleanSubject("Encomenda: atraso"), "Encomenda: atraso");
  assert.equal(g.cleanSubject("Re:"), "");
  assert.equal(g.cleanSubject(null), "");
  assert.equal(g.replySubject("RE: Fwd: Encomenda 1234"), "Re: Encomenda 1234");
  assert.equal(g.replySubject("Troca de anel"), "Re: Troca de anel");
  assert.equal(g.replySubject(null), "Re: A sua mensagem");
  assert.equal(g.replySubject("  Fwd:  "), "Re: A sua mensagem");
  assert.equal(g.replySubject("x".repeat(400)).length, 254);
});

test("Header values are one line; non-ASCII becomes =?UTF-8?B?...?= words of at most 75 characters", () => {
  assert.equal(g.encodeHeader("Re: Encomenda 1234"), "Re: Encomenda 1234");
  assert.equal(g.encodeHeader("Hi\r\nBcc: evil@y.pt\u0000"), "Hi Bcc: evil@y.pt");
  const short = g.encodeHeader("Re: Devolução");
  assert.match(short, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  assert.equal(g.decodeWords(short), "Re: Devolução");
  const long = "Re: Garantia da aliança em ouro branco — devolução e troca de tamanho 💍 ".repeat(5).trim();
  const enc = g.encodeHeader(long);
  const words = enc.split("\r\n ");
  assert.ok(words.length > 3);
  for (const w of words) {
    assert.match(w, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.ok(w.length <= 75, `${w.length}`);
    assert.ok(!g.decodeWords(w).includes("\ufffd"), "carácter partido entre palavras");
  }
  assert.ok(!/\r\n(?! )/.test(enc) && !/\r(?!\n)/.test(enc) && !/(?<!\r)\n/.test(enc));
  assert.equal(g.decodeWords(enc), long);
  const evil = g.encodeHeader("Olá\r\nBcc: evil@y.pt");
  assert.equal(g.decodeWords(evil), "Olá Bcc: evil@y.pt");
  assert.ok(!/\r\n(?! )/.test(evil));
});

test("Addresses are formatted with quoting or encoding, and bad emails throw", () => {
  assert.equal(g.formatAddress(null, "ana@x.pt"), "ana@x.pt");
  assert.equal(g.formatAddress("  ", " ana@x.pt "), "ana@x.pt");
  assert.equal(g.formatAddress("Loja do Ouro", "apoio@lojadoouro.pt"), '"Loja do Ouro" <apoio@lojadoouro.pt>');
  assert.equal(g.formatAddress('Ana "Nita" \\ Silva', "ana@x.pt"), '"Ana \\"Nita\\" \\\\ Silva" <ana@x.pt>');
  assert.deepEqual(g.parseAddress(g.formatAddress('Ana "Nita" \\ Silva', "ana@x.pt")), { name: 'Ana "Nita" \\ Silva', email: "ana@x.pt" });
  const pt = g.formatAddress("João Gonçalves", "joao@x.pt");
  assert.match(pt, /^=\?UTF-8\?B\?[^ ]+\?= <joao@x\.pt>$/);
  assert.deepEqual(g.parseAddress(pt), { name: "João Gonçalves", email: "joao@x.pt" });
  const injected = g.formatAddress('Ana"\r\nBcc: evil@y.pt', "ana@x.pt");
  assert.equal(injected, '"Ana\\" Bcc: evil@y.pt" <ana@x.pt>');
  for (const bad of ["ana@x.pt\r\nBcc: evil@y.pt", "ana@x.pt\n", "ana@x.pt\r", "não é email", "", "a@b", "<ana@x.pt>"])
    assert.throws(() => g.formatAddress("Ana", bad), /inválido/, JSON.stringify(bad));
});

test("Plain text becomes safe HTML: escaping, paragraphs, line breaks, lists and links", () => {
  const wrap = (s) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2f33">${s}</div>`;
  assert.equal(g.textToHtml("Olá <Ana> & \"Rui\" 'x'"), wrap('<p style="margin:0 0 12px">Olá &lt;Ana&gt; &amp; &quot;Rui&quot; &#39;x&#39;</p>'));
  assert.equal(g.textToHtml("Linha 1\r\nLinha 2\r\n\r\n\r\nParágrafo 2"), wrap('<p style="margin:0 0 12px">Linha 1<br>Linha 2</p><p style="margin:0 0 12px">Parágrafo 2</p>'));
  assert.equal(g.textToHtml("Opções:\n- Troca\n- Reembolso <total>\nObrigada"),
    wrap('<p style="margin:0 0 12px">Opções:</p><ul style="margin:0 0 12px;padding-left:22px"><li>Troca</li><li>Reembolso &lt;total&gt;</li></ul><p style="margin:0 0 12px">Obrigada</p>'));
  assert.equal(g.textToHtml("• Anel\n• Fio"), wrap('<ul style="margin:0 0 12px;padding-left:22px"><li>Anel</li><li>Fio</li></ul>'));
  // Uma linha com "- " sozinha não é lista.
  assert.equal(g.textToHtml("Obrigado\n- Ana"), wrap('<p style="margin:0 0 12px">Obrigado<br>- Ana</p>'));
  assert.equal(g.textToHtml("Veja https://www.lojadoouro.pt/pages/trocas?x=1&y=2."),
    wrap('<p style="margin:0 0 12px">Veja <a href="https://www.lojadoouro.pt/pages/trocas?x=1&amp;y=2">https://www.lojadoouro.pt/pages/trocas?x=1&amp;y=2</a>.</p>'));
  assert.equal(g.textToHtml("(https://lojadoouro.pt) e https://pt.wikipedia.org/wiki/Ouro_(cor)"),
    wrap('<p style="margin:0 0 12px">(<a href="https://lojadoouro.pt">https://lojadoouro.pt</a>) e <a href="https://pt.wikipedia.org/wiki/Ouro_(cor)">https://pt.wikipedia.org/wiki/Ouro_(cor)</a></p>'));
  const evil = g.textToHtml('javascript:alert(1) https://x.pt/"onmouseover="alert(1) <script>alert(1)</script>');
  assert.ok(!evil.includes("<script>") && !evil.includes('href="javascript') && !/"onmouseover/.test(evil));
  assert.ok(evil.includes('<a href="https://x.pt/">https://x.pt/</a>&quot;onmouseover'));
  assert.equal(g.textToHtml(""), wrap(""));
});

test("The signature block is empty when blank, otherwise text and escaped HTML", () => {
  assert.deepEqual(g.signatureBlock(""), { text: "", html: "" });
  assert.deepEqual(g.signatureBlock("  \n "), { text: "", html: "" });
  assert.deepEqual(g.signatureBlock("Ana Costa\r\nLoja do Ouro <apoio@lojadoouro.pt>\n"), {
    text: "\n\nAna Costa\nLoja do Ouro <apoio@lojadoouro.pt>",
    html: '<div style="margin-top:18px;color:#4f5c55;font-size:13px;line-height:1.5">Ana Costa<br>Loja do Ouro &lt;apoio@lojadoouro.pt&gt;</div>',
  });
});

const date = new Date("2026-10-08T09:05:00Z");
const split = (raw) => {
  const at = raw.indexOf("\r\n\r\n");
  return { headers: raw.slice(0, at).split("\r\n"), body: raw.slice(at + 4) };
};
const partsOf = (body, boundary) => body.split(`--${boundary}`).slice(1, -1).map((p) => {
  const s = p.replace(/^\r\n/, "");
  const at = s.indexOf("\r\n\r\n");
  return { headers: s.slice(0, at).split("\r\n"), content: s.slice(at + 4).replace(/\r\n$/, "") };
});
const unb64 = (s) => Buffer.from(s.replace(/\r\n/g, ""), "base64");
const assertCrlf = (raw) => {
  assert.ok(!/(?<!\r)\n/.test(raw), "LF sem CR");
  assert.ok(!/\r(?!\n)/.test(raw), "CR sem LF");
  for (const line of raw.split("\r\n")) assert.ok(line.length <= 998);
};

test("MIME without attachments: exact headers, CRLF, base64 text and HTML at 76 columns", () => {
  const text = "Olá Ana,\nJá enviámos a encomenda.\n\nLoja do Ouro — " + "detalhes ".repeat(30);
  const html = g.textToHtml(text);
  const raw = g.buildMime({
    from: g.formatAddress("Loja do Ouro", "apoio@lojadoouro.pt"), to: "ana@x.pt", subject: "Re: Encomenda 1234",
    inReplyTo: "<CAF1@mail.gmail.com>", references: "<CAF0@mail.gmail.com> <CAF1@mail.gmail.com>",
    text, html, date, messageId: "abc.123@lojadoouro.pt", boundary: "b1",
  });
  assertCrlf(raw);
  const { headers, body } = split(raw);
  assert.deepEqual(headers, [
    'From: "Loja do Ouro" <apoio@lojadoouro.pt>',
    "To: ana@x.pt",
    "Subject: Re: Encomenda 1234",
    "Date: Thu, 08 Oct 2026 09:05:00 +0000",
    "Message-ID: <abc.123@lojadoouro.pt>",
    "In-Reply-To: <CAF1@mail.gmail.com>",
    "References: <CAF0@mail.gmail.com> <CAF1@mail.gmail.com>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b1"',
  ]);
  assert.ok(body.endsWith("--b1--\r\n"));
  const parts = partsOf(body, "b1");
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].headers, ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"]);
  assert.deepEqual(parts[1].headers, ["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64"]);
  assert.equal(unb64(parts[0].content).toString("utf8"), text.replace(/\n/g, "\r\n"));
  assert.equal(unb64(parts[1].content).toString("utf8"), html);
  const lines = parts[0].content.split("\r\n");
  assert.ok(lines.length > 2);
  for (const l of lines.slice(0, -1)) assert.equal(l.length, 76);
  assert.ok(lines[lines.length - 1].length <= 76);
  // Deterministas com a mesma data e separador; o separador por omissão é aleatório.
  const again = g.buildMime({ from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "x", text: "a", html: "b", date, boundary: "b1" });
  assert.equal(again, g.buildMime({ from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "x", text: "a", html: "b", date, boundary: "b1" }));
  const r1 = g.buildMime({ from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "x", text: "a", html: "b" });
  const r2 = g.buildMime({ from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "x", text: "a", html: "b" });
  const b1 = /boundary="([^"]+)"/.exec(r1)[1];
  assert.notEqual(b1, /boundary="([^"]+)"/.exec(r2)[1]);
  assert.match(b1, /^=_ldo_[0-9a-f]{24}$/);
  assert.match(r1, /\r\nDate: \w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000\r\n/);
  assert.ok(!/Message-ID|In-Reply-To|References/.test(r1));
});

test("MIME with attachments: multipart/mixed around the alternative, base64 files and RFC 2231 names", () => {
  const pdf = Buffer.from("%PDF-1.4 " + "conteúdo binário ".repeat(20));
  const longName = "Relatório de garantia — anel de noivado em ouro branco 19,2 quilates nº 7.pdf";
  const raw = g.buildMime({
    from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "Fatura", text: "Segue a fatura.", html: "<p>Segue a fatura.</p>", date, boundary: "mx",
    attachments: [
      { name: "foto.jpg", type: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]) },
      { name: "Fatura nº 12 – Outubro.pdf", type: "application/pdf", data: pdf },
      { name: longName, type: "application/pdf", data: Buffer.from("x") },
    ],
  });
  assertCrlf(raw);
  const { headers, body } = split(raw);
  assert.equal(headers[headers.length - 1], 'Content-Type: multipart/mixed; boundary="mx"');
  const parts = partsOf(body, "mx");
  assert.equal(parts.length, 4);
  assert.deepEqual(parts[0].headers, ['Content-Type: multipart/alternative; boundary="alt-mx"']);
  const alt = partsOf(parts[0].content, "alt-mx");
  assert.equal(alt.length, 2);
  assert.equal(unb64(alt[0].content).toString("utf8"), "Segue a fatura.");
  assert.equal(unb64(alt[1].content).toString("utf8"), "<p>Segue a fatura.</p>");
  assert.ok(parts[0].content.endsWith("--alt-mx--"));
  assert.ok(body.endsWith("--mx--\r\n"));

  assert.deepEqual(parts[1].headers, ['Content-Type: image/jpeg; name="foto.jpg"', 'Content-Disposition: attachment; filename="foto.jpg"', "Content-Transfer-Encoding: base64"]);
  assert.deepEqual([...unb64(parts[1].content)], [0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);

  assert.deepEqual(parts[2].headers, [
    'Content-Type: application/pdf; name="Fatura no 12 _ Outubro.pdf"',
    'Content-Disposition: attachment; filename="Fatura no 12 _ Outubro.pdf";',
    " filename*=UTF-8''Fatura%20n%C2%BA%2012%20%E2%80%93%20Outubro.pdf",
    "Content-Transfer-Encoding: base64",
  ]);
  assert.ok(unb64(parts[2].content).equals(pdf));
  for (const l of parts[2].content.split("\r\n")) assert.ok(l.length <= 76);

  // Nome longo: segmentos filename*0*, filename*1*, … que juntos dão o nome original.
  const segs = parts[3].headers.map((l) => /^ filename\*(\d+)\*=(?:UTF-8'')?([^;]+);?$/.exec(l)).filter(Boolean);
  assert.ok(segs.length >= 2);
  assert.deepEqual(segs.map((m) => Number(m[1])), segs.map((_, i) => i));
  assert.ok(parts[3].headers.some((l) => l.startsWith(" filename*0*=UTF-8''")));
  assert.equal(decodeURIComponent(segs.map((m) => m[2]).join("")), longName);
  for (const l of parts[3].headers) assert.ok(l.length <= 998);
});

test("Header injection is impossible: subject, names, references, addresses and attachments", () => {
  const raw = g.buildMime({
    from: g.formatAddress('Loja"\r\nBcc: evil@y.pt', "apoio@lojadoouro.pt"),
    to: "ana@x.pt",
    subject: "Hi\r\nBcc: evil@y.pt\r\n\r\ncorpo falso",
    inReplyTo: "<a@b.pt>\nX-Evil: 1",
    references: "<a@b.pt>\r\nBcc: evil@y.pt <c d@e.pt> <ok@e.pt>",
    text: "Bcc: evil@y.pt", html: "<p>x</p>", date, boundary: "b1",
    attachments: [{ name: 'x"\r\nBcc: evil@y.pt.pdf', type: "text/plain\r\nBcc: evil@y.pt", data: Buffer.from("x") }],
  });
  assertCrlf(raw);
  for (const line of raw.split("\r\n")) assert.ok(!/^(Bcc|X-Evil)\s*:/i.test(line), line);
  const { headers } = split(raw);
  assert.ok(headers.includes("Subject: Hi Bcc: evil@y.pt corpo falso"));
  assert.ok(headers.includes("In-Reply-To: <a@b.pt>"));
  assert.ok(headers.includes("References: <a@b.pt> <ok@e.pt>"));
  assert.ok(raw.includes('Content-Type: application/octet-stream; name="x_ Bcc_ evil@y.pt.pdf"'));
  const nonAscii = g.buildMime({ from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "Olá\r\nBcc: evil@y.pt", text: "", html: "", date, boundary: "b1" });
  const subj = split(nonAscii).headers.find((l) => l.startsWith("Subject: "));
  assert.equal(g.decodeWords(subj.slice(9)), "Olá Bcc: evil@y.pt");
  // From/To com quebras de linha (que não sejam a dobra CRLF + espaço) são recusados.
  const base = { from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "x", text: "", html: "", date };
  assert.throws(() => g.buildMime({ ...base, from: "apoio@lojadoouro.pt\r\nBcc: evil@y.pt" }), /From/);
  assert.throws(() => g.buildMime({ ...base, to: "ana@x.pt\nBcc: evil@y.pt" }), /To/);
  assert.throws(() => g.buildMime({ ...base, to: "ana@x.pt\rBcc: evil@y.pt" }), /To/);
  assert.throws(() => g.buildMime({ ...base, to: "" }), /To/);
  assert.throws(() => g.buildMime({ ...base, messageId: "<a b@c.pt>" }), /Message-ID/);
  assert.throws(() => g.buildMime({ ...base, messageId: "<a@c.pt>\r\nBcc: x@y.pt" }), /Message-ID/);
  assert.throws(() => g.buildMime({ ...base, boundary: "a b" }), /Separador/);
  assert.throws(() => g.buildMime({ ...base, boundary: "a\r\nBcc: x" }), /Separador/);
  assert.throws(() => g.buildMime({ ...base, date: new Date("x") }), /Data/);
  // Um nome longo com acentos dobra o From em CRLF + espaço; continua a ler-se como o mesmo endereço.
  const from = g.formatAddress("Joana Gonçalves da Silva Pereira de Albuquerque e Castro Menezes", "joana@x.pt");
  assert.ok(from.includes("\r\n "));
  const folded = g.buildMime({ ...base, from, boundary: "b1" });
  assertCrlf(folded);
  const fromLine = split(folded).headers.find((l) => l.startsWith("From: "));
  assert.deepEqual(g.parseAddress(fromLine.slice(6)), { name: "Joana Gonçalves da Silva Pereira de Albuquerque e Castro Menezes", email: "joana@x.pt" });
});

test("References keep the first and the 19 most recent ids, folded at 76 columns", () => {
  const ids = Array.from({ length: 25 }, (_, i) => `<id${i}.abcdefghij@mail.gmail.com>`);
  const raw = g.buildMime({ from: "apoio@lojadoouro.pt", to: "ana@x.pt", subject: "x", text: "", html: "", date, boundary: "b1", references: ids.join(" ") });
  const head = raw.slice(0, raw.indexOf("\r\n\r\n"));
  const m = /\r\nReferences:((?:.*)(?:\r\n .*)*)/.exec(head);
  const lines = m[0].slice(2).split("\r\n");
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(l.length <= 76, l);
  assert.deepEqual(g.messageIds(m[1]), [ids[0], ...ids.slice(6)]);
  assert.deepEqual(g.messageIds("lixo <a@b> <c d> <e@f>"), ["<a@b>", "<e@f>"]);
  assert.deepEqual(g.messageIds(null), []);
});

test("Support hours follow Lisbon time across both DST changes", () => {
  const hours = { weekdays: "09:30-13:00, 14:00-18:30", saturday: "10h-13h", sunday: "" };
  const at = (iso) => g.withinHours(hours, new Date(iso));
  // Verão (UTC+1): sexta 10 de julho de 2026.
  assert.equal(at("2026-07-10T08:45:00Z"), true); // 09:45
  assert.equal(at("2026-07-10T08:15:00Z"), false); // 09:15
  assert.equal(at("2026-07-10T12:30:00Z"), false); // 13:30, almoço
  assert.equal(at("2026-07-10T17:29:00Z"), true); // 18:29
  assert.equal(at("2026-07-10T17:30:00Z"), false); // 18:30, fecha
  // Inverno (UTC+0): sexta 9 de janeiro de 2026.
  assert.equal(at("2026-01-09T09:15:00Z"), false); // 09:15
  assert.equal(at("2026-01-09T09:45:00Z"), true); // 09:45
  // Mudança de outubro (domingo 25): à mesma hora UTC, antes fecha para almoço, depois está aberto.
  assert.equal(at("2026-10-23T12:30:00Z"), false); // 13:30 (UTC+1)
  assert.equal(at("2026-10-30T12:30:00Z"), true); // 12:30 (UTC+0)
  // Mudança de março (domingo 29).
  assert.equal(at("2026-03-27T08:40:00Z"), false); // 08:40 (UTC+0)
  assert.equal(at("2026-03-30T08:40:00Z"), true); // 09:40 (UTC+1)
  // Sábado e domingo.
  assert.equal(at("2026-07-11T09:30:00Z"), true); // 10:30
  assert.equal(at("2026-07-11T12:30:00Z"), false); // 13:30
  assert.equal(at("2026-07-12T10:00:00Z"), false); // domingo fechado
  // O dia é o de Lisboa: sexta 23:30 UTC no verão já é sábado 00:30 em Lisboa.
  const night = { weekdays: "", saturday: "00:00-02:00" };
  assert.equal(g.withinHours(night, new Date("2026-07-10T23:30:00Z")), true);
  assert.equal(g.withinHours(night, new Date("2026-01-09T23:30:00Z")), false); // sexta 23:30 no inverno
});

test("Hour formats, empty days and missing schedules", () => {
  assert.equal(g.withinHours(null, new Date("2026-07-12T03:00:00Z")), true);
  assert.equal(g.withinHours(undefined, new Date("2026-07-12T03:00:00Z")), true);
  assert.equal(g.withinHours({}, new Date("2026-07-12T03:00:00Z")), true);
  assert.equal(g.withinHours({ weekdays: " ", saturday: "", sunday: undefined }, new Date("2026-07-12T03:00:00Z")), true);
  assert.equal(g.withinHours({ weekdays: "fechado", saturday: "10:00-13:00" }, new Date("2026-07-10T09:00:00Z")), false);
  assert.deepEqual(g.hourRanges("09:30-13:00, 14:00-18:30"), [[570, 780], [840, 1110]]);
  assert.deepEqual(g.hourRanges("9h30-13h; 14h às 18h30"), [[570, 780], [840, 1110]]);
  assert.deepEqual(g.hourRanges("9h a 13h e 14.00 – 18.30"), [[540, 780], [840, 1110]]);
  assert.deepEqual(g.hourRanges("00:00-24:00"), [[0, 1440]]);
  assert.deepEqual(g.hourRanges("25:00-26:00, 13:00-09:00, 10:61-11:00, lixo"), []);
  assert.deepEqual(g.hourRanges(undefined), []);
});
