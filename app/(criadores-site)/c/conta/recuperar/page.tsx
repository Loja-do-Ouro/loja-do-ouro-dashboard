import Link from "next/link";
import { siteBase } from "@/lib/criadores/site";
import { ResetRequestForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recuperar a palavra-passe" };

// [rev. S-B2] A resposta é sempre a mesma, tenha ou não conta. A recuperação também confirma o email e desbloqueia
// uma conta bloqueada por tentativas falhadas (rev. S-M2).
export default async function ResetRequestPage() {
  const base = await siteBase();
  return (
    <div className="cr-env">
      <div className="cr-auth">
        <p className="cr-chapeu">A sua conta</p>
        <h1 className="cr-d-l">Recuperar a palavra-passe</h1>
        <p className="cr-pequeno" style={{ marginBottom: 24 }}>
          Enviamos uma ligação para escolher uma palavra-passe nova. Serve também para confirmar o email e para desbloquear a entrada depois de muitas tentativas.
        </p>
        <ResetRequestForm />
        <div style={{ marginTop: 24 }}><Link className="cr-lig" href={`${base}/conta/entrar`}>Voltar a entrar</Link></div>
      </div>
    </div>
  );
}
