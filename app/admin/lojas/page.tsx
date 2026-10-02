import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageStores, homePath } from "@/lib/permissions";
import { select } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveStore } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lojas · Loja do Ouro" };

type Store = { id: string; code: string; name: string; city: string | null; active: boolean; sort_order: number };
type Assignment = { store_id: string; level: "manager" | "store" };
const OK: Record<string, string> = { created: "Loja criada.", updated: "Loja atualizada." };

export default async function StoresAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManageStores(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const [stores, assignments] = await Promise.all([
    select<Store>(viewer.token, "ldo_app_stores", { select: "id,code,name,city,active,sort_order", order: "sort_order.asc,name.asc" }),
    select<Assignment>(viewer.token, "ldo_app_user_stores", { select: "store_id,level" }),
  ]);
  const editing = typeof q.id === "string" ? stores.find((s) => s.id === q.id) || null : null;
  const count = (id: string, level: Assignment["level"]) => assignments.filter((a) => a.store_id === id && a.level === level).length;
  const ok = typeof q.ok === "string" ? OK[q.ok] : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  const nextOrder = (stores.at(-1)?.sort_order || 0) + 10;

  return (
    <AppShell viewer={viewer} current="admin-lojas" title="Lojas">
      <PageHeading eyebrow="ADMINISTRAÇÃO" title="Lojas físicas" text="Lojas disponíveis para lançamento de vendas e atribuição de utilizadores.">
        <Link className="outline-button" href="/admin/lojas?novo=1">+ Nova loja</Link>
      </PageHeading>
      <Flash ok={ok} error={error} />
      <div className="two-col admin-layout">
        <Panel title={`${stores.length} lojas`} eyebrow="LISTA" note="Desativar uma loja esconde-a das listas e impede novos lançamentos; o histórico mantém-se.">
          <div className="table-scroll" tabIndex={0} aria-label="Lista de lojas">
            <table className="left-table">
              <thead>
                <tr>
                  <th>Loja</th>
                  <th>Cidade</th>
                  <th>Utilizadores</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.id} className={s.id === editing?.id ? "selected-row" : ""}>
                    <td>
                      {s.name}
                      <small className="muted block">{s.code}</small>
                    </td>
                    <td>{s.city || "—"}</td>
                    <td>
                      {count(s.id, "manager")} gestores · {count(s.id, "store")} loja
                    </td>
                    <td>{s.active ? <span className="pill ok">Ativa</span> : <span className="pill">Desativada</span>}</td>
                    <td>
                      <Link href={`/admin/lojas?id=${s.id}`}>Editar</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title={editing ? `Editar ${editing.name}` : "Nova loja"} eyebrow={editing ? "LOJA" : "NOVA"}>
          <form action={saveStore} className="form-grid" key={editing?.id || "nova"}>
            <input type="hidden" name="store_id" value={editing?.id || ""} />
            <label className="wide">
              Nome
              <input name="name" required maxLength={80} defaultValue={editing?.name || ""} />
            </label>
            <label>
              Cidade
              <input name="city" maxLength={80} defaultValue={editing?.city || ""} />
            </label>
            <label>
              Ordem nas listas
              <input name="sort_order" inputMode="numeric" defaultValue={editing?.sort_order ?? nextOrder} />
            </label>
            <label className="wide">
              Código (aparece nos endereços; se ficar vazio é criado a partir do nome)
              <input name="code" maxLength={40} pattern="[a-z0-9\-]*" defaultValue={editing?.code || ""} />
            </label>
            <label className="check wide">
              <input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} />
              <span>Loja ativa</span>
            </label>
            <div className="wide form-actions">
              <button type="submit">{editing ? "Guardar alterações" : "Criar loja"}</button>
            </div>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
