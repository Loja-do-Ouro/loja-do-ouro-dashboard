import Link from "next/link";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/criadores-site-rules";
import { loadCreator, siteBase } from "@/lib/criadores/site";
import { LoginForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

const NOTICE: Record<string, string> = {
  confirmado: "Email confirmado. Já pode entrar.",
  reset: "Palavra-passe guardada. Entre com a palavra-passe nova.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, q, ctx] = await Promise.all([siteBase(), searchParams, loadCreator().catch(() => null)]);
  const next = safeNext(q.next, base);
  if (ctx) redirect(next);
  return (
    <div className="cr-env">
      <div className="cr-auth">
        <p className="cr-chapeu">A sua conta</p>
        <h1 className="cr-d-l">Entrar</h1>
        <p className="cr-pequeno" style={{ marginBottom: 24 }}>A conta de criador é diferente da conta da loja online e da do leilão.</p>
        <LoginForm base={base} next={next} notice={typeof q.m === "string" ? NOTICE[q.m] : undefined} />
        <p className="cr-pequeno" style={{ marginTop: 24 }}>
          Ainda não tem conta? <Link href={`${base}/conta/registo`}>Crie-a aqui</Link>.
        </p>
      </div>
    </div>
  );
}
