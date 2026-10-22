import Link from "next/link";
import { siteBase } from "@/lib/leilao/site";
import { ResetForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nova palavra-passe" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, q] = await Promise.all([siteBase(), searchParams]);
  const token = typeof q.t === "string" && /^[0-9a-f]{64}$/.test(q.t) ? q.t : "";
  return (
    <div className="lx-wrap lx-auth">
      <div className="lx-card lx-card-pad">
        <span className="lx-eyebrow">A sua conta</span>
        <h1>Nova palavra-passe</h1>
        {token ? (
          <ResetForm token={token} />
        ) : (
          <div className="lx-form">
            <div className="lx-alert lx-alert-err">Ligação inválida. Peça uma nova.</div>
            <Link className="lx-btn lx-btn-block" href={`${base}/conta/recuperar`}>Pedir nova ligação</Link>
          </div>
        )}
      </div>
    </div>
  );
}
