import Link from "next/link";
import { lisbonDateTime } from "@/lib/leilao-rules";
import { pubHome, siteBase } from "@/lib/leilao/site";
import { Countdown } from "./live";

export const dynamic = "force-dynamic";

export default async function AuctionHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, q, data] = await Promise.all([siteBase(), searchParams, pubHome().catch(() => null)]);
  const events = data?.events ?? [];
  const s = data?.settings;
  const now = Date.now();

  return (
    <>
      <section className="lx-hero">
        <div className="lx-wrap">
          <span className="lx-eyebrow">Leilões online · Loja do Ouro</span>
          <h1>Joias e relógios da nossa coleção, ao seu preço.</h1>
          <p>
            Peças escolhidas e verificadas pelos nossos joalheiros, em leilões curtos e transparentes. Sem comissão do comprador, com garantia
            e 14 dias para desistir depois de receber.
          </p>
          <div className="lx-hero-actions">
            <a className="lx-btn" href="#leiloes">Ver leilões</a>
            <Link className="lx-btn lx-btn-ghost" href={`${base}/como-funciona`}>Como funciona</Link>
          </div>
        </div>
      </section>

      <section className="lx-trust" aria-label="Garantias">
        <div className="lx-wrap lx-trust-grid">
          <div className="lx-trust-item"><strong>0 % de comissão</strong><span>O preço final é o que paga.</span></div>
          <div className="lx-trust-item"><strong>Peças próprias</strong><span>Da nossa coleção, com contrastaria.</span></div>
          <div className="lx-trust-item"><strong>Garantia</strong><span>{s ? `${Math.round(s.new_warranty_months / 12)} anos nas novas, ${s.used_warranty_months} meses nas usadas.` : "Garantia legal em todas as peças."}</span></div>
          <div className="lx-trust-item"><strong>14 dias</strong><span>Para desistir depois da entrega.</span></div>
        </div>
      </section>

      <section className="lx-section" id="leiloes">
        <div className="lx-wrap">
          {q.m === "apagada" && <div className="lx-alert lx-alert-ok" style={{ marginBottom: 24 }}>A sua conta foi apagada. Obrigado por ter participado.</div>}
          <div className="lx-section-head">
            <div>
              <span className="lx-eyebrow">Calendário</span>
              <h2 style={{ margin: 0 }}>Leilões</h2>
            </div>
            <p>Horas de Lisboa.</p>
          </div>

          {!data ? (
            <div className="lx-card lx-empty"><p>O leilão está indisponível neste momento. Tente dentro de momentos.</p></div>
          ) : events.length === 0 ? (
            <div className="lx-card lx-empty">
              <h3>Em breve, o primeiro leilão</h3>
              <p>Estamos a preparar as peças. Crie já a sua conta para estar pronto quando abrir.</p>
              <Link className="lx-btn" href={`${base}/conta/registo`}>Criar conta</Link>
            </div>
          ) : (
            <div className="lx-events">
              {events.map((e) => {
                const live = e.sort === 0;
                const soon = e.sort === 1;
                return (
                  <Link key={e.slug} href={`${base}/${e.slug}`} className="lx-card lx-event">
                    <div className="lx-event-media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {e.cover && <img src={e.cover} alt="" />}
                    </div>
                    <div className="lx-event-body">
                      <span className={`lx-badge ${live ? "lx-badge-live" : soon ? "" : "lx-badge-closed"}`}>
                        {live ? "A decorrer" : soon ? "Brevemente" : "Terminado"}
                      </span>
                      <h3>{e.title}</h3>
                      {e.intro && <p className="lx-muted" style={{ margin: 0 }}>{e.intro.length > 220 ? `${e.intro.slice(0, 220)}…` : e.intro}</p>}
                      <div className="lx-event-meta">
                        <span>{e.lots} {e.lots === 1 ? "lote" : "lotes"}</span>
                        {soon && <span>Abre a {lisbonDateTime(e.opens_at)}</span>}
                        {(live || soon) && <span>Primeiro fecho a {lisbonDateTime(e.first_close_at)}</span>}
                        {!live && !soon && e.last_close_at && <span>Terminou a {lisbonDateTime(e.last_close_at)}</span>}
                      </div>
                      <div className="lx-event-foot">
                        {live && new Date(e.first_close_at).getTime() > now ? (
                          <span className="lx-small">Primeiro lote termina em <Countdown closeAt={e.first_close_at} /></span>
                        ) : live ? (
                          <span className="lx-small">{e.open_lots} {e.open_lots === 1 ? "lote aberto" : "lotes abertos"}</span>
                        ) : <span />}
                        <span className="lx-btn lx-btn-small lx-btn-dark">{live ? "Licitar" : "Ver lotes"}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="lx-section" style={{ paddingTop: 0 }}>
        <div className="lx-wrap">
          <div className="lx-section-head">
            <div>
              <span className="lx-eyebrow">Simples e transparente</span>
              <h2 style={{ margin: 0 }}>Como funciona</h2>
            </div>
            <Link href={`${base}/como-funciona`} className="lx-small">Tudo explicado →</Link>
          </div>
          <div className="lx-steps">
            <div className="lx-card lx-step"><h3>Crie a conta</h3><p>Grátis. Confirme o email e está pronto para licitar.</p></div>
            <div className="lx-card lx-step"><h3>Indique o seu máximo</h3><p>Licitamos por si só o necessário, até ao valor que escolher. O máximo fica secreto.</p></div>
            <div className="lx-card lx-step"><h3>Sem surpresas no fim</h3><p>Licitações de última hora prolongam o lote {s ? `${s.extend_minutes} minutos` : ""}, e avisamos todos por email.</p></div>
            <div className="lx-card lx-step"><h3>Pague e receba</h3><p>Sem comissão. Pagamento em {s?.payment_hours ?? 48} h, entrega segura ou levantamento numa das nossas lojas.</p></div>
          </div>
        </div>
      </section>
    </>
  );
}
