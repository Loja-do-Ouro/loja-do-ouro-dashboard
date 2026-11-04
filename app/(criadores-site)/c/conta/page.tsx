import Link from "next/link";
import { requireCreator, siteBase } from "@/lib/criadores/site";
import { logoutAction } from "../actions";
import { PageHead } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conta" };

// «Conta» da barra inferior do telemóvel: junta os destinos que não cabem nos 5 (§10.5 n.º 9).
export default async function AccountHub() {
  const [base, { me }] = await Promise.all([siteBase(), requireCreator({ allowReaccept: true })]);
  const items = [
    { href: "/perfil", title: "Perfil", text: "Nome, contactos, temas, formatos e lojas" },
    { href: "/redes", title: "Redes", text: "As contas onde publica e os números declarados" },
    { href: "/pagamentos", title: "Pagamentos", text: me.iban_pending_last4 ? `IBAN terminado em ${me.iban_pending_last4} à espera de confirmação` : "Dados fiscais e IBAN" },
    { href: "/mensagens", title: "Mensagens", text: me.unread_messages ? `${me.unread_messages} por ler` : "Conversa com a equipa" },
    { href: "/definicoes", title: "Definições", text: "Palavra-passe, avisos, os seus dados e apagar a conta" },
    { href: "/privacidade", title: "Política de Privacidade", text: "Que dados tratamos e porquê" },
    { href: "/termos", title: "Termos de participação", text: "As regras do programa" },
  ];
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu={me.email} title="A sua conta" />
          <ul className="cr-lista cr-lista-ligacoes" style={{ borderTop: "1px solid var(--cr-tinta)" }}>
            {items.map((i) => (
              <li key={i.href}>
                <Link href={`${base}${i.href}`}>
                  <span><span className="cr-d-xs" style={{ display: "block" }}>{i.title}</span><span className="cr-pequeno">{i.text}</span></span>
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
          <form action={logoutAction} style={{ marginTop: 24 }}>
            <button type="submit" className="cr-bt cr-bt-sec">Sair</button>
          </form>
        </div>
      </div>
    </div>
  );
}
