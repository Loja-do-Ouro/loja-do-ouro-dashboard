// Modelo dos emails da Loja do Ouro (relatórios, Apoio ao Cliente, chat do site): logótipo, faixa petróleo
// com o título em dourado, conteúdo e botão. Só tabelas e estilos inline, para os clientes de email.
// Sem I/O: o texto vindo de clientes ou colaboradores passa sempre por esc().

export const BRAND = {
  petrol: "#1d3e47",
  gold: "#b38a4f",
  goldLight: "#c9a46a",
  page: "#f5f3ee",
  line: "#e7e2d8",
  soft: "#faf8f3",
  muted: "#9a917f",
  text: "#1f2f33",
};

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type BrandEmail = {
  baseUrl: string; // endereço do dashboard (logótipo público em /logo-loja-do-ouro.png)
  eyebrow: string; // linha pequena em dourado por cima do título
  title: string;
  preheader?: string; // texto da pré-visualização na caixa de entrada
  body: string; // linhas <tr> já em HTML (emailParagraph, emailQuote…)
  button?: { label: string; url: string };
  footer: string;
};

export function brandEmail(e: BrandEmail) {
  const pre = e.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(e.preheader)}</div>`
    : "";
  const button = e.button
    ? `<tr><td align="center" style="padding:8px 24px 26px"><a href="${esc(e.button.url)}" style="display:inline-block;background:${BRAND.petrol};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;font-size:14px">${esc(e.button.label)}</a></td></tr>`
    : "";
  return `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.title)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.page};font-family:Arial,Helvetica,sans-serif;color:${BRAND.text}">${pre}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.page};padding:24px 0"><tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${BRAND.line}">
<tr><td align="center" style="padding:24px 24px 12px"><img src="${esc(e.baseUrl)}/logo-loja-do-ouro.png" alt="Loja do Ouro" width="170" style="display:block;width:170px;height:auto;border:0"></td></tr>
<tr><td style="padding:0 24px 20px"><table role="presentation" width="100%" style="background:${BRAND.petrol};border-radius:12px"><tr><td style="padding:20px 22px">
<div style="font-size:11px;letter-spacing:2px;color:${BRAND.goldLight};font-weight:bold;text-transform:uppercase">${esc(e.eyebrow)}</div>
<div style="font-size:22px;color:#ffffff;font-weight:bold;margin-top:6px">${esc(e.title)}</div></td></tr></table></td></tr>
${e.body}
${button}
<tr><td style="padding:14px 24px;background:${BRAND.soft};color:${BRAND.muted};font-size:11px;text-align:center">${esc(e.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

// Parágrafo de texto (o HTML recebido já tem de estar escapado).
export function emailParagraph(html: string) {
  return `<tr><td style="padding:0 24px 14px;font-size:15px;line-height:1.55;color:${BRAND.text}">${html}</td></tr>`;
}

// Texto escapado com as ligações http(s) clicáveis (cada parte é escapada antes de entrar no HTML).
export function linkedText(raw: string) {
  const re = /https?:\/\/[^\s<>"']+/g;
  let out = "";
  let last = 0;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    out += esc(raw.slice(last, m.index)) + `<a href="${esc(url)}" style="color:${BRAND.gold}">${esc(url)}</a>`;
    last = m.index + url.length;
    re.lastIndex = last;
  }
  return out + esc(raw.slice(last));
}

// Mensagem citada (ex.: resposta da equipa), com quem a escreveu por cima. As quebras de linha mantêm-se.
export function emailQuote(author: string | null, text: string) {
  const who = author ? `<div style="font-size:12px;color:${BRAND.muted};margin:0 0 4px">${esc(author)}</div>` : "";
  return `<tr><td style="padding:0 24px 14px">${who}<div style="background:${BRAND.soft};border-left:3px solid ${BRAND.gold};border-radius:6px;padding:12px 14px;font-size:15px;line-height:1.55;color:${BRAND.text};white-space:pre-wrap">${linkedText(text)}</div></td></tr>`;
}
