import Link from "next/link";
import { siteBase } from "@/lib/leilao/site";
import { ResetRequestForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recuperar palavra-passe" };

export default async function ResetRequestPage() {
  const base = await siteBase();
  return (
    <div className="lx-wrap lx-auth">
      <div className="lx-card lx-card-pad">
        <span className="lx-eyebrow">A sua conta</span>
        <h1>Recuperar palavra-passe</h1>
        <p className="lx-muted lx-small">Indique o email da conta. Enviamos uma ligação para escolher uma nova palavra-passe.</p>
        <ResetRequestForm />
        <div className="lx-auth-links" style={{ marginTop: 16 }}><Link href={`${base}/conta/entrar`}>Voltar à entrada</Link></div>
      </div>
    </div>
  );
}
