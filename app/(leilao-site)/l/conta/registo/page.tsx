import { redirect } from "next/navigation";
import { aucMe, auctionSession, siteBase } from "@/lib/leilao/site";
import { RegisterForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta" };

export default async function RegisterPage() {
  const [base, session] = await Promise.all([siteBase(), auctionSession()]);
  if (session && (await aucMe(session).catch(() => null))) redirect(`${base}/conta`);
  return (
    <div className="lx-wrap lx-auth">
      <div className="lx-card lx-card-pad">
        <span className="lx-eyebrow">Grátis · 1 minuto</span>
        <h1>Criar conta</h1>
        <p className="lx-muted lx-small">Com a conta confirmada pode licitar em todos os leilões. Nos leilões aparece só um pseudónimo, nunca o seu nome.</p>
        <RegisterForm base={base} />
      </div>
    </div>
  );
}
