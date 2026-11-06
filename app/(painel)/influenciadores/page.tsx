import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import { Flash, PageHeading } from "@/components/shell";
import { creatorsServerConfigured, crPublicStatus, type CrPublicStatus } from "@/lib/criadores/db";
import { encryptionProblem } from "@/lib/criadores/crypto";
import { metaPublicConfigured } from "@/lib/criadores/meta";
import { creatorsReady, siteUrl } from "@/lib/criadores/site";
import { graphErrorText } from "@/lib/criadores-meta-rules";
import { LEGAL_KIND_LABEL, lisbonDateTime } from "@/lib/criadores-rules";
import { emailConfigured } from "@/lib/email";
import { canManageCreators } from "@/lib/permissions";
import { requireCreatorsViewer } from "@/lib/viewer";
import { testMetaConnection } from "./actions";
import { creatorsError, creatorsMessage } from "./messages";
import { CreatorsShell, loadOverview, num } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Influenciadores · Loja do Ouro" };

type Tile = { label: string; value: number; href: string; note: string; alert?: boolean };

function Tiles({ items }: { items: Tile[] }) {
  return (
    <div className="four-col">
      {items.map((t) => (
        <Link key={t.label} href={t.href} className="kpi">
          <div className="eyebrow">{t.label}</div>
          <div className="kpi-value">{num(t.value)}</div>
          {t.alert && t.value > 0 ? <span className="pill warn">Ver agora</span> : null}
          <p>{t.note}</p>
        </Link>
      ))}
    </div>
  );
}

// Estado das ligações da plataforma: só se vê se cada coisa está configurada, nunca um valor.
function Integration({ name, ok, text }: { name: string; ok: boolean; text: string }) {
  return (
    <tr>
      <td><strong>{name}</strong></td>
      <td><span className={ok ? "pill ok" : "pill warn"}>{ok ? "Pronto" : "Por configurar"}</span></td>
      <td className="muted">{text}</td>
    </tr>
  );
}

// Ligação à Meta (dados públicos do Instagram, fase 3A): pronta quando está configurada, o último pedido certo é
// mais recente do que o último erro e não há pausa. Só o estado e o código da Meta, nunca uma resposta.
function metaState(configured: boolean, pub: CrPublicStatus | null, now: number): { ok: boolean; text: string } {
  if (!configured) return { ok: false, text: "Sem o token do System User e o id da conta @lojadoouro a leitura não corre (na Preview é normal)." };
  if (!pub) return { ok: false, text: "Estado indisponível (falta a atualização da base de dados?)." };
  const off = pub.mode !== "on" ? "Leitura desligada em Definições. " : "";
  const paused = pub.paused_until && Date.parse(pub.paused_until) > now ? pub.paused_until : null;
  const okAt = pub.last_ok_at ? Date.parse(pub.last_ok_at) : null;
  const errAt = pub.last_error_at ? Date.parse(pub.last_error_at) : null;
  const usage = pub.usage_pct !== null ? ` · uso da app ${pub.usage_pct} %` : "";
  if (okAt && (!errAt || okAt > errAt) && !paused) {
    return { ok: true, text: `${off}Último pedido certo a ${lisbonDateTime(pub.last_ok_at)}${usage}.` };
  }
  if (pub.last_error && errAt) {
    return {
      ok: false,
      text: `${off}${graphErrorText(pub.last_error, pub.last_code)} Desde ${lisbonDateTime(pub.last_error_at)}${paused ? `; em pausa até ${lisbonDateTime(paused)}` : ""}.`,
    };
  }
  return { ok: false, text: `${off}Ainda sem pedidos: carregue em «Testar a ligação à Meta».` };
}

export default async function CreatorsOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireCreatorsViewer("view");
  const q = await searchParams;
  const o = await loadOverview(viewer.session);
  const keyProblem = encryptionProblem();
  const ready = creatorsReady();
  const server = creatorsServerConfigured();
  const resend = emailConfigured();
  const manage = canManageCreators(viewer);
  const pub = await crPublicStatus(viewer.session).catch(() => null);
  const meta = metaState(metaPublicConfigured(), pub, Date.now());

  return (
    <CreatorsShell viewer={viewer} current="influenciadores" title="Influenciadores">
      <PageHeading
        eyebrow="INFLUENCIADORES"
        title="Plataforma de criadores"
        text="Criadores e influenciadores que se registam em criadores.lojadoouro.pt: perfis por rever, pedidos de privacidade e o estado da plataforma."
      >
        <a className="outline-button" href={siteUrl()} target="_blank" rel="noopener noreferrer">Ver o site dos criadores</a>
      </PageHeading>
      <Flash ok={creatorsMessage(q)} error={creatorsError(q)} />
      {!o ? (
        <div className="notice error-notice">Visão geral indisponível (falta a atualização da base de dados?).</div>
      ) : (
        <>
          {o.privacy_overdue > 0 ? (
            <div role="alert" className="notice error-notice">
              <span>
                {o.privacy_overdue === 1 ? "Há 1 pedido de privacidade com o prazo ultrapassado." : `Há ${o.privacy_overdue} pedidos de privacidade com o prazo ultrapassado.`}{" "}
                <Link href="/influenciadores/privacidade">Responder agora</Link>
              </span>
            </div>
          ) : o.privacy_due_soon > 0 ? (
            <div role="status" className="notice">
              <span>
                {o.privacy_due_soon === 1 ? "1 pedido de privacidade termina o prazo" : `${o.privacy_due_soon} pedidos de privacidade terminam o prazo`} nos
                próximos 7 dias (um mês a contar da receção, ou a data da prorrogação). <Link href="/influenciadores/privacidade">Ver pedidos</Link>
              </span>
            </div>
          ) : null}

          <Tiles
            items={[
              { label: "Perfis por rever", value: o.profiles_pending, href: "/influenciadores/criadores?estado=pending_review", note: "Submetidos e à espera de decisão.", alert: true },
              { label: "Alterados desde a revisão", value: o.profiles_changed, href: "/influenciadores/criadores?estado=approved&alterados=1", note: "Aprovados que mudaram dados relevantes." },
              { label: "Criadores aprovados", value: o.creators_approved, href: "/influenciadores/criadores?estado=approved", note: "Podem candidatar-se a campanhas (PR2)." },
              { label: "Contas ativas", value: o.creators_active, href: "/influenciadores/criadores", note: "Com o email confirmado e sem apagamento." },
            ]}
          />
          <Tiles
            items={[
              { label: "Mensagens por ler", value: o.messages_unread, href: "/influenciadores/criadores", note: "Dos criadores para a equipa (coluna «Mensagens» na lista)." },
              { label: "Pedidos RGPD abertos", value: o.privacy_open, href: "/influenciadores/privacidade", note: "Acesso, apagamento, oposição, limitação e outros." },
              { label: "A vencer em 7 dias", value: o.privacy_due_soon, href: "/influenciadores/privacidade", note: "Inclui os que já passaram do prazo.", alert: true },
              { label: "Apagamentos por concluir", value: o.erasure_ready, href: "/influenciadores/privacidade", note: `Sem bloqueios: o Super Admin conclui na ficha. ${o.erasure_waiting} à espera do fim de uma colaboração.`, alert: true },
            ]}
          />

          <div className="two-col">
            <Panel title="IBAN e pagamentos" eyebrow="ANTIFRAUDE" note="Um IBAN novo só conta depois de o titular o confirmar pelo email. Depois, durante a espera, a revelação exige a confirmação por outro canal (telefone).">
              <div className="mini-stats">
                <div>
                  <span>IBAN em espera</span>
                  <strong>{num(o.iban_hold)}</strong>
                </div>
                <div>
                  <span>IBAN por confirmar pelo titular</span>
                  <strong>{num(o.iban_pending)}</strong>
                </div>
                <div>
                  <span>«Não fui eu» nos últimos 30 dias</span>
                  <strong>{num(o.iban_rejected_30d)}</strong>
                </div>
              </div>
            </Panel>

            <Panel title="Inscrições e documentos" eyebrow="PLATAFORMA">
              <p>
                Inscrições{" "}
                <span className={o.registrations_open ? "pill ok" : "pill warn"}>{o.registrations_open ? "Abertas" : "Fechadas"}</span>
                {!o.registrations_open && <small className="muted block">O site mostra «em breve» e não grava registos.</small>}
              </p>
              <ul className="checks" style={{ listStyle: "none", padding: 0, marginTop: 14 }}>
                {(["terms", "privacy", "cookies", "meta_data"] as const).map((k) => (
                  <li key={k}>
                    {LEGAL_KIND_LABEL[k]}:{" "}
                    {o.legal_published[k] ? <span className="tag green">v{o.legal_published[k]} publicada</span> : <span className="tag">por publicar</span>}
                  </li>
                ))}
              </ul>
              {manage && (
                <p className="field-help" style={{ marginTop: 14 }}>
                  <Link href="/influenciadores/definicoes">Definições</Link>: identificação legal, documentos, inscrições e prazos de conservação.
                </p>
              )}
            </Panel>
          </div>

          <Panel
            title="Dados públicos do Instagram"
            eyebrow="META · BUSINESS DISCOVERY"
            note="Leitura diária (semanal sem atividade há mais de 90 dias) dos números públicos das contas que o autorizaram, depois de confirmada a posse com um código na biografia. Os números não servem para indicadores nem para IA e só aparecem no perfil de cada criador."
          >
            <p>
              Leitura{" "}
              {pub ? <span className={pub.mode === "on" ? "pill ok" : "pill warn"}>{pub.mode === "on" ? "Ligada" : "Desligada"}</span> : <span className="pill">Indisponível</span>}
              {manage && <small className="muted block">Liga-se e desliga-se em <Link href="/influenciadores/definicoes#meta">Definições</Link> (Super Admin), depois de testar a ligação abaixo.</small>}
            </p>
            <div className="mini-stats">
              <div>
                <span>Por confirmar</span>
                <strong>{num(pub?.proof)}</strong>
              </div>
              <div>
                <span>Em leitura</span>
                <strong>{num(pub?.active)}</strong>
              </div>
              <div>
                <span>Com erro</span>
                <strong>{num(pub?.error)}</strong>
              </div>
              <div>
                <span>Atrasadas</span>
                <strong>{num(pub?.overdue)}</strong>
              </div>
            </div>
          </Panel>
        </>
      )}

      <Panel
        title="Estado das ligações"
        eyebrow="INTEGRAÇÕES"
        id="ligacoes"
        note="Blob (ficheiros), catálogo Shopify e IA entram nos PR seguintes; a ligação do Instagram pela Meta (insights) no PR 3B. Os segredos ficam na Vercel: aqui só se vê se existem."
      >
        <div className="table-scroll" tabIndex={0} aria-label="Estado das ligações">
          <table className="left-table">
            <tbody>
              <Integration name="Base de dados (CREATORS_SERVER_TOKEN)" ok={server} text={server ? "As funções do site e do servidor estão ligadas." : "Sem o token, o site, a fila de emails e o tick recusam tudo."} />
              <Integration name="Endereço próprio (CREATORS_URL)" ok={ready} text={ready ? "Inscrições e emails podem abrir." : "Em produção, sem o domínio, as inscrições não abrem e os emails não saem (só testes internos em /c)."} />
              <Integration name="Cifra (CREATORS_ENCRYPTION_KEY)" ok={!keyProblem} text={keyProblem || "IBAN e dados fiscais cifrados com o anel de chaves."} />
              <Integration name="Emails (Resend)" ok={resend} text={resend ? "Avisos da fila e emails de conta." : "RESEND_API_KEY por configurar: nenhum email sai."} />
              <Integration name="Meta — dados públicos (META_SYSTEM_USER_TOKEN, META_IG_ACCOUNT_ID)" ok={meta.ok} text={meta.text} />
            </tbody>
          </table>
        </div>
        {manage && (
          <form action={testMetaConnection} className="inline-form" style={{ marginTop: 14 }}>
            <button type="submit" className="secondary-button">Testar a ligação à Meta</button>
            <small className="muted">Faz um pedido à Meta com os números públicos da própria @lojadoouro, com os mesmos campos da leitura.</small>
          </form>
        )}
      </Panel>
    </CreatorsShell>
  );
}
