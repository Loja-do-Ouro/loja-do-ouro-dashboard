import "server-only";
import { cache } from "react";
import { groupOptions, type Option } from "./store-records";
import { rpc } from "./supabase";
import type { Viewer } from "./viewer";

// Option lists for the store forms, read once per request.
export const loadOptions = cache(async (session: string) => groupOptions((await rpc<Option[] | null>("ldo_list_options", { p_session: session })) || []));

export function activeOptions(options: ReturnType<typeof groupOptions>) {
  const out = {} as typeof options;
  for (const [list, rows] of Object.entries(options)) out[list as keyof typeof options] = rows.filter((o) => o.active);
  return out;
}

// The store chosen in the address (?loja=code), else the first one the person can open.
export function pickStore(viewer: Viewer, code: unknown) {
  return viewer.stores.find((s) => s.code === code) || viewer.stores[0];
}
