import Link from "next/link";
import { redirect } from "next/navigation";
import { siteBase } from "@/lib/leilao/site";
import { serverRpc } from "@/lib/support/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar email" };

// Ligação do email de confirmação: confirma e manda para a entrada.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, q] = await Promise.all([siteBase(), searchParams]);
  const token = typeof q.t === "string" && /^[0-9a-f]{64}$/.test(q.t) ? q.t : "";
  const r = token ? await serverRpc<{ ok: boolean }>("ldo_auc_verify_email", { p_verify: token }).catch(() => null) : null;
  if (r?.ok) redirect(`${base}/conta/entrar?m=confirmado`);
  return (
    <div className="lx-wrap lx-auth">
      <div className="lx-card lx-card-pad">
        <span className="lx-eyebrow">A sua conta</span>
        <h1>Ligação expirada</h1>
        <p className="lx-muted">Esta ligação de confirmação já foi usada ou expirou (é válida 48 horas). Entre com o seu email e palavra-passe: se a conta
          ainda não estiver confirmada, enviamos uma ligação nova.</p>
        <Link className="lx-btn lx-btn-block" href={`${base}/conta/entrar`}>Entrar</Link>
      </div>
    </div>
  );
}
