import { lisbonDateTime } from "@/lib/criadores-rules";
import { crMessagesList } from "@/lib/criadores/db";
import { requireCreator } from "@/lib/criadores/site";
import { MessageForm } from "../forms";
import { PageHead } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensagens" };

// Conversa com a equipa (§4.3 /mensagens): texto simples, sem anexos na v1. Abrir a página marca como lidas as
// mensagens da equipa (ldo_cr_messages_list). O texto é mostrado como texto (React escapa), com as quebras de linha.
const AUTHOR = { creator: "A sua mensagem", staff: "Equipa da Loja do Ouro", system: "Aviso automático" } as const;

export default async function MessagesPage() {
  const { session } = await requireCreator();
  const messages = await crMessagesList(session);
  return (
    <div className="cr-env">
      <div className="cr-grelha">
        <div className="cr-c1-8">
          <PageHead chapeu="A sua conta" title="Mensagens" lead="Fale com a equipa de marketing. Respondemos aqui e avisamos por email." />
          {messages.length ? (
            <ol className="cr-conversa" aria-label="Conversa com a equipa">
              {messages.map((m) => (
                <li key={m.id} className={m.author === "creator" ? "cr-meu" : m.author === "system" ? "cr-sistema" : undefined}>
                  <div className="cr-quem">
                    <b>{AUTHOR[m.author] || "Equipa"}</b>
                    <span className="cr-meta cr-num">
                      {lisbonDateTime(m.created_at)}
                      {m.author === "creator" && m.read_by_staff_at ? " · lida pela equipa" : ""}
                    </span>
                  </div>
                  <p className="cr-corpo">{m.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="cr-vazio" style={{ marginBottom: 32 }}>Ainda não há mensagens. Escreva em baixo se tiver uma dúvida.</p>
          )}
          <MessageForm />
        </div>
      </div>
    </div>
  );
}
