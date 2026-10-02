import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageStores, homePath } from "@/lib/permissions";
import { rpc } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveStore } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lojas · Loja do Ouro" };

type Store = { id: string; code: string; name: string; city: string | null; active: boolean; sort_order: number; managers: number; staff: number; ads_keyword: string | null; closed_weekdays: number[] | null };
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const OK: Record<string, string> = { created: "Loja criada.", updated: "Loja atualizada." };

export default async function StoresAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManageStores(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const stores = await rpc<Store[]>("ldo_list_stores", { p_session: viewer.session });
  const editing = typeof q.id === "string" ? stores.find((s) => s.id === q.id) || null : null;
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
                      <small className="muted block">{s.code}{s.ads_keyword ? ` · Google Ads: “${s.ads_keyword}”` : " · sem campanha Google Ads"}
                        {s.closed_weekdays?.length ? ` · fecha: ${s.closed_weekdays.map((d) => WEEKDAYS[d].slice(0, 3).toLowerCase()).join(", ")}` : ""}</small>
                    </td>
                    <td>{s.city || "—"}</td>
                    <td>
                      {s.managers} {s.managers === 1 ? "gestor" : "gestores"} · {s.staff} loja
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
            <label className="wide">
              Palavra da campanha Google Ads (a campanha cujo nome a contém conta para esta loja, ex.: “FOZ”)
              <input name="ads_keyword" maxLength={40} defaultValue={editing?.ads_keyword || ""} />
            </label>
            <fieldset className="wide weekday-picker">
              <legend>Dias em que a loja está fechada (não gera alerta de falta de dados)</legend>
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="check">
                  <input type="checkbox" name="closed" value={i} defaultChecked={editing ? Boolean(editing.closed_weekdays?.includes(i)) : i === 0} />
                  <span>{d}</span>
                </label>
              ))}
            </fieldset>
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
