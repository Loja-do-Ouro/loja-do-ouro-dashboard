import { redirect } from "next/navigation";
import { periodLabel } from "@/lib/bi/periods";
import { canCompareStores, homePath, managedStores } from "@/lib/permissions";
import { rankingPeriod, tabPeriodParams } from "@/lib/ranking-period";
import { loadOptions } from "@/lib/records";
import { categoryRanking, label, rankAverage, rankBefore, rankBy, rankValue, type CategoryDim, type Options, type RankBy, type RankRow, type ShopSale } from "@/lib/store-records";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent } from "@/components/dashboard/format";
import { Change, Empty, Panel } from "@/components/dashboard/ui";
import { RankingOrder, RankingPeriod, RankingStores, RankingTabs } from "@/components/ranking";
import { AppShell, PageHeading } from "@/components/shell";
import { BarValue } from "@/components/stores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ranking das categorias · Loja do Ouro" };

const MEDALS = ["🥇", "🥈", "🥉"];
const NOT_SET = "Não indicado";

const categoryName = (options: Options, dim: CategoryDim, r: RankRow) => {
  const type = r.type ? label(options, "product_type", r.type) : NOT_SET;
  const material = r.material ? label(options, "material", r.material) : NOT_SET;
  if (dim === "tipo") return r.key ? type : NOT_SET;
  if (dim === "material") return r.key ? material : NOT_SET;
  return `${type} · ${material}`;
};

export default async function CategoryRankingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canCompareStores(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const period = rankingPeriod(q, "este-mes");
  const { today, range, prev } = period;
  const stores = managedStores(viewer);
  const store = stores.find((s) => s.code === q.loja) || null;
  const storeIds = new Set(store ? [store.id] : stores.map((s) => s.id));
  const by = rankBy(q.ordem);

  const [options, sales] = await Promise.all([
    loadOptions(viewer.session),
    rpcAll<ShopSale>("ldo_list_shop_sales", { p_session: viewer.session, p_store_id: store?.id ?? null, p_from: prev.from < range.from ? prev.from : range.from, p_to: range.to }),
  ]);
  const types = categoryRanking(sales, storeIds, range, prev, "tipo", by);
  const materials = categoryRanking(sales, storeIds, range, prev, "material", by);
  const combos = categoryRanking(sales, storeIds, range, prev, "tipo-material", by);
  const totals = types.totals;
  const metric = (r: RankRow) => (by === "unidades" ? r.units : r.value);

  const keep = { ...(store ? { loja: store.code } : {}), ...(by === "unidades" ? { ordem: "unidades" } : {}) };
  const link = (params: Record<string, string | null>) => {
    // O período só entra no endereço quando foi escolhido; sem escolha, fica o de cada separador.
    const merged: Record<string, string> = { ...tabPeriodParams(period), ...keep };
    for (const [k, v] of Object.entries(params)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    return `/lojas/ranking/categorias?${new URLSearchParams(merged)}`;
  };
  const valueText = (r: RankRow) => rankValue(r, currency);
  const units = (n: number) => `${integer(n)} ${n === 1 ? "unidade" : "unidades"}`;

  return (
    <AppShell viewer={viewer} current="ranking" title="Ranking das categorias">
      <PageHeading
        eyebrow="LOJAS FÍSICAS"
        title="Ranking das categorias"
        text={`Tipos de artigo e materiais mais vendidos ${store ? `na loja ${store.name}` : "em todas as lojas"}, por ${by === "unidades" ? "unidades" : "valor"} · ${periodLabel(range)}, comparado com ${periodLabel(prev)}.`}
      />
      <RankingTabs current="categorias" period={tabPeriodParams(period)} />
      <RankingPeriod path="/lojas/ranking/categorias" preset={period.preset} range={range} today={today} keep={keep} error={period.error}>
        <RankingOrder options={[["valor", "Por valor"], ["unidades", "Por unidades"]]} current={by} link={(v) => link({ ordem: v === "unidades" ? "unidades" : null })} />
      </RankingPeriod>
      <RankingStores stores={stores} current={store?.id ?? null} link={(code) => link({ loja: code })} />

      <Panel title="Resumo" eyebrow={store ? store.name.toUpperCase() : "TODAS AS LOJAS"}>
        <div className="mini-stats four">
          <div><span>Valor dos artigos</span><strong>{currency(totals.value)}</strong></div>
          <div><span>Unidades vendidas</span><strong>{integer(totals.units)}</strong></div>
          <div><span>Tipos de artigo</span><strong>{integer(types.rows.filter((r) => r.key).length)}</strong></div>
          <div><span>Vendas</span><strong>{integer(totals.sales)}</strong></div>
        </div>
      </Panel>

      {!types.rows.length ? (
        <Empty>Sem artigos vendidos neste período.</Empty>
      ) : (
        <>
          <div className="podium">
            {types.rows.slice(0, 3).map((r, i) => (
              <article key={r.key} className={`podium-card place-${i + 1}`}>
                <span className="podium-medal" aria-hidden="true">{MEDALS[i]}</span>
                <span className="podium-place">{i + 1}.º lugar</span>
                <h2>{categoryName(options, "tipo", r)}</h2>
                <strong>{by === "unidades" ? units(r.units) : valueText(r)}</strong>
                <Change a={metric(r) || null} b={rankBefore(r, by)} />
                <small>{by === "unidades" ? valueText(r) : units(r.units)} · {integer(r.products)} {r.products === 1 ? "peça diferente" : "peças diferentes"}</small>
              </article>
            ))}
          </div>
          <CategoryTable title="Tipos de artigo" dim="tipo" rows={types.rows} options={options} by={by} total={by === "unidades" ? totals.units : totals.value} />
          <CategoryTable title="Materiais" dim="material" rows={materials.rows} options={options} by={by} total={by === "unidades" ? totals.units : totals.value} />
          <CategoryTable
            title="Tipo e material"
            dim="tipo-material"
            rows={combos.rows}
            options={options}
            by={by}
            total={by === "unidades" ? totals.units : totals.value}
            note={[
              "Cada linha de artigo de “Vendas e atendimentos” conta como uma unidade. Os artigos não têm preço próprio: numa venda com um só artigo o valor é o da venda; numa venda com vários artigos o valor é dividido em partes iguais (≈ valor estimado).",
              totals.value ? `${percent((totals.estimated / totals.value) * 100)} do valor vem de vendas com vários artigos.` : "",
              totals.withoutValue.sales ? `${integer(totals.withoutValue.sales)} ${totals.withoutValue.sales === 1 ? "venda sem valor indicado conta" : "vendas sem valor indicado contam"} só nas unidades (${units(totals.withoutValue.units)}).` : "",
              totals.withoutItems.sales ? `${integer(totals.withoutItems.sales)} ${totals.withoutItems.sales === 1 ? "venda sem artigos indicados" : "vendas sem artigos indicados"} (${currency(totals.withoutItems.value)}) não ${totals.withoutItems.sales === 1 ? "entra" : "entram"} no ranking.` : "",
            ].filter(Boolean).join(" ")}
          />
        </>
      )}
    </AppShell>
  );
}

function CategoryTable({ title, dim, rows, options, by, total, note }: { title: string; dim: CategoryDim; rows: RankRow[]; options: Options; by: RankBy; total: number; note?: string }) {
  const metric = (r: RankRow) => (by === "unidades" ? r.units : r.value);
  const max = Math.max(0, ...rows.map(metric));
  const valueText = (r: RankRow) => rankValue(r, currency);
  // Por valor, uma linha só com vendas sem valor indicado não tem valor nem percentagem.
  const unknown = (r: RankRow) => by === "valor" && !r.pricedUnits;
  return (
    <Panel title={title} eyebrow="CLASSIFICAÇÃO" note={note}>
      <div className="table-scroll" tabIndex={0} aria-label={`Ranking: ${title}`}>
        <table className="nums ranking-table">
          <thead>
            <tr>
              {["#", dim === "material" ? "Material" : dim === "tipo" ? "Tipo de artigo" : "Tipo · material", by === "unidades" ? "Unidades" : "Valor", "vs. anterior", "% do total", by === "unidades" ? "Valor" : "Unidades", "Valor médio", "Vendas", "Peças diferentes"].map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><span className={`rank-badge r${Math.min(r.rank, 4)}`}>{r.rank}</span></td>
                <td><b>{categoryName(options, dim, r)}</b></td>
                <td>{unknown(r) ? valueText(r) : <BarValue value={metric(r)} max={max}>{by === "unidades" ? integer(r.units) : valueText(r)}</BarValue>}</td>
                <td><Change a={metric(r) || null} b={rankBefore(r, by)} /></td>
                <td>{total && !unknown(r) ? percent((metric(r) / total) * 100) : "—"}</td>
                <td>{by === "unidades" ? valueText(r) : integer(r.units)}</td>
                <td>{rankAverage(r, currency)}</td>
                <td>{integer(r.sales)}</td>
                <td>{integer(r.products)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
