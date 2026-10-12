// Email com o acesso à área de gestão: nome de utilizador e um link de uso único para a pessoa escolher a
// palavra-passe. Sem I/O (testado em tests/access-email.cjs); o envio está em lib/access.ts.
import { brandEmail, emailParagraph, esc } from "./email-layout";

export const ACCESS_HOURS = 48;

// O token vai depois de "#": o browser não o envia ao servidor, por isso não fica nos registos de pedidos nem
// no cabeçalho Referer. A página /acesso lê-o no browser e manda-o no corpo do pedido.
export function accessLink(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/+$/, "")}/acesso#${token}`;
}

// 32 bytes aleatórios em hexadecimal (ldo_create_access).
export function validAccessToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

// "14/10/2026 às 15:30", hora de Lisboa.
export function lisbonDateTime(iso: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("pt-PT", {
      timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} às ${parts.hour}:${parts.minute}`;
}

export function accessEmail(a: { baseUrl: string; link: string; username: string; fullName: string | null; expiresAt: string }) {
  const first = (a.fullName || "").trim().split(/\s+/)[0] || "";
  const until = lisbonDateTime(a.expiresAt);
  const login = `${a.baseUrl.replace(/\/+$/, "")}/login`;
  const subject = "O seu acesso à área de gestão da Loja do Ouro";
  const html = brandEmail({
    baseUrl: a.baseUrl,
    eyebrow: "Área de gestão",
    title: first ? `Olá, ${first}` : "O seu acesso",
    preheader: "Crie a sua palavra-passe para entrar na área de gestão da Loja do Ouro.",
    body: [
      emailParagraph("Foi criado um acesso para si na área de gestão da Loja do Ouro."),
      emailParagraph(`O seu nome de utilizador é <strong>${esc(a.username)}</strong>.`),
      emailParagraph(
        `Carregue no botão para escolher a sua palavra-passe. O link é pessoal, só pode ser usado uma vez e é válido até ${esc(until)}.`,
      ),
    ].join("\n"),
    button: { label: "Criar palavra-passe", url: a.link },
    // Depois do botão: como entrar das próximas vezes e o aviso para quem não esperava o email.
    after: [
      emailParagraph(
        `Depois, entre sempre em <a href="${esc(login)}" style="color:#1d3e47">${esc(login)}</a> com o seu nome de utilizador e a palavra-passe que escolheu.`,
      ),
      emailParagraph("Se não esperava este email, pode ignorá-lo: sem a palavra-passe ninguém entra na sua conta."),
    ].join("\n"),
    footer: "Loja do Ouro · Área de gestão · Mensagem automática",
  });
  const text = [
    first ? `Olá, ${first}.` : "Olá.",
    "",
    "Foi criado um acesso para si na área de gestão da Loja do Ouro.",
    `O seu nome de utilizador é: ${a.username}`,
    "",
    `Abra este link para escolher a sua palavra-passe (pessoal, uso único, válido até ${until}):`,
    a.link,
    "",
    `Depois, entre sempre em ${login} com o seu nome de utilizador e a palavra-passe que escolheu.`,
    "",
    "Se não esperava este email, pode ignorá-lo: sem a palavra-passe ninguém entra na sua conta.",
  ].join("\n");
  return { subject, html, text };
}
