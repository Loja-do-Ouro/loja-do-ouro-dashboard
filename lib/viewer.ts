import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE } from "./session";
import { rpc, SupabaseError } from "./supabase";
import type { Access, StoreAccess } from "./permissions";

export type Viewer = Access & { email: string; fullName: string | null; token: string };
type Me = {
  id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
  online_access: boolean;
  stores: StoreAccess[];
};

export function toViewer(me: Me, token: string): Viewer {
  return {
    id: me.id,
    email: me.email,
    fullName: me.full_name,
    isSuper: me.is_super_admin,
    online: me.online_access,
    stores: me.stores || [],
    token,
  };
}

// Validates the session token against Supabase once per request.
export const loadViewer = cache(async (): Promise<{ viewer: Viewer } | { error: "session" | "noaccess" }> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return { error: "session" };
  try {
    const me = await rpc<Me | null>(token, "ldo_me");
    return me ? { viewer: toViewer(me, token) } : { error: "noaccess" };
  } catch (e) {
    // A rejected token means signing in again; an outage shows the error page instead of logging out.
    if (e instanceof SupabaseError && (e.status === 401 || e.status === 403)) return { error: "session" };
    throw e;
  }
});

export async function requireViewer(): Promise<Viewer> {
  const result = await loadViewer();
  if ("error" in result) redirect(`/api/auth/logout?error=${result.error}`);
  return result.viewer;
}
