import Link from "next/link";
import { redirect } from "next/navigation";
import { selection, periodLabel, previous, localDate } from "@/lib/bi/periods";
import { loadPeriods } from "@/lib/bi/store";
import { liveCommerce } from "@/lib/bi/live-model";
import { overview, latestQuality } from "@/lib/bi/model";
import { currency, timestamp } from "@/components/dashboard/format";
import { Change, Icon } from "@/components/dashboard/ui";
import { BusinessTimelineContext } from "@/components/dashboard/trend";
import { Overview } from "@/components/dashboard/overview";
import { Sales } from "@/components/dashboard/sales";
import { Marketing } from "@/components/dashboard/marketing";
import { Audience } from "@/components/dashboard/audience";
import { QualityView } from "@/components/dashboard/quality";
import { AppShell, ONLINE_SECTIONS } from "@/components/shell";
import { canSeeOnline, homePath } from "@/lib/permissions";
import { requireViewer } from "@/lib/viewer";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  if (!canSeeOnline(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams,
    sel = selection(q),
    section =
      typeof q.section === "string" &&
      ["overview", "sales", "marketing", "audience", "quality"].includes(
        q.section,
      )
        ? q.section
        : "overview";
  const store = await loadPeriods([
    ...sel.windows.flatMap((w) => [w.range, previous(w.range, w.key)]),
    sel.range,
    sel.previous,
  ], sel.range, section);
  const s = overview(store, sel.range),
    p = overview(store, sel.previous),
    quality = latestQuality(store, sel.range),
    critical = quality.filter((x) => x.severity === "critical");
  const live = store.mode === "live", cohort = liveCommerce(store,sel.range);
  const report = store.reports
    .filter(
      (r) => r.period_start === sel.range.from && r.period_end === sel.range.to,
    )
    .sort((a, b) => b.version - a.version)[0];
  const href = (part: string, key = sel.key, range = sel.range) =>
    `/?${new URLSearchParams({ period: key, section: part, ...(key === "custom" ? { from: range.from, to: range.to } : {}) })}`;
  const updated = [
    s.sales.fetchedAt,
    s.meta.fetchedAt,
    s.google.fetchedAt,
    s.sessions.fetchedAt,
  ]
    .filter((x): x is string => !!x)
    .sort();
  const title = ONLINE_SECTIONS.find((n) => n[0] === section)![1];
  return (
    <AppShell
      viewer={viewer}
      current={section}
      title={title}
      onlineHref={(part) => href(part)}
      badges={{ quality: critical.length }}
    >
          <div className="page-heading">
            <div>
              <span className="eyebrow">ADMINISTRAÇÃO</span>
              <h1>{title === "Visão geral" ? "Visão geral" : title}</h1>
              <p>
                {section === "overview"
                  ? "Vendas, operação e marketing nos últimos períodos fechados."
                  : "Informação do período selecionado, com fontes e limitações visíveis."}
              </p>
            </div>
            <a className="outline-button" href="#calendario">
              <Icon name="calendar" />
              Consultar calendário
            </a>
          </div>
          <div className="period-cards" aria-label="Períodos em destaque">
            {sel.windows.map((w, i) => {
              const v = overview(store, w.range),
                before = overview(store, previous(w.range, w.key));
              const c = liveCommerce(store,w.range);
              return (
                <Link
                  href={href(section, w.key, w.range)}
                  className={`period-card ${sel.key === w.key ? "selected" : ""}`}
                  key={w.key}
                  aria-current={sel.key === w.key ? "date" : undefined}
                >
                  <div>
                    <span className="period-index">0{i + 1}</span>
                    <span className="period-title">{w.label}</span>
                    <Icon name="arrow" />
                  </div>
                  <span className="period-date">{periodLabel(w.range)}</span>
                  <strong>{currency(live ? c.paidValue : v.sales.value)}</strong>
                  <div className="period-footer">
                    <span>{live ? "Encomendas pagas · valor observado" : "Vendas Shopify"}</span>
                    {!live && <Change a={v.sales.value} b={before.sales.value} />}
                  </div>
                </Link>
              );
            })}
          </div>
          <details
            className="calendar-panel"
            key={`${sel.key}-${sel.range.from}-${sel.range.to}`}
            id="calendario"
            open={sel.key === "custom" || !!sel.error}
          >
            <summary>
              <Icon name="calendar" />
              Navegar no histórico<span>Escolher outras datas</span>
            </summary>
            <form method="get">
              <input type="hidden" name="period" value="custom" />
              <input type="hidden" name="section" value={section} />
              <label>
                Desde
                <input
                  type="date"
                  name="from"
                  required
                  defaultValue={sel.range.from}
                  max={sel.windows[0].range.to}
                />
              </label>
              <label>
                Até
                <input
                  type="date"
                  name="to"
                  required
                  defaultValue={sel.range.to}
                  max={sel.windows[0].range.to}
                />
              </label>
              <button type="submit">
                Consultar período <span>→</span>
              </button>
              <p>Datas de Portugal · apenas dias completos.</p>
            </form>
            {sel.error && (
              <p role="alert" className="form-error">
                {sel.error}
              </p>
            )}
          </details>
          <div className="period-context">
            <div>
              <span className="pill">
                {store.mode === "unavailable"
                  ? "Dados indisponíveis"
                  : report?.status === "partial"
                    ? "Fecho parcial"
                    : "Provisório"}
              </span>
              <strong>{periodLabel(sel.range)}</strong>
              <span>vs. {periodLabel(sel.previous)}</span>
            </div>
            <small>
              Recolha mais recente: {timestamp(updated.at(-1) || null)} ·
              Portugal
            </small>
          </div>
          <BusinessTimelineContext
            range={sel.range}
            previousRange={sel.previous}
          />
          {store.errors.map((e, i) => (
            <div role="status" className="notice error-notice" key={i}>
              <Icon name="check" />
              <span>{e}</span>
            </div>
          ))}
          {live && <div className="notice"><Icon name="check" /><span><strong>Consulta direta · provisória.</strong> {cohort.note} Ticket médio oficial, composição de vendas e MER aguardam a ligação aos fechos. O conector pode servir dados em cache.</span></div>}
          {section !== "quality" && critical.length > 0 && (
            <Link className="notice" href={href("quality")}>
              <Icon name="check" />
              <span>
                <strong>{critical.length} alertas críticos no período.</strong>{" "}
                Tracking de compras requer verificação antes de decisões de
                investimento.
              </span>
              <Icon name="arrow" />
            </Link>
          )}
          {section === "overview" ? (
            <Overview store={store} range={sel.range} s={s} p={p} live={live} cohort={cohort} critical={critical} report={report} href={(part) => href(part)} />
          ) : section === "sales" ? (
            <Sales store={store} range={sel.range} />
          ) : section === "marketing" ? (
            <Marketing store={store} range={sel.range} />
          ) : section === "audience" ? (
            <Audience store={store} range={sel.range} />
          ) : (
            <QualityView store={store} range={sel.range} ingestStatus={typeof q.ingest === "string" ? q.ingest : undefined} />
          )}
          <footer>
            <span>
              LOJA DO OURO <i>·</i> Administração
            </span>
            <span>
              EUR · Europe/Lisbon · Dados provisórios, sujeitos a revisão
            </span>
            <small>
              Consulta em {localDate()} · {live ? "Leitura das fontes via Windsor; cache upstream possível." : "Abrir a página não atualiza as fontes."}
            </small>
          </footer>
    </AppShell>
  );
}

