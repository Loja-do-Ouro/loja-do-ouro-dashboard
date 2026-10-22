import { redirect } from "next/navigation";
import { canManageAuction, homePath } from "@/lib/permissions";
import { aucCustomers } from "@/lib/leilao/db";
import { CUSTOMER_LEVEL, lisbonDateTime } from "@/lib/leilao-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { updateCustomer } from "../actions";
import { auctionMessage } from "../messages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes do leilão · Loja do Ouro" };

export default async function AuctionCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManageAuction(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const customers = await aucCustomers(viewer.session, q).catch(() => null);

  return (
    <AppShell viewer={viewer} current="leilao-clientes" title="Clientes do leilão">
      <PageHeading eyebrow="LEILÃO" title="Clientes do leilão" text="Contas do site do leilão: verificação de identidade, níveis, bloqueios e funcionários (que não podem licitar)." />
      <Flash ok={auctionMessage(sp.ok)} error={typeof sp.erro === "string" ? sp.erro.slice(0, 300) : undefined} />
      <Panel
        title={customers ? `${customers.length} ${customers.length === 1 ? "cliente" : "clientes"}` : "Clientes"}
        eyebrow="CONTAS"
        note="Registado: licita até ao limiar das regras. Verificado: identidade confirmada pela equipa (documento), licita acima. Bloqueado: termina as sessões e não licita. Funcionário: conta de funcionário ou familiar, nunca licita. No site só aparece o pseudónimo."
      >
        <form method="get" className="list-controls inline-form">
          <input name="q" defaultValue={q} placeholder="Nome, email, NIF ou pseudónimo" maxLength={100} />
          <button type="submit" className="secondary-button">Procurar</button>
        </form>
        {!customers ? (
          <div className="notice error-notice">Lista indisponível (falta a atualização da base de dados?).</div>
        ) : (
          <div className="table-scroll" tabIndex={0} aria-label="Clientes do leilão">
            <table className="left-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Conta</th>
                  <th>Atividade</th>
                  <th>Nível, funcionário e notas</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <small className="muted block">{c.email}</small>
                      <small className="muted block">{[c.phone, c.nif ? `NIF ${c.nif}` : null].filter(Boolean).join(" · ") || "—"}</small>
                    </td>
                    <td>
                      {c.alias}
                      <small className="muted block">Desde {lisbonDateTime(c.created_at)}</small>
                      <small className="muted block">{c.email_verified_at ? "Email confirmado" : "Email por confirmar"}</small>
                      {c.marketing_consent && <span className="tag gold">Aceitou marketing</span>}
                    </td>
                    <td>
                      {c.bids} licitações · {c.won} ganhos
                      <small className="muted block">{c.last_login_at ? `Último acesso ${lisbonDateTime(c.last_login_at)}` : "Ainda não entrou"}</small>
                    </td>
                    <td>
                      <form action={updateCustomer} className="form-grid compact-form">
                        <input type="hidden" name="id" value={c.id} />
                        {q && <input type="hidden" name="q" value={q} />}
                        <select name="level" defaultValue={c.level} aria-label={`Nível de ${c.name}`}>
                          {Object.entries(CUSTOMER_LEVEL).map(([k, label]) => (
                            <option key={k} value={k}>{label}</option>
                          ))}
                        </select>
                        <label className="checkbox-label"><input type="checkbox" name="is_staff" defaultChecked={c.is_staff} /> Funcionário/familiar</label>
                        <input name="notes" defaultValue={c.notes} maxLength={2000} placeholder="Notas internas (ex.: documento verificado na loja)" aria-label={`Notas sobre ${c.name}`} />
                        <button type="submit" className="secondary-button">Guardar</button>
                        {c.verified_at && <small className="muted block">Verificado {lisbonDateTime(c.verified_at)}</small>}
                      </form>
                    </td>
                  </tr>
                ))}
                {!customers.length && (
                  <tr>
                    <td colSpan={4} className="muted">{q ? "Ninguém corresponde à procura." : "Ainda não há clientes. As contas são criadas no site do leilão."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
