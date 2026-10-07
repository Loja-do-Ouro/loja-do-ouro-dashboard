import Link from "next/link";
import { redirect } from "next/navigation";
import { canManageUsers, grantableLevels, homePath, managedStores, type Level } from "@/lib/permissions";
import { rpc } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveUser } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utilizadores · Loja do Ouro" };

type User = {
  id: string;
  username: string;
  full_name: string | null;
  is_super_admin: boolean;
  online_access: boolean;
  support_access?: boolean;
  active: boolean;
  store_access: Record<string, Level>;
  editable: boolean;
  has_password: boolean;
  must_change_password: boolean;
  locked: boolean;
  last_login_at: string | null;
  email: string | null;
  receive_reports: boolean;
};
type Store = { id: string; code: string; name: string; active: boolean };

const OK: Record<string, string> = {
  created: "Utilizador criado. Entregue à pessoa o nome de utilizador e a palavra-passe inicial.",
  updated: "Alterações guardadas.",
};
const LEVEL: Record<Level, string> = { manager: "Gestor", store: "Loja" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManageUsers(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const [users, allStores] = await Promise.all([
    rpc<User[]>("ldo_list_users", { p_session: viewer.session }),
    viewer.isSuper ? rpc<Store[]>("ldo_list_stores", { p_session: viewer.session }) : Promise.resolve([] as Store[]),
  ]);
  const storeName = new Map<string, string>([...allStores, ...viewer.stores].map((s) => [s.id, s.name]));
  // A Gestor only assigns the stores they manage; the Super Admin every active store.
  const formStores = viewer.isSuper ? allStores.filter((s) => s.active) : managedStores(viewer);
  const filter = typeof q.loja === "string" ? q.loja : "";
  const shown = users.filter((u) => !filter || u.store_access[filter]);
  // Só se abre o formulário de quem a pessoa pode editar (a BD volta a verificar ao gravar).
  const editing = typeof q.id === "string" ? users.find((u) => u.id === q.id && (u.editable || u.id === viewer.id)) || null : null;
  const ok = typeof q.ok === "string" ? OK[q.ok] : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  const self = editing?.id === viewer.id;

  return (
    <AppShell viewer={viewer} current="utilizadores" title="Utilizadores">
      <PageHeading
        eyebrow="ADMINISTRAÇÃO"
        title="Utilizadores"
        text={viewer.isSuper ? "Criar acessos e definir o que cada pessoa pode ver e fazer." : "Criar e gerir os utilizadores de nível Loja nas lojas que gere."}
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
                {shown.map((u) => (
                  <tr key={u.id} className={u.id === editing?.id ? "selected-row" : ""}>
                    <td>
                      {u.full_name || u.username}
                      <small className="muted block">{u.username}{viewer.isSuper && u.is_super_admin && u.email ? ` · ${u.receive_reports ? "recebe relatórios" : "sem relatórios"}` : ""}</small>
                    </td>
                    <td>
                      {u.is_super_admin && <span className="tag gold">Super Admin</span>}
                      {u.online_access && !u.is_super_admin && <span className="tag">Loja Online</span>}
                      {u.support_access && !u.is_super_admin && <span className="tag">Apoio ao Cliente</span>}
                      {Object.entries(u.store_access).map(([storeId, level]) => (
                        <span key={storeId} className={level === "manager" ? "tag green" : "tag"}>
                          {LEVEL[level]} · {storeName.get(storeId) || "Loja"}
                        </span>
                      ))}
                      {!u.is_super_admin && !u.online_access && !u.support_access && !Object.keys(u.store_access).length && <span className="muted">Sem acessos</span>}
                    </td>
                    <td>
                      {!u.active ? (
                        <span className="pill">Desativado</span>
                      ) : u.locked ? (
                        <span className="pill warn">Bloqueado 15 min</span>
                      ) : u.must_change_password ? (
                        <span className="pill warn">Palavra-passe temporária</span>
                      ) : (
                        <span className="pill ok">Ativo</span>
                      )}
                      {u.last_login_at && <small className="muted block">Último acesso {timestamp(u.last_login_at)}</small>}
                    </td>
                    <td>
                      {u.editable ? (
                        <Link href={`/admin/utilizadores?${new URLSearchParams({ id: u.id, ...(filter ? { loja: filter } : {}) })}`}>Editar</Link>
                      ) : (
                        <small className="muted">{u.id === viewer.id ? "Você" : "Super Admin"}</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title={editing ? `Editar ${editing.full_name || editing.username}` : "Novo utilizador"} eyebrow={editing ? "UTILIZADOR" : "NOVO"}>
          <form action={saveUser} className="form-grid" key={editing?.id || "novo"}>
            <input type="hidden" name="user_id" value={editing?.id || ""} />
            <label>
              Nome de utilizador
              <input
                name="username"
                required
                minLength={3}
                maxLength={40}
                pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,39}"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="ex.: tomar ou ana.silva"
                defaultValue={editing?.username || (typeof q.username === "string" ? q.username : "")}
              />
            </label>
            <label>
              Nome
              <input name="full_name" maxLength={120} autoComplete="off" defaultValue={editing?.full_name || (typeof q.nome === "string" ? q.nome : "")} />
            </label>
            <label className="wide">
              {editing ? "Nova palavra-passe (deixe vazio para manter a atual)" : "Palavra-passe inicial (mínimo 8 caracteres)"}
              <input name="password" type="text" minLength={8} required={!editing} autoComplete="new-password" spellCheck={false} />
            </label>
            <label className="check wide">
              <input type="checkbox" name="must_change" defaultChecked />
              <span>Pedir para mudar a palavra-passe no primeiro acesso (aplica-se quando define uma palavra-passe)</span>
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
                <label className="check">
                  <input type="checkbox" name="support_access" defaultChecked={editing?.support_access} />
                  <span><strong>Apoio ao Cliente</strong> — conversas Zendesk, Facebook e Instagram: responder, notas internas, atribuir e mudar o estado.</span>
                </label>
              </fieldset>
            )}
            {viewer.isSuper && (
              <fieldset className="wide">
                <legend>Relatórios por email</legend>
                <label>
                  Email
                  <input name="email" type="email" maxLength={160} autoComplete="off" spellCheck={false} placeholder="nome@lojadoouro.pt" defaultValue={editing?.email || ""} />
                </label>
                <label className="check">
                  <input type="checkbox" name="receive_reports" defaultChecked={editing ? editing.receive_reports : true} />
                  <span>Receber os relatórios diários, semanais e mensais e o alerta de lojas sem dados (só Super Admins com email recebem).</span>
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
                {formStores.map((s) => (
                  <label key={s.id}>
                    <span>{s.name}</span>
                    <select name={`loja:${s.id}`} defaultValue={editing?.store_access[s.id] || ""}>
                      <option value="">Sem acesso</option>
                      {grantableLevels(viewer, s.id).map((l) => (
                        <option key={l} value={l}>{LEVEL[l]}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="check wide">
              <input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} />
              <span>Conta ativa (desmarque para retirar todo o acesso sem apagar o histórico)</span>
            </label>
            <div className="wide form-actions">
              <button type="submit" disabled={self && !viewer.isSuper}>{editing ? "Guardar alterações" : "Criar utilizador"}</button>
              {self && <small>Para mudar a sua própria palavra-passe use “A minha conta”.</small>}
              {editing && !self && <small>Definir uma nova palavra-passe termina as sessões abertas dessa pessoa e desbloqueia a conta.</small>}
            </div>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
