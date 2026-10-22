import Link from "next/link";
import { redirect } from "next/navigation";
import { homePath } from "@/lib/permissions";
import { loadOptions } from "@/lib/records";
import type { OptionList } from "@/lib/store-records";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveOption } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listas de opções · Loja do Ouro" };

const LISTS: { list: OptionList; title: string; where: string; digital?: string }[] = [
  { list: "campaign", title: "Campanhas", where: "Vendas · “Foi por campanha?”" },
  { list: "material", title: "Materiais", where: "Vendas · artigos" },
  { list: "product_type", title: "Tipos de artigo", where: "Vendas · artigos" },
  { list: "client_type", title: "Tipos de cliente", where: "Vendas" },
  { list: "seen_where", title: "Onde viu o produto", where: "Vendas", digital: "conta como “viu online”" },
  { list: "purpose", title: "Para quem é", where: "Vendas" },
  { list: "restock", title: "Pedido de reposição", where: "Vendas" },
  { list: "no_sale_reason", title: "Motivos de não venda", where: "Vendas" },
  { list: "heard_from", title: "Como conheceu a Loja do Ouro", where: "Compra de ouro", digital: "conta como “veio pela internet”" },
];

export default async function OptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const options = await loadOptions(viewer.session);
  const current = LISTS.find((l) => l.list === q.lista) || LISTS[0];
  const rows = options[current.list];
  const editing = typeof q.codigo === "string" ? rows.find((o) => o.code === q.codigo) || null : null;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;

  return (
    <AppShell viewer={viewer} current="opcoes" title="Listas de opções">
      <PageHeading eyebrow="ADMINISTRAÇÃO" title="Listas de opções" text="As escolhas que aparecem nos formulários das lojas. Desativar uma opção esconde-a dos formulários sem mexer nos registos antigos." />
      <nav className="chips" aria-label="Escolher lista">
        {LISTS.map((l) => (
          <Link key={l.list} href={`/admin/opcoes?lista=${l.list}`} className={l.list === current.list ? "chip active" : "chip"}>{l.title}</Link>
        ))}
      </nav>
      <Flash ok={q.ok ? "Lista atualizada." : undefined} error={error} />
      <div className="two-col admin-layout">
        <Panel title={current.title} eyebrow={current.where.toUpperCase()}>
          <div className="table-scroll" tabIndex={0} aria-label={current.title}>
            <table className="left-table">
              <thead>
                <tr><th>Opção</th><th>Ordem</th><th>Estado</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.code} className={o.code === editing?.code ? "selected-row" : ""}>
                    <td>
                      {o.label}
                      {current.digital && o.digital && <span className="tag green">internet</span>}
                    </td>
                    <td>{o.sort_order}</td>
                    <td>{o.active ? <span className="pill ok">Ativa</span> : <span className="pill">Desativada</span>}</td>
                    <td><Link href={`/admin/opcoes?${new URLSearchParams({ lista: current.list, codigo: o.code })}`}>Editar</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title={editing ? `Editar “${editing.label}”` : "Nova opção"} eyebrow={current.title.toUpperCase()}>
          <form action={saveOption} className="form-grid" key={editing?.code || "nova"}>
            <input type="hidden" name="list" value={current.list} />
            <input type="hidden" name="code" value={editing?.code || ""} />
            <label className="wide">
              Nome
              <input name="label" required maxLength={80} defaultValue={editing?.label || ""} />
            </label>
            <label>
              Ordem na lista
              <input name="sort_order" inputMode="numeric" defaultValue={editing?.sort_order ?? (rows.at(-1)?.sort_order || 0) + 10} />
            </label>
            {current.digital && (
              <label className="check">
                <input type="checkbox" name="digital" defaultChecked={editing?.digital} />
                <span>{current.digital[0].toUpperCase() + current.digital.slice(1)}</span>
              </label>
            )}
            <label className="check wide">
              <input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} />
              <span>Opção ativa</span>
            </label>
            <div className="wide form-actions">
              <button type="submit">{editing ? "Guardar" : "Adicionar"}</button>
              {editing && <Link href={`/admin/opcoes?lista=${current.list}`}>Cancelar</Link>}
            </div>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
