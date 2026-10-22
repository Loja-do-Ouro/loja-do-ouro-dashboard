import Link from "next/link";
import { redirect } from "next/navigation";
import { periodLabel } from "@/lib/bi/periods";
import { productsBySku, shopifyConfigured, SKU_LOOKUP_LIMIT, type SkuProduct } from "@/lib/bi/shopify";
import { canCompareStores, homePath, managedStores } from "@/lib/permissions";
import { rankingPeriod, tabPeriodParams } from "@/lib/ranking-period";
import { loadOptions } from "@/lib/records";
import { label, productRanking, rankAverage, rankBefore, rankBy, rankValue, type RankRow, type ShopSale } from "@/lib/store-records";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent } from "@/components/dashboard/format";
import { Change, Empty, Panel } from "@/components/dashboard/ui";
import { RankingOrder, RankingPeriod, RankingStores, RankingTabs } from "@/components/ranking";
import { AppShell, PageHeading } from "@/components/shell";
import { BarValue } from "@/components/stores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ranking dos produtos · Loja do Ouro" };

const MEDALS = ["🥇", "🥈", "🥉"];
const TOP = 50;

// Nome, foto e preço das peças que também estão no site. Se a Shopify não responder a tempo, o ranking mostra só as
// referências registadas nas lojas.
async function catalog(refs: string[]): Promise<{ products: Map<string, SkuProduct>; failed: boolean }> {
  if (!refs.length || !shopifyConfigured()) return { products: new Map(), failed: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), 10000)));
    const r = await Promise.race([productsBySku(refs), timeout]);
    return { products: r.products, failed: r.incomplete };
  } catch {
    return { products: new Map(), failed: true };
  } finally {
    clearTimeout(timer);
  }
}

export default async function ProductRankingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canCompareStores(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const period = rankingPeriod(q, "este-mes");
  const { today, range, prev } = period;
  const stores = managedStores(viewer);
  const store = stores.find((s) => s.code === q.loja) || null;
  const storeIds = new Set(store ? [store.id] : stores.map((s) => s.id));
  const by = rankBy(q.ordem);
  const all = q.todos === "1";

  const [options, sales] = await Promise.all([
    loadOptions(viewer.session),
    rpcAll<ShopSale>("ldo_list_shop_sales", { p_session: viewer.session, p_store_id: store?.id ?? null, p_from: prev.from < range.from ? prev.from : range.from, p_to: range.to }),
  ]);
  const { rows, totals } = productRanking(sales, storeIds, range, prev, by);
  const shown = all ? rows : rows.slice(0, TOP);
  const refs = shown.flatMap((r) => (r.reference ? [r.reference] : []));
  const { products, failed } = await catalog(refs);
  const site = (r: RankRow) => (r.reference ? products.get(r.reference) : undefined);
  const metric = (r: RankRow) => (by === "unidades" ? r.units : r.value);
  const max = Math.max(0, ...shown.map(metric));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));

  const keep = { ...(store ? { loja: store.code } : {}), ...(by === "unidades" ? { ordem: "unidades" } : {}) };
  const link = (params: Record<string, string | null>) => {
    // O período só entra no endereço quando foi escolhido; sem escolha, fica o de cada separador.
    const merged: Record<string, string> = { ...tabPeriodParams(period), ...keep };
    for (const [k, v] of Object.entries(params)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    return `/lojas/ranking/produtos?${new URLSearchParams(merged)}`;
  };
  const kindLabel = (r: RankRow) => [label(options, "product_type", r.type), label(options, "material", r.material)].filter((t) => t !== "—").join(" · ");
  const name = (r: RankRow) => site(r)?.title || (r.reference ? `Referência ${r.reference}` : `Sem referência${kindLabel(r) ? ` · ${kindLabel(r)}` : ""}`);
  const valueText = (r: RankRow) => rankValue(r, currency);
  // Por valor, uma linha só com vendas sem valor indicado não tem valor nem percentagem.
  const unknown = (r: RankRow) => by === "valor" && !r.pricedUnits;
  const units = (n: number) => `${integer(n)} ${n === 1 ? "unidade" : "unidades"}`;

  return (
    <AppShell viewer={viewer} current="ranking" title="Ranking dos produtos">
      <PageHeading
        eyebrow="LOJAS FÍSICAS"
        title="Ranking dos produtos"
        text={`Peças mais vendidas ${store ? `na loja ${store.name}` : "em todas as lojas"}, por ${by === "unidades" ? "unidades" : "valor"} · ${periodLabel(range)}, comparado com ${periodLabel(prev)}.`}
      />
      <RankingTabs current="produtos" period={tabPeriodParams(period)} />
      <RankingPeriod path="/lojas/ranking/produtos" preset={period.preset} range={range} today={today} keep={keep} error={period.error}>
        <RankingOrder options={[["valor", "Por valor"], ["unidades", "Por unidades"]]} current={by} link={(v) => link({ ordem: v === "unidades" ? "unidades" : null, todos: null })} />
      </RankingPeriod>
      <RankingStores stores={stores} current={store?.id ?? null} link={(code) => link({ loja: code, todos: null })} />

      <Panel title="Resumo" eyebrow={store ? store.name.toUpperCase() : "TODAS AS LOJAS"}>
        <div className="mini-stats four">
          <div><span>Valor dos artigos</span><strong>{currency(totals.value)}</strong></div>
          <div><span>Unidades vendidas</span><strong>{integer(totals.units)}</strong></div>
          <div><span>Peças diferentes</span><strong>{integer(totals.products)}</strong></div>
          <div><span>Vendas</span><strong>{integer(totals.sales)}</strong></div>
        </div>
      </Panel>

      {!rows.length ? (
        <Empty>Sem artigos vendidos neste período.</Empty>
      ) : (
        <>
          <div className="podium">
            {rows.slice(0, 3).map((r, i) => (
              <article key={r.key} className={`podium-card product-podium place-${i + 1}`}>
                <span className="podium-medal" aria-hidden="true">{MEDALS[i]}</span>
                <span className="podium-place">{i + 1}.º lugar</span>
                <div className="podium-product">
                  <ProductThumb image={site(r)?.image ?? null} />
                  <h2>{name(r)}</h2>
                </div>
                <strong>{by === "unidades" ? units(r.units) : valueText(r)}</strong>
                <Change a={metric(r) || null} b={rankBefore(r, by)} />
                <small>
                  {by === "unidades" ? valueText(r) : units(r.units)} · {r.reference ? `ref. ${r.reference}` : kindLabel(r)}
                  {site(r)?.combined ? " · parte de um conjunto no site" : ""}
                </small>
              </article>
            ))}
          </div>

          <Panel
            title={rows.length === 1 ? "A única peça vendida" : all || rows.length <= TOP ? `Todas as ${integer(rows.length)} peças` : `As ${TOP} peças mais vendidas de ${integer(rows.length)}`}
            eyebrow="CLASSIFICAÇÃO"
            note={[
              "Cada linha de artigo de “Vendas e atendimentos” conta como uma unidade. Os artigos não têm preço próprio: numa venda com um só artigo o valor é o da venda; numa venda com vários artigos o valor é dividido em partes iguais (≈ valor estimado).",
              totals.value ? `${percent((totals.estimated / totals.value) * 100)} do valor vem de vendas com vários artigos.` : "",
              totals.withoutItems.sales ? `${integer(totals.withoutItems.sales)} ${totals.withoutItems.sales === 1 ? "venda sem artigos indicados" : "vendas sem artigos indicados"} (${currency(totals.withoutItems.value)}) não ${totals.withoutItems.sales === 1 ? "entra" : "entram"} no ranking.` : "",
              totals.withoutValue.sales ? `${integer(totals.withoutValue.sales)} ${totals.withoutValue.sales === 1 ? "venda sem valor indicado conta" : "vendas sem valor indicado contam"} só nas unidades (${units(totals.withoutValue.units)}).` : "",
              `Nome e foto do site quando a referência é encontrada na loja online, também como primeira peça de um conjunto${shown.length > SKU_LOOKUP_LIMIT ? ` (procurados para as primeiras ${SKU_LOOKUP_LIMIT} peças)` : ""}. Sem nome, a peça não foi encontrada na pesquisa, o que não quer dizer que não esteja no site.`,
              failed ? "Não foi possível confirmar todas as peças na loja online: algumas aparecem só com a referência." : "",
            ].filter(Boolean).join(" ")}
          >
            <div className="table-scroll" tabIndex={0} aria-label="Ranking dos produtos">
              <table className="nums ranking-table product-ranking">
                <thead>
                  <tr>
                    {["#", "Peça", "Tipo", "Material", by === "unidades" ? "Unidades" : "Valor", "vs. anterior", "% do total", by === "unidades" ? "Valor" : "Unidades", "Valor médio", ...(store ? [] : ["Lojas"])].map((h) => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const p = site(r);
                    const total = by === "unidades" ? totals.units : totals.value;
                    return (
                      <tr key={r.key}>
                        <td><span className={`rank-badge r${Math.min(r.rank, 4)}`}>{r.rank}</span></td>
                        <td>
                          <div className="product-cell">
                            <ProductThumb image={p?.image ?? null} />
                            <div>
                              {p?.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.title}</a> : <b>{name(r)}</b>}
                              {p ? (
                                <small>
                                  Ref. {r.reference} · {p.combined ? `parte de um conjunto ${p.listed ? "à venda" : "não publicado"} no site` : p.listed ? "à venda no site" : "não publicada no site"}
                                  {p.price !== null ? ` · ${currency(p.price)}` : ""}
                                </small>
                              ) : !r.reference ? (
                                <small>Sem referência registada</small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>{label(options, "product_type", r.type)}</td>
                        <td>{label(options, "material", r.material)}</td>
                        <td>{unknown(r) ? valueText(r) : <BarValue value={metric(r)} max={max}>{by === "unidades" ? integer(r.units) : valueText(r)}</BarValue>}</td>
                        <td><Change a={metric(r) || null} b={rankBefore(r, by)} /></td>
                        <td>{total && !unknown(r) ? percent((metric(r) / total) * 100) : "—"}</td>
                        <td>{by === "unidades" ? valueText(r) : integer(r.units)}</td>
                        <td>{rankAverage(r, currency)}</td>
                        {!store && <td title={r.stores.map((id) => storeName.get(id) || "").filter(Boolean).join(", ")}>{integer(r.stores.length)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > TOP && (
              <p className="ranking-more">
                {all ? <Link href={link({ todos: null })}>Mostrar só as {TOP} primeiras</Link> : <Link href={link({ todos: "1" })}>Ver todas as {integer(rows.length)} peças →</Link>}
              </p>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}

function ProductThumb({ image }: { image: string | null }) {
  return image ? <img className="product-thumb" src={image} alt="" loading="lazy" width={40} height={40} /> : <span className="product-thumb empty" aria-hidden="true" />;
}
