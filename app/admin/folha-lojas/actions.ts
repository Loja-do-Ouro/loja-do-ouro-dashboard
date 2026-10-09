"use server";

import { redirect } from "next/navigation";
import { userMessage } from "@/lib/supabase";
import { sessionRpc } from "@/lib/support/db";
import { importStoreSheet, storeSheetRevoke } from "@/lib/store-sheet";
import { requireViewer } from "@/lib/viewer";

// Folha das lojas: só o Super Admin (verificado aqui e nas funções da BD).
async function superViewer() {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect("/api/auth/logout?error=noaccess");
  return viewer;
}

const back = (params: Record<string, string>): never => redirect(`/admin/folha-lojas?${new URLSearchParams(params)}`);

// "Importar agora": a mesma importação da madrugada, a pedido.
export async function importNow() {
  await superViewer();
  let message: Record<string, string>;
  try {
    const r = await importStoreSheet("manual");
    message = !r.ran ? { erro: r.reason }
      : r.status === "failed" ? { erro: `A importação falhou: ${r.detail}` }
        : { ok: `Importação concluída: ${r.changed} dia(s) atualizado(s), ${r.inserted} registo(s) gravado(s), ${r.removed} substituído(s) ou retirado(s)${r.skipped ? `, ${r.skipped} dia(s) mantidos` : ""}${r.issues ? `, ${r.issues} aviso(s)` : ""}.` };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    message = { erro: userMessage(e) };
  }
  back(message);
}

// Outra folha (o link ou só o identificador). A autorização foi dada para a folha anterior: é revogada e a
// ligação tem de ser feita de novo, o que confirma o acesso à nova folha.
export async function setSpreadsheet(form: FormData) {
  const viewer = await superViewer();
  const raw = String(form.get("spreadsheet") || "").trim();
  const id = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/.exec(raw)?.[1] || raw;
  try {
    const current = await sessionRpc<{ connection: { spreadsheet_id: string } }>(viewer.session, "ldo_store_sheet_status");
    if (current.connection.spreadsheet_id === id) back({ ok: "Essa já é a folha configurada." });
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(id)) back({ erro: "Identificador da folha inválido." });
    await storeSheetRevoke();
    await sessionRpc(viewer.session, "ldo_store_sheet_set_spreadsheet", { p_spreadsheet_id: id });
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    back({ erro: userMessage(e) });
  }
  back({ ok: "Folha guardada. Carregue em Ligar folha com uma conta com acesso a esta folha." });
}

// Desligar: revoga a autorização na Google e apaga as chaves. Os dados já importados ficam.
export async function disconnect(form: FormData) {
  const viewer = await superViewer();
  if (form.get("confirm") !== "on") back({ erro: "Confirme antes de desligar a folha." });
  try {
    await storeSheetRevoke();
    await sessionRpc(viewer.session, "ldo_store_sheet_disconnect");
  } catch (e) {
    back({ erro: userMessage(e) });
  }
  back({ ok: "Folha desligada. Os dados já importados ficam como estão." });
}
