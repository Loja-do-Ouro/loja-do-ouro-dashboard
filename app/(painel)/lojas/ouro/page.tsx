import Link from "next/link";
import { redirect } from "next/navigation";
import { localDate, shift, shortDate, validDate } from "@/lib/bi/periods";
import { canEditRecord, homePath, STORE_BACKDATE_DAYS } from "@/lib/permissions";
import { activeOptions, loadOptions, pickStore } from "@/lib/records";
import { count, goldTotals, KARATS, label, monthRange, OPERATIONS, shiftMonth, type GoldEntry, type GoldMonthly, type GoldOperation } from "@/lib/store-records";
import { rpcAll } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { currency, integer, percent, timestamp } from "@/components/dashboard/format";
import { Change, Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { BarValue, Breakdown, inputAmount, monthLabel, monthShort, MonthNav, Select, StoreChips, weekday, YesNo } from "@/components/stores";
import { removeGoldEntry, saveGoldEntry } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compra de ouro · Loja do Ouro" };

const OK: Record<string, string> = { saved: "Cliente registado.", updated: "Registo corrigido.", deleted: "Registo apagado." };
const grams = (v: number | null) => (v === null ? "—" : `${new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 }).format(v)} g`);

export default async function GoldPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.stores.length) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const store = pickStore(viewer, q.loja);
  const today = localDate();
  const askedDay = typeof q.dia === "string" && validDate(q.dia) && q.dia <= today ? q.dia : null;
  const { month, from, to } = monthRange(typeof q.mes === "string" && q.mes ? q.mes : askedDay?.slice(0, 7), today);
  const day = askedDay && askedDay.startsWith(month) ? askedDay : to;
  // Twelve months of history plus the same months a year earlier for comparison.
  const historyFrom = `${shiftMonth(month, -23)}-01`;
  const args = { p_session: viewer.session, p_store_id: store.id, p_from: historyFrom, p_to: to };
  const [all, entries, monthly] = await Promise.all([
    loadOptions(viewer.session),
    rpcAll<GoldEntry>("ldo_list_gold_entries", args),
    rpcAll<GoldMonthly>("ldo_list_gold_monthly", args),
  ]);
  const options = activeOptions(all);
  const monthEntries = entries.filter((e) => e.entry_date >= from && e.entry_date <= to);
  const editing = typeof q.editar === "string" ? monthEntries.find((r) => r.id === q.editar) || null : null;
  const canEdit = !editing || canEditRecord(viewer, store.id, editing);
  const manager = store.level === "manager";
  const minDate = manager ? undefined : shift(today, -STORE_BACKDATE_DAYS);
  const dayRows = monthEntries.filter((r) => r.entry_date === day);
  const period = { store_id: store.id, from, to: monthRange(month, "9999-12-31").last };
  const used = goldTotals(entries, monthly, all, { ...period, operation: "used" });
  const pawn = goldTotals(entries, monthly, all, { ...period, operation: "pawn" });
  const both = goldTotals(entries, monthly, all, period);
  const history = Array.from({ length: 12 }, (_, i) => shiftMonth(month, -i)).map((m) => {
    const r = monthRange(m, "9999-12-31");
    const p = monthRange(shiftMonth(m, -12), "9999-12-31");
    const at = (op: GoldOperation, range: { from: string; last: string }) =>
      goldTotals(entries, monthly, all, { store_id: store.id, operation: op, from: range.from, to: range.last });
    return { month: m, used: at("used", r), pawn: at("pawn", r), usedBefore: at("used", p) };
  });
  const maxValue = Math.max(...history.map((h) => h.used.totalValue));
  const link = (params: Record<string, string>) => `/lojas/ouro?${new URLSearchParams({ loja: store.code, mes: month, dia: day, ...params })}`;
  const ok = typeof q.ok === "string" ? OK[q.ok] : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;

  return (
    <AppShell viewer={viewer} current="ouro" title="Compra de ouro">
      <PageHeading
        eyebrow="LOJAS FÍSICAS"
        title={`Compra de ouro · ${store.name}`}
        text="Registe cada cliente que vem vender ouro ou fazer contrato, e como conheceu a Loja do Ouro. Substitui a folha “Eficácia das campanhas de marketing”."
      />
      <StoreChips stores={viewer.stores} current={store.id} href={(code) => `/lojas/ouro?${new URLSearchParams({ loja: code, mes: month })}`} />
      <Flash ok={ok} error={error} />
      <div className="two-col sales-entry">
        <Panel title={editing ? "Corrigir registo" : "Registar cliente"} eyebrow={editing ? `REGISTO DE ${shortDate(editing.entry_date)}` : "NOVO CLIENTE"}>
          {canEdit ? (
            <form action={saveGoldEntry} className="form-grid" key={editing?.id || `novo-${day}-${monthEntries.length}`}>
              <input type="hidden" name="record_id" value={editing?.id || ""} />
              <input type="hidden" name="store_id" value={store.id} />
              <input type="hidden" name="loja" value={store.code} />
              <input type="hidden" name="mes" value={month} />
              <input type="hidden" name="dia" value={day} />
              <label>
                Dia
                <input type="date" name="entry_date" required defaultValue={editing?.entry_date || day} max={today} min={minDate} />
              </label>
              <fieldset>
                <legend>Tipo</legend>
                <span className="yes-no">
                  {(Object.keys(OPERATIONS) as GoldOperation[]).map((op) => (
                    <label key={op}><input type="radio" name="operation" value={op} required defaultChecked={(editing?.operation || "used") === op} /> {OPERATIONS[op]}</label>
                  ))}
                </span>
              </fieldset>
              <label className="wide">
                Como conheceu a Loja do Ouro?
                <Select name="heard_from" options={options.heard_from} value={editing?.heard_from} required />
              </label>
              <fieldset className="wide">
                <legend>Fechou negócio?</legend>
                <YesNo name="closed" value={editing ? editing.closed : null} required />
              </fieldset>
              <fieldset className="wide">
                <legend>Ouro comprado (deixe vazio os quilates que não houve)</legend>
                <div className="karat-grid">
                  <span />
                  <b>Gramas</b>
                  <b>Valor pago (€)</b>
                  {KARATS.map((k) => (
                    <div className="karat-row" key={k}>
                      <span>{k} kl</span>
                      <input name={`grams_${k}`} inputMode="decimal" autoComplete="off" aria-label={`Gramas de ${k} quilates`} defaultValue={inputAmount(editing?.[`grams_${k}`])} />
                      <input name={`value_${k}`} inputMode="decimal" autoComplete="off" aria-label={`Valor pago por ${k} quilates`} defaultValue={inputAmount(editing?.[`value_${k}`])} />
                    </div>
                  ))}
                </div>
              </fieldset>
              <label className="wide">
                Observações
                <textarea name="notes" rows={2} maxLength={1000} defaultValue={editing?.notes || ""} />
              </label>
              <div className="wide form-actions">
                <button type="submit">{editing ? "Guardar correção" : "Registar cliente"}</button>
                {editing && <Link href={link({})}>Cancelar</Link>}
                {!manager && !editing && <small>Pode corrigir o que registou durante 24 horas.</small>}
              </div>
            </form>
          ) : (
            <div className="quiet-callout">Este registo já não pode ser alterado aqui. Para o corrigir, contacte o Gestor da loja.</div>
          )}
          {editing && (
            <p className="panel-note">
              Registado por {editing.created_by_name || "—"} em {timestamp(editing.created_at)}
              {editing.updated_at ? ` · corrigido por ${editing.updated_by_name || "—"} em ${timestamp(editing.updated_at)}` : ""}.
            </p>
          )}
          {editing && manager && (
            <form action={removeGoldEntry} className="danger-zone">
              <input type="hidden" name="record_id" value={editing.id} />
              <input type="hidden" name="loja" value={store.code} />
              <input type="hidden" name="mes" value={month} />
              <input type="hidden" name="dia" value={day} />
              <button type="submit" className="danger-button">Apagar este registo</button>
              <small>Fica guardado no histórico de alterações.</small>
            </form>
          )}
        </Panel>
        <Panel title="Resumo do mês" eyebrow={store.name.toUpperCase()} note={both.fromMonthly ? "Mês com totais importados do Excel (sem o detalhe por cliente)." : undefined}>
          <MonthNav month={month} today={today} href={(m) => `/lojas/ouro?${new URLSearchParams({ loja: store.code, mes: m })}`} />
          <div className="mini-stats two">
            <div><span>Clientes atendidos</span><strong>{integer(both.customers)}</strong></div>
            <div><span>Vieram pela internet</span><strong>{percent(both.digitalShare)}</strong></div>
            <div><span>Negócios fechados</span><strong>{both.closed === null ? "—" : integer(both.closed)}</strong></div>
            <div><span>Valor pago</span><strong>{currency(both.totalValue)}</strong></div>
          </div>
          <div className="table-scroll" tabIndex={0} aria-label="Ouro comprado por quilate">
            <table className="nums">
              <thead>
                <tr><th>Quilates</th><th>Usado · gramas</th><th>Usado · valor</th><th>€/g</th><th>Contrato · gramas</th><th>Contrato · valor</th></tr>
              </thead>
              <tbody>
                {KARATS.filter((k) => used.grams[k] || pawn.grams[k]).map((k) => (
                  <tr key={k}>
                    <td>{k} kl</td>
                    <td>{grams(used.grams[k] || null)}</td>
                    <td>{currency(used.value[k] || null)}</td>
                    <td>{used.grams[k] ? currency(used.value[k] / used.grams[k]) : "—"}</td>
                    <td>{grams(pawn.grams[k] || null)}</td>
                    <td>{currency(pawn.value[k] || null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!both.totalGrams && <p className="panel-note">Sem ouro comprado neste mês.</p>}
        </Panel>
      </div>
      <Panel title={`Clientes de ${shortDate(day)}`} eyebrow={weekday(day).toUpperCase()}>
        <form method="get" className="inline-form">
          <input type="hidden" name="loja" value={store.code} />
          <label>
            Ver outro dia
            <input type="date" name="dia" defaultValue={day} max={today} />
          </label>
          <button type="submit" className="secondary-button">Abrir</button>
        </form>
        <div className="table-scroll" tabIndex={0} aria-label="Clientes do dia">
          <table className="left-table">
            <thead>
              <tr>{["Tipo", "Como conheceu", "Negócio", "Gramas", "Valor pago", "Registado por", ""].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {dayRows.map((r) => {
                const g = KARATS.reduce((a, k) => a + Number(r[`grams_${k}`] || 0), 0);
                const v = KARATS.reduce((a, k) => a + Number(r[`value_${k}`] || 0), 0);
                return (
                  <tr key={r.id} className={r.id === editing?.id ? "selected-row" : ""}>
                    <td>{OPERATIONS[r.operation]}</td>
                    <td>{label(all, "heard_from", r.heard_from)}</td>
                    <td>{r.closed ? <span className="pill ok">Fechou</span> : <span className="pill">Não fechou</span>}</td>
                    <td>{g ? grams(g) : "—"}</td>
                    <td>{v ? currency(v) : "—"}</td>
                    <td>{r.created_by_name}</td>
                    <td><Link href={link({ editar: r.id })}>{canEditRecord(viewer, store.id, r) ? "Corrigir" : "Ver"}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!dayRows.length && <p className="panel-note">Ainda não há clientes registados neste dia.</p>}
      </Panel>
      <div>
        <Panel title="Como conheceram a loja" eyebrow={monthLabel(month).toUpperCase()} note="Só os clientes registados no dashboard; os meses importados têm apenas o total vindo da internet.">
          <Breakdown title="Respostas do mês" rows={count(monthEntries, (e) => e.heard_from)} options={all.heard_from} total={monthEntries.length} />
        </Panel>
        <Panel title="Últimos 12 meses" eyebrow="HISTÓRICO" note="Inclui os totais mensais importados do Excel. Comparação com o mesmo mês do ano anterior.">
          <div className="table-scroll" tabIndex={0} aria-label="Histórico mensal de compra de ouro">
            <table className="nums">
              <thead>
                <tr><th>Mês</th><th>Clientes</th><th>% internet</th><th>Gramas</th><th>Valor pago</th><th>vs. ano ant.</th><th>Contratos</th><th>Valor contratos</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.month}>
                    <td><Link href={`/lojas/ouro?${new URLSearchParams({ loja: store.code, mes: h.month })}`}>{monthShort(h.month)}</Link></td>
                    <td>{integer(h.used.customers || null)}</td>
                    <td>{percent(h.used.digitalShare)}</td>
                    <td>{grams(h.used.totalGrams || null)}</td>
                    <td><BarValue value={h.used.totalValue} max={maxValue}>{currency(h.used.totalValue || null)}</BarValue></td>
                    <td><Change a={h.used.totalValue || null} b={h.usedBefore.totalValue || null} /></td>
                    <td>{integer(h.pawn.customers || null)}</td>
                    <td>{currency(h.pawn.totalValue || null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
