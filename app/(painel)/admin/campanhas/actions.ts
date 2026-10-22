"use server";

import { redirect } from "next/navigation";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

// Super Admin: where a campaign's investment goes. "auto" returns it to the
// keyword rule (store name in the campaign name, otherwise online).
export async function saveCampaignChannel(form: FormData) {
  const viewer = await requireViewer();
  const source = String(form.get("source") || "");
  const campaign = String(form.get("campaign") || "");
  const choice = String(form.get("destino") || "auto");
  const [channel, storeId] = choice.startsWith("store:") ? ["store", choice.slice(6)] : [choice, null];
  let error = "";
  if (!viewer.isSuper) error = "Só o Super Admin pode classificar campanhas.";
  else if (!["meta", "google_ads"].includes(source) || !campaign || !["auto", "online", "shared", "store"].includes(channel)) error = "Pedido inválido.";
  else
    try {
      await rpc("ldo_save_campaign_channel", { p_session: viewer.session, p_source: source, p_campaign: campaign, p_channel: channel, p_store_id: storeId });
    } catch (e) {
      error = userMessage(e);
    }
  redirect(`/admin/campanhas?${new URLSearchParams(error ? { erro: error } : { ok: campaign })}`);
}
