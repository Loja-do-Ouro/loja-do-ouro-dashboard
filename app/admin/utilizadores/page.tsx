import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { canManageUsers, grantableLevels, homePath, managedStores, type Level } from "@/lib/permissions";
import { select } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveUser } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilizadores · Loja do Ouro" };

type User = {
  id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
  online_access: boolean;
  active: boolean;
  auth_user_id: string | null;
  last_login_at: string | null;
};
type Assignment = { user_id: string; store_id: string; level: Level };
type Store = { id: string; code: string; name: string; active: boolean };

const OK: Record<string, string> = {
  created: "Convite criado. Envie o endereço do dashboard à pessoa: ela entra com a conta Google deste email.",
  updated: "Alterações guardadas.",
};
const LEVEL: Record<Level, string> = { manager: "Gestor", store: "Loja" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManageUsers(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const [users, assignments, allStores] = await Promise.all([
    select<User>(viewer.token, "ldo_app_users", {
      select: "id,email,full_name,is_super_admin,online_access,active,auth_user_id,last_login_at",
      order: "active.desc,full_name.asc.nullslast,email.asc",
    }),
    select<Assignment>(viewer.token, "ldo_app_user_stores", { select: "user_id,store_id,level" }),
    select<Store>(viewer.token, "ldo_app_stores", { select: "id,code,name,active", order: "sort_order.asc,name.asc" }),
  ]);
  const storeName = new Map(allStores.map((s) => [s.id, s.name]));
  // A Gestor only assigns the stores they manage; the Super Admin every active store.
  const formStores = viewer.isSuper ? allStores.filter((s) => s.active) : managedStores(viewer);
  const filter = typeof q.loja === "string" ? q.loja : "";
  const shown = users.filter((u) => !filter || assignments.some((a) => a.user_id === u.id && a.store_id === filter));
  const editing = typeof q.id === "string" ? users.find((u) => u.id === q.id) || null : null;
  const isNew = !editing;
  const levels = new Map(assignments.filter((a) => a.user_id === editing?.id).map((a) => [a.store_id, a.level]));
  const host = (await headers()).get("host");
  const address = host ? `https://${host}` : "o endereço do dashboard";
  const ok = typeof q.ok === "string" ? OK[q.ok] : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  const self = editing?.id === viewer.id;

  return (
    <AppShell viewer={viewer} current="utilizadores" title="Utilizadores">
      <PageHeading
        eyebrow="ADMINISTRAÇÃO"
        title="Utilizadores"
        text={viewer.isSuper ? "Convidar pessoas e definir o que cada uma pode ver e fazer." : "Convidar e gerir os utilizadores de nível Loja nas lojas que gere."}
      >
        <Link className="outline-button" href="/admin/utilizadores?novo=1">+ Novo utilizador</Link>
      </PageHeading>
      <Flash ok={ok} error={error} />
      <div className="two-col admin-layout">
        <Panel title={`${shown.length} ${shown.length === 1 ? "utilizador" : "utilizadores"}`} eyebrow="ACESSOS">
          {formStores.length > 1 && (
            <form method="get" className="inline-form">
              <label>
                Filtrar por loja
                <select name="loja" defaultValue={filter}>
                  <option value="">Todas</option>
                  {formStores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="secondary-button">Filtrar</button>
            </form>
          )}
          <div className="table-scroll" tabIndex={0} aria-label="Lista de utilizadores">
            <table className="left-table">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  <th>Acessos</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const mine = assignments.filter((a) => a.user_id === u.id);
                  return (
                    <tr key={u.id} className={u.id === editing?.id ? "selected-row" : ""}>
                      <td>
                        {u.full_name || "—"}
                        <small className="muted block">{u.email}</small>
                      </td>
                      <td>
                        {u.is_super_admin && <span className="tag gold">Super Admin</span>}
                        {u.online_access && !u.is_super_admin && <span className="tag">Loja Online</span>}
                        {mine.map((a) => (
                          <span key={a.store_id} className={a.level === "manager" ? "tag green" : "tag"}>
                            {LEVEL[a.level]} · {storeName.get(a.store_id) || "Loja"}
                          </span>
                        ))}
                        {!u.is_super_admin && !u.online_access && !mine.length && <span className="muted">Sem acessos</span>}
                      </td>
                      <td>
                        {!u.active ? <span className="pill">Desativado</span> : !u.auth_user_id ? <span className="pill warn">Convite pendente</span> : <span className="pill ok">Ativo</span>}
                        {u.last_login_at && <small className="muted block">Último acesso {timestamp(u.last_login_at)}</small>}
                      </td>
                      <td>
                        <Link href={`/admin/utilizadores?${new URLSearchParams({ id: u.id, ...(filter ? { loja: filter } : {}) })}`}>Editar</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title={isNew ? "Convidar utilizador" : `Editar ${editing.full_name || editing.email}`} eyebrow={isNew ? "NOVO" : "UTILIZADOR"}>
          <form action={saveUser} className="form-grid" key={editing?.id || "novo"}>
            <input type="hidden" name="user_id" value={editing?.id || ""} />
            <label className="wide">
              Email da conta Google
              <input name="email" type="email" required autoComplete="off" defaultValue={editing?.email || (typeof q.email === "string" ? q.email : "")} />
            </label>
            <label className="wide">
              Nome
              <input name="full_name" maxLength={120} autoComplete="off" defaultValue={editing?.full_name || (typeof q.nome === "string" ? q.nome : "")} />
            </label>
            {viewer.isSuper && (
              <fieldset className="wide checks">
                <legend>Acessos gerais</legend>
                <label className="check">
                  <input type="checkbox" name="is_super_admin" defaultChecked={editing?.is_super_admin} />
                  <span><strong>Super Admin</strong> — vê tudo, gere lojas e utilizadores, dá qualquer acesso.</span>
                </label>
                <label className="check">
                  <input type="checkbox" name="online_access" defaultChecked={editing?.online_access} />
                  <span><strong>Loja Online</strong> — Shopify, campanhas, redes sociais, públicos e qualidade dos dados.</span>
                </label>
              </fieldset>
            )}
            <fieldset className="wide">
              <legend>Lojas físicas</legend>
              <p className="field-help">
                <strong>Loja</strong>: vê o histórico e lança as vendas diárias. <strong>Gestor</strong>: vê e compara as lojas, corrige registos e gere os utilizadores de nível Loja.
                {viewer.isSuper && " Chefe de vendas = Gestor em todas as lojas."}
              </p>
              <div className="store-levels">
                {formStores.map((s) => {
                  const options = grantableLevels(viewer, s.id);
                  return (
                    <label key={s.id}>
                      <span>{s.name}</span>
                      <select name={`loja:${s.id}`} defaultValue={levels.get(s.id) || ""}>
                        <option value="">Sem acesso</option>
                        {options.map((l) => (
                          <option key={l} value={l}>{LEVEL[l]}</option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="check wide">
              <input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} />
              <span>Conta ativa (desmarque para retirar todo o acesso sem apagar o histórico)</span>
            </label>
            <div className="wide form-actions">
              <button type="submit" disabled={self && !viewer.isSuper}>{isNew ? "Criar convite" : "Guardar alterações"}</button>
              {isNew && <small>Depois de criar, envie à pessoa o endereço {address} e peça-lhe para entrar com “Entrar com Google”.</small>}
              {editing && !editing.auth_user_id && editing.active && <small>Convite pendente: a pessoa ainda não entrou. Endereço a enviar: {address}</small>}
            </div>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
