// What each person can see and do. The database enforces the same rules
// (ldo_* functions and row level security); this only shapes the interface.

export type Level = "manager" | "store";
export type StoreAccess = { id: string; code: string; name: string; level: Level; ads_keyword?: string | null };
export type Access = { id: string; isSuper: boolean; online: boolean; stores: StoreAccess[] };

export const canSeeOnline = (a: Access) => a.isSuper || a.online;
export const managedStores = (a: Access) => a.stores.filter((s) => s.level === "manager");
export const canManageUsers = (a: Access) => a.isSuper || managedStores(a).length > 0;
export const canManageStores = (a: Access) => a.isSuper;
export const canCompareStores = (a: Access) => managedStores(a).length > 0;

// Where someone lands after signing in; null means no access at all.
export function homePath(a: Access): string | null {
  if (canSeeOnline(a)) return "/";
  if (a.stores.length) return "/lojas";
  return null;
}

// Levels a person may grant in a store: the Super Admin any, a Gestor only Loja in their stores.
export function grantableLevels(a: Access, storeId: string): Level[] {
  if (a.isSuper) return ["store", "manager"];
  return a.stores.some((s) => s.id === storeId && s.level === "manager") ? ["store"] : [];
}

export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const STORE_BACKDATE_DAYS = 31;

// Gestor corrects any record; Loja only its own record during the first 24 hours,
// and not once someone else (the Gestor) has corrected it.
export function canEditRecord(
  a: Access,
  storeId: string,
  record: { created_by: string; created_at: string; updated_by?: string | null } | null,
  now = Date.now(),
) {
  const store = a.stores.find((s) => s.id === storeId);
  if (!store) return false;
  if (store.level === "manager" || !record) return true;
  return (
    record.created_by === a.id &&
    (!record.updated_by || record.updated_by === a.id) &&
    now - Date.parse(record.created_at) < EDIT_WINDOW_MS
  );
}

export function initials(name: string | null, email: string) {
  const words = (name || email.split("@")[0]).split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] || "") + (words.length > 1 ? words.at(-1)![0] : words[0]?.[1] || "")).toUpperCase() || "LO";
}
