import Link from "next/link";
import { periodLabel, type Period } from "@/lib/bi/periods";
import { RANKING_PRESETS, type RankingPreset } from "@/lib/ranking-period";
import { Icon } from "@/components/dashboard/ui";

export type RankingTab = "lojas" | "produtos" | "categorias";
const TABS: [RankingTab, string, string][] = [
  ["lojas", "Lojas", "/lojas/ranking"],
  ["produtos", "Produtos", "/lojas/ranking/produtos"],
  ["categorias", "Categorias", "/lojas/ranking/categorias"],
];

const href = (path: string, params: Record<string, string>) => {
  const q = new URLSearchParams(params).toString();
  return q ? `${path}?${q}` : path;
};

// Separadores dos rankings. O período escolhido mantém-se ao mudar de separador; a loja e a ordem são de cada um.
export function RankingTabs({ current, period }: { current: RankingTab; period: Record<string, string> }) {
  return (
    <nav className="segmented ranking-tabs" aria-label="Ranking">
      {TABS.map(([key, label, path]) => (
        <Link key={key} href={href(path, period)} className={key === current ? "active" : ""} aria-current={key === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

// Atalhos de período e datas à escolha. `keep` são os outros filtros do separador (loja, ordem) a manter.
export function RankingPeriod({ path, preset, range, today, keep, error, children }: {
  path: string;
  preset: RankingPreset | "custom";
  range: Period;
  today: string;
  keep: Record<string, string>;
  error?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <>
      {error && <div role="alert" className="notice error-notice"><Icon name="calendar" /><span>{error}</span></div>}
      <div className="ranking-filters">
        <nav className="chips" aria-label="Período">
          {RANKING_PRESETS.map(([k, l]) => (
            <Link key={k} className={preset === k ? "chip active" : "chip"} href={href(path, { periodo: k, ...keep })} aria-current={preset === k ? "page" : undefined}>{l}</Link>
          ))}
        </nav>
        {children}
      </div>
      <details className="calendar-panel" open={preset === "custom" || Boolean(error)}>
        <summary>
          <Icon name="calendar" />
          Escolher outras datas<span>{periodLabel(range)}</span>
        </summary>
        <form method="get" action={path}>
          {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label>Desde<input type="date" name="from" required defaultValue={range.from} max={today} /></label>
          <label>Até<input type="date" name="to" required defaultValue={range.to} max={today} /></label>
          <button type="submit">Ver ranking <span>→</span></button>
        </form>
      </details>
    </>
  );
}

// "Todas as lojas" ou uma das lojas que a pessoa gere.
export function RankingStores({ stores, current, link }: { stores: { id: string; code: string; name: string }[]; current: string | null; link: (code: string | null) => string }) {
  if (stores.length < 2) return null;
  return (
    <nav className="chips ranking-stores" aria-label="Loja">
      <Link className={current === null ? "chip active" : "chip"} href={link(null)} aria-current={current === null ? "page" : undefined}>Todas as lojas</Link>
      {stores.map((s) => (
        <Link key={s.id} className={current === s.id ? "chip active" : "chip"} href={link(s.code)} aria-current={current === s.id ? "page" : undefined}>{s.name}</Link>
      ))}
    </nav>
  );
}

// Chips "Por valor" / "Por unidades" (ou outro par) de um separador.
export function RankingOrder({ options, current, link }: { options: [string, string][]; current: string; link: (value: string) => string }) {
  return (
    <nav className="chips" aria-label="Ordenar por">
      {options.map(([v, l]) => (
        <Link key={v} className={current === v ? "chip active" : "chip"} href={link(v)} aria-current={current === v ? "page" : undefined}>{l}</Link>
      ))}
    </nav>
  );
}
