import Link from "next/link";
import { redirect } from "next/navigation";
import { CREATOR_STATUS_SITE, ONBOARDING_STEPS, PLATFORM_LABEL, lisbonDate, lisbonDateTime, outboxTitle } from "@/lib/criadores-rules";
import { crFinanceGet, crProfileGet, crPublicGet, type CrTask } from "@/lib/criadores/db";
import { requireCreator, siteBase } from "@/lib/criadores/site";
import { Aviso, IbanTail, VerificationTag, formatInt, greeting, longDate } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Início" };

// Início do criador (§4.3 /painel, §10.5 n.º 11): primeiro o estado e «A fazer» (tarefas com botão), depois as
// notificações e, na coluna de 4, os números com a fonte (declarados ou, na 3A, os públicos lidos através da Meta).
// «Em curso» (fases de cada colaboração) chega com o PR2. Sem notas, sem percentagens de adequação, sem rankings (D6).

type Todo = { title: string; text: string; href: string; action: string; urgent?: boolean };

function todo(t: CrTask, base: string): Todo | null {
  switch (t.kind) {
    case "reaccept_terms":
      return { title: "Aceitar os Termos novos", text: "Atualizámos os Termos de participação. Até aceitar, as outras páginas da conta ficam em pausa.", href: `${base}/conta/novos-termos`, action: "Ler e aceitar", urgent: true };
    case "privacy_notice":
      return { title: "Política de Privacidade atualizada", text: `Versão ${t.version}. Não precisa de aceitar nada: veja o que mudou e carregue em «Tomei conhecimento», no topo da página.`, href: `${base}/privacidade`, action: "Ver o que mudou" };
    case "complete_profile": {
      const next = ONBOARDING_STEPS.find((s) => !t.steps[s.key]);
      const left = ONBOARDING_STEPS.filter((s) => !t.steps[s.key]).map((s) => s.label.toLowerCase());
      return { title: "Completar o perfil", text: `Falta: ${left.join(", ")}. Cada passo fica guardado.`, href: `${base}/bem-vindo?passo=${next?.n ?? 1}`, action: "Continuar" };
    }
    case "submit_profile":
      return { title: "Enviar o perfil para revisão", text: "Os quatro passos estão completos. Falta a declaração de veracidade e enviar.", href: `${base}/bem-vindo?passo=4#enviar`, action: "Enviar" };
    case "iban_confirm":
      return { title: "Confirmar o IBAN novo", text: `Enviámos um email com a ligação para confirmar o IBAN terminado em ${t.last4}. Até confirmar, continua a valer o anterior.`, href: `${base}/pagamentos`, action: "Ver pagamentos", urgent: true };
    default:
      return null;
  }
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, { session, me }, q] = await Promise.all([siteBase(), requireCreator(), searchParams]);
  // Conta nova, sem nenhum passo feito: vai direto ao onboarding (F1.5).
  const s = me.onboarding;
  if (me.status === "draft" && !s.about && !s.contacts && !s.content && !s.networks) redirect(`${base}/bem-vindo?passo=1`);
  const [profile, finance, pub] = await Promise.all([
    crProfileGet(session).catch(() => null), crFinanceGet(session).catch(() => null), crPublicGet(session).catch(() => null),
  ]);
  // Tarefas da camada pública (fase 3A), calculadas aqui: ldo_cr_me não muda. Com a conta limitada ou suspensa não se
  // pode confirmar (a BD recusa), por isso não há tarefa.
  const pubAcc = pub?.account ?? null;
  const publicTodos: Todo[] = [];
  if (pubAcc?.state === "proof" && pub?.mode === "on" && me.status !== "restricted" && me.status !== "suspended") {
    publicTodos.push({ title: "Confirmar a conta do Instagram", text: "Autorizou a leitura dos números públicos. Falta escrever o código na biografia e confirmar.", href: `${base}/redes#t-ig`, action: "Confirmar" });
  }
  if (pubAcc?.state === "error") {
    publicTodos.push({ title: "Rever a conta do Instagram", text: "Não conseguimos ler os números públicos da sua conta. Veja o que fazer em Redes.", href: `${base}/redes#t-ig`, action: "Ver em Redes" });
  }
  const todos = [...me.tasks.map((t) => todo(t, base)).filter((t): t is Todo => t !== null), ...publicTodos];
  const name = me.display_name || me.first_name;
  const accounts = profile?.social_accounts ?? [];
  const now = new Date();
  // Seguidores públicos (lidos através da Meta) da conta Instagram com a posse provada.
  const publicFollowers = (accountId: string) =>
    pubAcc && pubAcc.account_id === accountId && pubAcc.verification === "public" && pubAcc.snapshot?.followers != null ? pubAcc.snapshot : null;

  const statusText = (() => {
    if (me.status === "approved") return { cls: "cr-ok", small: me.status_at ? `pela equipa a ${lisbonDate(me.status_at)}` : "pela equipa" };
    if (me.status === "pending_review") return { cls: "cr-anl", small: me.submitted_at ? `enviado a ${lisbonDate(me.submitted_at)}; a resposta chega por email` : "a resposta chega por email" };
    if (me.status === "rejected") return { cls: "cr-nao", small: "pode corrigir e enviar de novo" };
    if (me.status === "suspended") return { cls: "cr-nao", small: "fale connosco em Mensagens" };
    if (me.status === "restricted") return { cls: "", small: "a seu pedido; os dados ficam guardados" };
    return { cls: "cr-anl", small: "complete e envie para revisão" };
  })();

  return (
    <div className="cr-env">
      <section className="cr-grelha cr-abre">
        <div className="cr-c1-8">
          <p className="cr-meta">{longDate(now)}</p>
          <h1 className="cr-d-l">{greeting(now)}{name ? `, ${name}` : ""}.</h1>
          <p className="cr-lead">
            {todos.length === 0 ? "Não tem nada por fazer. Quando houver novidades, avisamos por email."
              : todos.length === 1 ? "Tem uma tarefa à espera, aqui em baixo." : `Tem ${todos.length} tarefas à espera, aqui em baixo.`}
          </p>
        </div>
      </section>

      {q.m === "enviado" && <Aviso tone="ok" title="Perfil enviado para revisão"><p>Uma pessoa da equipa vai lê-lo. Recebe a resposta por email.</p></Aviso>}
      {me.status === "rejected" && me.status_reason && (
        <Aviso title="O perfil não foi aprovado"><p>Motivo indicado pela equipa: «{me.status_reason}». Pode corrigir o perfil e enviá-lo de novo.</p></Aviso>
      )}
      {me.status === "suspended" && (
        <Aviso tone="erro" title="Conta suspensa">
          {me.status_reason && <p>Motivo: «{me.status_reason}».</p>}
          <p>Enquanto a conta estiver suspensa, não pode enviar o perfil nem mudar o IBAN. Fale connosco em <Link href={`${base}/mensagens`}>Mensagens</Link>.</p>
        </Aviso>
      )}

      <dl className="cr-estado">
        <div>
          <dt>Perfil</dt>
          <dd className={statusText.cls}>{CREATOR_STATUS_SITE[me.status]}<small>{statusText.small}</small></dd>
        </div>
        <div>
          <dt>Redes</dt>
          <dd>{accounts.length ? accounts.map((a) => PLATFORM_LABEL[a.platform]).join(", ") : "Nenhuma indicada"}<small>{accounts.length ? <Link className="cr-lig" href={`${base}/redes`}>Ver e editar</Link> : <Link className="cr-lig" href={`${base}/bem-vindo?passo=4`}>Indicar</Link>}</small></dd>
        </div>
        <div>
          <dt>Pagamentos</dt>
          <dd>
            <span className="cr-num">{finance?.iban_last4 ? <>IBAN <IbanTail last4={finance.iban_last4} /></> : "IBAN por indicar"}</span>
            <small>
              {me.iban_pending_last4 ? <>IBAN <IbanTail last4={me.iban_pending_last4} /> à espera de confirmação</>
                : finance?.fiscal_complete ? "Dados fiscais completos" : "Opcional até ser selecionado numa campanha paga"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Os seus dados</dt>
          <dd>Na sua conta<small className="cr-acoes"><Link className="cr-lig" href={`${base}/definicoes#dados`}>Descarregar</Link><Link className="cr-lig" href={`${base}/definicoes#apagar`}>Apagar a conta</Link></small></dd>
        </div>
      </dl>

      <div className="cr-grelha" style={{ marginTop: 64 }}>
        <div className="cr-c1-7">
          <div className="cr-bloco-cab"><h2 className="cr-d-m">A fazer</h2><span className="cr-meta">{todos.length === 1 ? "1 tarefa" : `${todos.length} tarefas`}</span></div>
          {todos.length ? (
            <ol className="cr-fazer">
              {todos.map((t, i) => (
                <li key={t.title}>
                  <span className="cr-fn" aria-hidden="true">{i + 1}</span>
                  <div><h3>{t.title}</h3><p>{t.text}</p></div>
                  <Link className={`cr-bt cr-bt-pq${t.urgent ? "" : " cr-bt-sec"}`} href={t.href}>{t.action}</Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="cr-vazio" style={{ marginBottom: 48 }}>Nada por fazer.</p>
          )}

          <div className="cr-bloco-cab">
            <h2 className="cr-d-m">Mensagens</h2>
            <Link className="cr-lig" href={`${base}/mensagens`}>Abrir a conversa</Link>
          </div>
          <p className="cr-vazio" style={{ marginBottom: 48 }}>
            {me.unread_messages ? `Tem ${me.unread_messages === 1 ? "1 mensagem" : `${me.unread_messages} mensagens`} da equipa por ler.` : "Não tem mensagens por ler."}
          </p>

          <div className="cr-bloco-cab"><h2 className="cr-d-m">O que mudou</h2><span className="cr-meta">Os avisos que lhe enviámos por email</span></div>
          {me.notifications.length ? (
            <ul className="cr-lista">
              {me.notifications.map((n, i) => (
                <li key={`${n.created_at}-${i}`}>
                  <span>{outboxTitle(n.kind, n.payload) || "Aviso da equipa"}</span>
                  <span className="cr-meta cr-num">{lisbonDateTime(n.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cr-vazio">Ainda não há avisos.</p>
          )}
        </div>

        <aside className="cr-c9-4" aria-labelledby="t-num">
          <div className="cr-bloco-cab"><h2 id="t-num" className="cr-d-s">Os seus números</h2></div>
          {accounts.length ? (
            <>
              <table className="cr-tab">
                <caption>Seguidores por rede</caption>
                <tbody>
                  {accounts.map((a) => {
                    const pubSnap = publicFollowers(a.id);
                    return (
                      <tr key={a.id}>
                        <td>{PLATFORM_LABEL[a.platform]}<br /><span className="cr-meta">@{a.handle}</span></td>
                        {pubSnap ? (
                          <td className="cr-n">
                            {formatInt(pubSnap.followers)}
                            <div style={{ marginTop: 6 }}><span className="cr-etq cr-tinta">Dados públicos</span></div>
                            <div className="cr-meta" style={{ marginTop: 6, whiteSpace: "normal" }}>Lido através da Meta a {lisbonDate(pubSnap.taken_at || pubSnap.taken_on)}</div>
                          </td>
                        ) : (
                          <td className="cr-n">
                            {a.metrics?.followers != null ? <>{formatInt(a.metrics.followers)}<span className="cr-nota" aria-hidden="true">1</span><span className="cr-sr">, nota 1</span></> : "—"}
                            <div style={{ marginTop: 6 }}>{a.metrics?.validated ? <span className="cr-etq cr-ok">Validado pela equipa</span> : <VerificationTag v={a.verification} />}</div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="cr-notas">
                <p><span className="cr-nota" style={{ marginLeft: 0 }} aria-hidden="true">1</span><span className="cr-sr">Nota 1:</span> Declarado por si{accounts.some((a) => a.metrics?.declared_on) ? ", na data indicada em Redes" : ""}. Os números validados pela equipa dizem-no.</p>
              </div>
            </>
          ) : (
            <p className="cr-pequeno">Ainda não indicou nenhuma rede.</p>
          )}
          <p className="cr-semnota">A Loja do Ouro não dá notas nem ordena criadores. Estes números são os mesmos que a equipa vê.</p>
        </aside>
      </div>
    </div>
  );
}
