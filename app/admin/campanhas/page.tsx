import { redirect } from "next/navigation";
import { classify, DESTINATION_LABEL, type ChannelRules } from "@/lib/bi/channels";
import { localDate, shift } from "@/lib/bi/periods";
import { number } from "@/lib/bi/model";
import { readStore } from "@/lib/bi/store";
import { homePath } from "@/lib/permissions";
import { rpc } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveCampaignChannel } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Campanhas · Loja do Ouro" };

const DAYS = 60;

export default async function CampaignsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const to = shift(localDate(), -1), from = shift(to, -(DAYS - 1));
  const [store, rules] = await Promise.all([readStore(from, to), rpc<ChannelRules>("ldo_list_campaign_channels", { p_session: viewer.session })]);
  // Daily campaign detail only (closed-window copies would count twice).
  const totals = new Map<string, { source: string; campaign: string; spend: number; last: string }>();
  for (const d of store.datasets) {
    if (d.period_start !== d.period_end || !((d.source === "meta" && d.dataset === "ads") || (d.source === "google_ads" && d.dataset === "campaigns"))) continue;
    for (const r of d.rows) {
      const campaign = String(r.campaign ?? "");
      if (!campaign) continue;
      const key = `${d.source}|${campaign}`;
      const t = totals.get(key) || { source: d.source, campaign, spend: 0, last: d.period_end };
      t.spend += number(r.spend) || 0;
      if (d.period_end > t.last) t.last = d.period_end;
      totals.set(key, t);
    }
  }
  const rows = [...totals.values()]
    .filter((r) => r.spend > 0)
    .map((r) => ({ ...r, c: classify(r.source, r.campaign, rules), auto: classify(r.source, r.campaign, { ...rules, overrides: [] }) }))
    .sort((a, b) => b.spend - a.spend);
  const sum = (dest: string) => rows.filter((r) => r.c.destination === dest).reduce((a, r) => a + r.spend, 0);
  const current = (r: (typeof rows)[number]) => (r.c.rule !== "manual" ? "auto" : r.c.destination === "store" ? `store:${r.c.storeId}` : r.c.destination);
  const ok = typeof q.ok === "string" ? `Destino de “${q.ok.slice(0, 120)}” guardado.` : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;

  return (
    <AppShell viewer={viewer} current="campanhas" title="Campanhas">
      <PageHeading
        eyebrow="ADMINISTRAÇÃO"
        title="Destino do investimento em anúncios"
        text={`Separa o investimento Meta e Google entre loja online e lojas físicas. O investimento das lojas físicas não entra no orçamento nem no MER do online. Últimos ${DAYS} dias.`}
      />
      <Flash ok={ok} error={error} />
      <div className="three-col">
        <article className="kpi"><div className="eyebrow">Online</div><div className="kpi-value">{currency(sum("online"))}</div><p>Orçamento de marketing online.</p></article>
        <article className="kpi"><div className="eyebrow">Lojas físicas</div><div className="kpi-value">{currency(sum("store"))}</div><p>Orçamento do negócio físico, por loja.</p></article>
        <article className="kpi"><div className="eyebrow">Partilhado</div><div className="kpi-value">{currency(sum("shared"))}</div><p>Campanhas que servem as duas partes; ficam fora de ambos os MER.</p></article>
      </div>
      <Panel
        title={`${rows.length} campanhas com investimento`}
        eyebrow="CLASSIFICAÇÃO"
        note="Automático: a campanha com o nome de uma loja (palavra-chave em Administração → Lojas) é dessa loja; as restantes são do online. Escolha outro destino só para as exceções; a alteração aplica-se a todo o histórico e aos relatórios."
      >
        <div className="table-scroll" tabIndex={0} aria-label="Campanhas e destino">
          <table className="left-table">
            <thead>
              <tr><th>Campanha</th><th>Origem</th><th>Investimento</th><th>Destino</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.source}|${r.campaign}`}>
                  <td>{r.campaign}<small className="muted block">último dia com gasto: {r.last}</small></td>
                  <td>{r.source === "meta" ? "Meta" : "Google Ads"}</td>
                  <td>{currency(Math.round(r.spend * 100) / 100)}</td>
                  <td>
                    <form action={saveCampaignChannel} className="inline-form">
                      <input type="hidden" name="source" value={r.source} />
                      <input type="hidden" name="campaign" value={r.campaign} />
                      <select name="destino" defaultValue={current(r)} aria-label={`Destino de ${r.campaign}`}>
                        <option value="auto">Automático · {r.auto.destination === "store" ? r.auto.storeName : DESTINATION_LABEL[r.auto.destination]}</option>
                        <option value="online">Online</option>
                        <option value="shared">Partilhado</option>
                        {rules.stores.map((s) => <option key={s.id} value={`store:${s.id}`}>Loja · {s.name}</option>)}
                      </select>
                      <button type="submit" className="secondary-button">Guardar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
