"use server";

import { redirect } from "next/navigation";
import type { ReportKind } from "@/lib/reports";
import { sendMissingAlert, sendReport } from "@/lib/report-send";
import { rpc, userMessage } from "@/lib/supabase";
import { requireViewer } from "@/lib/viewer";

const KINDS = ["daily", "weekly", "monthly", "alert"] as const;

// Super Admin only: sends a report now, either to the Super Admins or only to themselves.
export async function sendNow(form: FormData) {
  const viewer = await requireViewer();
  const kind = KINDS.find((k) => k === form.get("kind")) || "daily";
  if (!viewer.isSuper) redirect("/api/auth/logout?error=noaccess");
  let only: string[] | undefined;
  let result: { status: string; detail: string };
  try {
    if (form.get("to") === "me") {
      const users = await rpc<{ id: string; email: string | null }[]>("ldo_list_users", { p_session: viewer.session });
      const email = users.find((u) => u.id === viewer.id)?.email;
      if (!email) redirect(`/admin/relatorios?${new URLSearchParams({ ver: kind, erro: "Preencha primeiro o seu email em Utilizadores." })}`);
      only = [email];
    }
    result = kind === "alert" ? await sendMissingAlert(only) : await sendReport(kind as ReportKind, only);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    result = { status: "failed", detail: userMessage(e) };
  }
  const params: Record<string, string> = { ver: kind };
  if (result.status === "sent") params.ok = "sent";
  else params.erro = result.status === "skipped" ? `Não enviado: ${result.detail}` : `Falhou: ${result.detail}`;
  redirect(`/admin/relatorios?${new URLSearchParams(params)}`);
}
