import Link from "next/link";
import type { ReactNode } from "react";
import {
  PUBLIC_PAUSED_TEXT, PUBLIC_PROOF_PER_DAY, PUBLIC_SHOW_AVERAGES, PUBLIC_STATE_LABEL, instagramHandle, mediaKindLabel, publicSummary,
} from "@/lib/criadores-meta-rules";
import { lisbonDate, lisbonDateTime, type CreatorStatus } from "@/lib/criadores-rules";
import type { CrPublicAccount, CrPublicGet, CrSocialAccount } from "@/lib/criadores/db";
import { CopyCode, PublicProofForm, PublicRenewForm, PublicStartForm, PublicStopForm } from "../forms";
import { Aviso, formatInt } from "../ui";

// Bloco «Dados públicos do Instagram» de /redes (fase 3A), componente de servidor. Estados: indisponível («Em breve»),
// sem conta Instagram, @ que o Instagram não aceita, conta limitada ou suspensa, pode autorizar, à espera do código,
// em leitura e com erro. Em todos os estados com autorização, «Parar a leitura e apagar os dados públicos» está à mão,
// também com a conta limitada ou suspensa e com Termos por aceitar (reaccept: a página abre só com este bloco).
// Os textos seguem a Política de Privacidade publicada (o que se lê, o que não se lê, o código na biografia).

// Avisos depois de uma ação (?m=… na volta a /redes#t-ig).
const DONE: Record<string, string> = {
  autorizado: "Autorização guardada. Falta confirmar que a conta é sua: siga os passos abaixo.",
  confirmado: "Conta confirmada. A primeira leitura chega dentro de alguns minutos e já pode tirar o código da biografia.",
  codigo: "Código novo criado. Escreva-o na biografia e confirme.",
  parado: "Leitura parada. Apagámos os números lidos do Instagram e a conta voltou a «Não verificado».",
};

type Props = {
  pub: CrPublicGet | null;
  ig: CrSocialAccount | null;
  status: CreatorStatus;
  base: string;
  available: boolean; // interruptor ligado e a ligação à Meta configurada
  consent: string | null; // texto exato da caixa (consentText com o @), calculado no servidor
  reaccept?: boolean; // Termos por aceitar: só ver e parar (a BD recusa autorizar, confirmar e gerar códigos)
  done?: string;
};

function Tag({ cls, children }: { cls: string; children: string }) {
  return <span className={`cr-etq ${cls}`}>{children}</span>;
}

function Head({ tag }: { tag: ReactNode }) {
  return (
    <div className="cr-rede-cab">
      <h2 id="t-ig" className="cr-d-m">Dados públicos do Instagram</h2>
      {tag}
    </div>
  );
}

function Stop({ accountId, intro }: { accountId: string; intro: string }) {
  return (
    <div className="cr-bloco" style={{ marginTop: 32 }}>
      <div className="cr-bloco-cab"><h3 className="cr-d-xs">Parar a leitura</h3></div>
      <PublicStopForm accountId={accountId} intro={intro} />
    </div>
  );
}

const STOP_INTRO = "Apagamos de imediato os números lidos do Instagram e a conta volta a «Não verificado». Pode autorizar de novo mais tarde.";
// Leitura desligada pela Loja do Ouro (public_mode = 'off'), com e sem números já lidos.
const OFF_NOTICE = "A Loja do Ouro parou a leitura de momento. Os números já lidos continuam aqui e pode apagá-los quando quiser.";
const OFF_NOTICE_EMPTY = "A Loja do Ouro parou a leitura de momento: ainda não lemos nenhum número. Pode cancelar a autorização quando quiser.";

// Conta limitada (art. 18.º) ou suspensa: a BD recusa confirmar e o tick não a lê (ldo_cr_public_claim exclui-as);
// parar funciona sempre. null para as outras.
function blockedText(status: CreatorStatus, what: "confirm" | "read"): string | null {
  if (status !== "restricted" && status !== "suspended") return null;
  const during = status === "restricted" ? "Enquanto durar a limitação do tratamento que pediu" : "Enquanto a conta estiver suspensa";
  return what === "confirm"
    ? `${during}, não é possível confirmar a conta. Pode cancelar a autorização abaixo.`
    : `${during}, não lemos a conta. Os números já lidos continuam aqui e pode apagá-los quando quiser.`;
}

// Seguidores, publicações e a próxima leitura; as leituras anteriores e as publicações. O mesmo que a equipa vê na
// ficha (as últimas 30 leituras e as 25 publicações mais recentes), como diz a autorização.
function Numbers({ a, active }: { a: CrPublicAccount; active: boolean }) {
  const s = a.snapshot;
  const history = a.history ?? [];
  const summary = PUBLIC_SHOW_AVERAGES ? publicSummary(a.media) : null;
  return (
    <>
      <dl className="cr-ficha">
        <dt>Seguidores</dt><dd className="cr-num">{formatInt(s?.followers)}</dd>
        <dt>Publicações</dt><dd className="cr-num">{formatInt(s?.media_count)}</dd>
        {active && <><dt>Próxima leitura</dt><dd className="cr-num">{a.next_at ? lisbonDate(a.next_at) : "—"}</dd></>}
      </dl>
      {summary && summary.posts >= 3 && (
        <table className="cr-tab cr-tab-pilha" style={{ marginBottom: 24 }}>
          <caption>Média das últimas {summary.posts} publicações (com mais de 48 horas)</caption>
          <thead><tr><th scope="col" className="cr-n">Gostos</th><th scope="col" className="cr-n">Comentários</th><th scope="col" className="cr-n">Visualizações de reels ({summary.reels} reels)</th></tr></thead>
          <tbody>
            <tr>
              <td data-r="Gostos" className="cr-n">{formatInt(summary.likes)}</td>
              <td data-r="Comentários" className="cr-n">{formatInt(summary.comments)}</td>
              <td data-r="Visualizações de reels" className="cr-n">{formatInt(summary.reelViews)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {history.length > 1 && (
        <table className="cr-tab cr-tab-pilha" style={{ marginBottom: 24 }}>
          <caption>Últimas leituras</caption>
          <thead>
            <tr><th scope="col">Data</th><th scope="col" className="cr-n">Seguidores</th><th scope="col" className="cr-n">Publicações</th></tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.taken_on}>
                <td className="cr-tit cr-num">{lisbonDate(h.taken_on)}</td>
                <td data-r="Seguidores" className="cr-n">{formatInt(h.followers)}</td>
                <td data-r="Publicações" className="cr-n">{formatInt(h.media_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {a.media.length > 0 ? (
        <table className="cr-tab cr-tab-pilha" style={{ marginBottom: 12 }}>
          <caption>Publicações recentes</caption>
          <thead>
            <tr><th scope="col">Data</th><th scope="col">Tipo</th><th scope="col" className="cr-n">Gostos</th><th scope="col" className="cr-n">Comentários</th><th scope="col" className="cr-n">Visualizações</th></tr>
          </thead>
          <tbody>
            {a.media.map((m, i) => (
              <tr key={`${m.posted_at}-${i}`}>
                <td className="cr-tit cr-num">{lisbonDate(m.posted_at)}</td>
                <td data-r="Tipo">{mediaKindLabel(m)}</td>
                <td data-r="Gostos" className="cr-n">{formatInt(m.like_count)}</td>
                <td data-r="Comentários" className="cr-n">{formatInt(m.comments_count)}</td>
                <td data-r="Visualizações" className="cr-n">{formatInt(m.view_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        s && <p className="cr-vazio">A Meta não devolveu publicações desta conta.</p>
      )}
      <div className="cr-notas">
        <p>Números públicos lidos através da Meta, a partir da conta Instagram da Loja do Ouro. A equipa vê os mesmos números no seu perfil.</p>
        <p>— : número que o autor da conta escondeu (por exemplo, os gostos) ou que não existe nesse tipo de publicação; as visualizações só existem nos reels.</p>
        <p>Não servem para indicadores nem para análise por inteligência artificial, e não ordenam nem pontuam criadores.</p>
      </div>
    </>
  );
}

// crPublicGet falhou por outro motivo que não a migração em falta (BD lenta, rede): diz que houve um erro, em vez de
// «Em breve», que esconderia «Parar a leitura» a quem autorizou.
export function PublicLoadError() {
  return (
    <section className="cr-rede" aria-labelledby="t-ig">
      <Head tag={null} />
      <Aviso tone="erro"><p>Não foi possível carregar a leitura dos dados públicos do Instagram. Recarregue a página dentro de momentos.</p></Aviso>
    </section>
  );
}

export function PublicSection({ pub, ig, status, base, available, consent, reaccept = false, done }: Props) {
  const a = pub?.account && ig && pub.account.account_id === ig.id ? pub.account : null;
  const state = a?.state ?? null;
  const notice = done && DONE[done] ? <Aviso tone="ok"><p>{DONE[done]}</p></Aviso> : null;

  // ---- com autorização (há uma linha): à espera do código, em leitura ou com erro
  if (a && state === "proof") {
    const expired = Boolean(a.code_expires_at && Date.parse(a.code_expires_at) < Date.now());
    const left = pub?.proof_left ?? PUBLIC_PROOF_PER_DAY;
    const blocked = blockedText(status, "confirm");
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={<Tag cls="cr-anl">{PUBLIC_STATE_LABEL.proof}</Tag>} />
        {notice}
        {blocked ? (
          <Aviso><p>{blocked}</p></Aviso>
        ) : reaccept ? (
          <Aviso>
            <p>
              Atualizámos os Termos de participação: para confirmar a conta, aceite primeiro a versão nova em{" "}
              <Link href={`${base}/conta/novos-termos`}>Termos atualizados</Link>. Pode cancelar a autorização abaixo sem aceitar.
            </p>
          </Aviso>
        ) : !available ? (
          <Aviso><p>A Loja do Ouro parou a leitura de momento: não é possível confirmar a conta agora. Ainda não foi lido nenhum número e pode cancelar a autorização quando quiser.</p></Aviso>
        ) : expired ? (
          <>
            <Aviso title="O código expirou"><p>O código expirou a {lisbonDateTime(a.code_expires_at)}. Gere um código novo e escreva-o na biografia.</p></Aviso>
            <PublicRenewForm accountId={a.account_id} />
          </>
        ) : (
          <>
            <Aviso title={`Falta confirmar que @${a.handle} é sua`}>
              <ol className="cr-lista">
                <li>
                  <span>1. Copie este código:</span>
                  <span>
                    <span className="cr-d-m cr-num" style={{ display: "block" }}>{a.code}</span>
                    {a.code && <CopyCode code={a.code} />}
                  </span>
                </li>
                <li><span>2. No Instagram, abra o seu perfil, carregue em «Editar perfil» e junte o código à biografia, em qualquer sítio do texto. Guarde.</span></li>
                <li><span>3. Volte aqui e carregue em «Confirmar a conta». Lemos a biografia só para encontrar o código e não a guardamos.</span></li>
                <li><span>4. Depois de confirmada a conta, pode tirar o código da biografia.</span></li>
              </ol>
            </Aviso>
            <p className="cr-meta">
              Código válido até {lisbonDateTime(a.code_expires_at)}.{" "}
              {left > 0
                ? `Pode confirmar mais ${left} ${left === 1 ? "vez" : "vezes"} nas próximas 24 horas.`
                : `Já usou as ${PUBLIC_PROOF_PER_DAY} tentativas das últimas 24 horas: pode confirmar de novo amanhã.`}
            </p>
            {pub?.paused && <Aviso><p>{PUBLIC_PAUSED_TEXT}</p></Aviso>}
            <PublicProofForm accountId={a.account_id} />
          </>
        )}
        <Stop accountId={a.account_id} intro="Se mudou de ideias, apagamos a autorização. Ainda não foi lido nenhum número." />
      </section>
    );
  }

  if (a && state === "active") {
    const blocked = blockedText(status, "read");
    const reading = available && !blocked;
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={<Tag cls="cr-tinta">Dados públicos</Tag>} />
        {notice}
        {blocked ? <Aviso><p>{blocked}</p></Aviso> : !available && <Aviso><p>{a.snapshot ? OFF_NOTICE : OFF_NOTICE_EMPTY}</p></Aviso>}
        <p className="cr-meta">
          @{a.handle}
          {a.last_read_at ? ` · Lido a ${lisbonDateTime(a.last_read_at)}` : reading ? " · A primeira leitura chega dentro de alguns minutos." : ""}
        </p>
        <Numbers a={a} active={reading} />
        <Stop accountId={a.account_id} intro={STOP_INTRO} />
      </section>
    );
  }

  if (a && state === "error") {
    const blocked = blockedText(status, "read");
    const reading = available && !blocked;
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={<Tag cls="cr-nao">{PUBLIC_STATE_LABEL.error}</Tag>} />
        {notice}
        {blocked ? <Aviso><p>{blocked}</p></Aviso> : !available && <Aviso><p>{a.snapshot ? OFF_NOTICE : OFF_NOTICE_EMPTY}</p></Aviso>}
        <Aviso tone="erro" title={`Não conseguimos ler @${a.handle}`}>
          <p>
            Desde {lisbonDate(a.last_error_at)}, a Meta não devolve os números públicos desta conta. Acontece quando a conta deixa de ser profissional
            (Criador de conteúdos ou Empresa) ou quando o nome de utilizador muda. Confirme o tipo de conta na app do Instagram; se mudou de nome, corrija-o em
            «Contas declaradas» (a leitura para e pode autorizar de novo).
            {reading && " Tentamos outra vez uma vez por semana."}
            {status !== "restricted" && " Se continuar assim durante 90 dias, paramos a leitura e apagamos os números lidos."}
          </p>
        </Aviso>
        {a.snapshot && <p className="cr-meta">Os últimos números lidos, de {lisbonDate(a.snapshot.taken_at || a.snapshot.taken_on)}:</p>}
        {a.snapshot && <Numbers a={a} active={false} />}
        <Stop accountId={a.account_id} intro={STOP_INTRO} />
      </section>
    );
  }

  // ---- sem autorização
  const tagNo = <Tag cls="cr-anl">Não autorizado</Tag>;
  if (reaccept) {
    // A BD recusa autorizar com Termos por aceitar; não há nada para parar.
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={tagNo} />
        {notice}
        <p>Não autorizou a leitura dos números públicos do Instagram: não há nada para parar. Para autorizar, aceite primeiro os Termos novos.</p>
      </section>
    );
  }
  if (!available) {
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={<Tag cls="cr-anl">Em breve</Tag>} />
        {notice}
        <p>
          Em breve vai poder autorizar aqui a leitura dos números públicos da sua conta profissional do Instagram. É opcional, tem uma autorização própria e
          pode ser parada a qualquer momento: os números lidos são apagados nesse momento.
        </p>
      </section>
    );
  }
  if (!ig) {
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={tagNo} />
        {notice}
        <p>Para autorizar a leitura, junte primeiro a sua conta do Instagram em <a href="#t-nova">«Juntar outra rede»</a>, mais abaixo.</p>
      </section>
    );
  }
  if (!instagramHandle(ig.handle) || !consent) {
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={tagNo} />
        {notice}
        <p>
          @{ig.handle} não é um nome de utilizador válido do Instagram (só letras, números, ponto e _, até 30 caracteres). Corrija-o em «Contas declaradas»
          para poder autorizar a leitura.
        </p>
      </section>
    );
  }
  if (status === "restricted" || status === "suspended") {
    return (
      <section className="cr-rede" aria-labelledby="t-ig">
        <Head tag={tagNo} />
        {notice}
        <p>
          {status === "restricted"
            ? "Pediu a limitação do tratamento dos seus dados: enquanto durar, não é possível autorizar a leitura."
            : "Com a conta suspensa não é possível autorizar a leitura. Fale connosco em Mensagens."}
        </p>
      </section>
    );
  }
  return (
    <section className="cr-rede" aria-labelledby="t-ig">
      <Head tag={tagNo} />
      {notice}
      <p>
        Se autorizar, lemos através da Meta os números públicos da sua conta profissional do Instagram @{ig.handle}: seguidores, número de publicações e,
        por publicação, gostos, comentários e visualizações de reels. Lemos a partir da conta Instagram da Loja do Ouro: não acedemos à sua conta, não lemos
        mensagens nem estatísticas privadas e não guardamos imagens.
      </p>
      <p>Para confirmar que a conta é sua, a seguir pedimos-lhe que escreva um código na biografia. Lemos a biografia só para isso e não a guardamos.</p>
      <p>
        É opcional. Estes números não servem para indicadores nem para análise por inteligência artificial. Pode parar a leitura a qualquer momento, aqui em
        Redes, e apagamos de imediato o que foi lido.
      </p>
      <PublicStartForm accountId={ig.id} text={consent} />
      <p className="cr-pequeno" style={{ marginTop: 16 }}>
        Só funciona com contas profissionais do Instagram (Criador de conteúdos ou Empresa). Mais pormenores na{" "}
        <Link href={`${base}/privacidade`}>Política de Privacidade</Link>.
      </p>
    </section>
  );
}
