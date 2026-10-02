import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./session";
import { rpc } from "./supabase";
import type { Access, StoreAccess } from "./permissions";

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
  must_change_password: boolean;
  stores: StoreAccess[];
};

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
