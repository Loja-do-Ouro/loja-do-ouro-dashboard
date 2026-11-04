import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./session";
import { rpc } from "./supabase";
import { canManageCreators, canSeeCreatorFinance, canSeeCreators, homePath } from "./permissions";
import type { Access, CreatorsLevel, StoreAccess } from "./permissions";

export type Viewer = Access & {
  username: string;
  fullName: string | null;
  mustChangePassword: boolean;
  session: string;
};
type Me = {
  id: string;
  username: string;
  full_name: string | null;
  is_super_admin: boolean;
  online_access: boolean;
  support_access?: boolean;
  // Influenciadores (migração A): o Super Admin vem como manage; as finanças só com acesso à área.
  creators_access?: CreatorsLevel;
  creators_finance?: boolean;
  must_change_password: boolean;
  stores: StoreAccess[];
};

const CREATORS_LEVELS: readonly CreatorsLevel[] = ["none", "view", "manage"];

// Validates the session against Supabase once per request. An outage throws
// (error page) instead of logging the person out.
export const loadViewer = cache(async (): Promise<Viewer | null> => {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return null;
  const me = await rpc<Me | null>("ldo_me", { p_session: session });
  if (!me) return null;
  return {
    id: me.id,
    username: me.username,
    fullName: me.full_name,
    isSuper: me.is_super_admin,
    online: me.online_access,
    support: Boolean(me.support_access),
    // Um valor desconhecido (ou a BD ainda sem a migração) conta como sem acesso.
    creators: me.creators_access && CREATORS_LEVELS.includes(me.creators_access) ? me.creators_access : "none",
    creatorsFinance: Boolean(me.creators_finance),
    mustChangePassword: me.must_change_password,
    stores: me.stores || [],
    session,
  };
});

// Every page and action starts here. A temporary password must be changed first.
export async function requireViewer({ allowPasswordChange = false } = {}): Promise<Viewer> {
  const viewer = await loadViewer();
  if (!viewer) redirect("/api/auth/logout?error=session");
  if (viewer.mustChangePassword && !allowPasswordChange) redirect("/conta?primeiro=1");
  return viewer;
}

// Influenciadores: páginas com "view", ações que decidem com "manage", IBAN e pagamentos com "finance". Sem o
// nível, volta ao início de cada pessoa (ou sai, se não tiver acesso a nada). A BD volta a verificar em cada função.
export async function requireCreatorsViewer(need: "view" | "manage" | "finance" = "view"): Promise<Viewer> {
  const viewer = await requireViewer();
  const allowed =
    need === "manage" ? canManageCreators(viewer) : need === "finance" ? canSeeCreatorFinance(viewer) : canSeeCreators(viewer);
  if (!allowed) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  return viewer;
}
