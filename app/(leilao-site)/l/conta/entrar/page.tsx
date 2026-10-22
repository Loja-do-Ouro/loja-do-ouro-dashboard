import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/leilao-site-rules";
import { aucMe, auctionSession, siteBase } from "@/lib/leilao/site";
import { LoginForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

const NOTICE: Record<string, string> = {
  reset: "Palavra-passe guardada. Entre com a nova palavra-passe.",
  confirmado: "Email confirmado. Já pode entrar e licitar.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, q, session] = await Promise.all([siteBase(), searchParams, auctionSession()]);
  const next = safeNext(q.next, base);
  if (session && (await aucMe(session).catch(() => null))) redirect(next);
  return (
    <div className="lx-wrap lx-auth">
      <div className="lx-card lx-card-pad">
        <span className="lx-eyebrow">A sua conta</span>
        <h1>Entrar</h1>
        <LoginForm base={base} next={next} notice={typeof q.m === "string" ? NOTICE[q.m] : undefined} />
      </div>
      <p className="lx-small lx-muted" style={{ textAlign: "center", marginTop: 18 }}>
        A conta do leilão é diferente da conta da loja online. <Link href={`${base}/como-funciona`}>Saber mais</Link>
      </p>
    </div>
  );
}
