import { siteBase } from "@/lib/criadores/site";
import { ConfirmEmailForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar o email", referrer: "no-referrer" };

// /conta/confirmar#t=… [rev. S-M1, S-B11]. O GET não chama a BD (um scanner de ligações não confirma nada): pede a
// palavra-passe escolhida no registo e confirma por POST.
export default async function ConfirmPage() {
  const base = await siteBase();
  return (
    <div className="cr-env">
      <div className="cr-auth">
        <p className="cr-chapeu">A sua conta</p>
        <h1 className="cr-d-l">Confirmar o email</h1>
        <p className="cr-pequeno" style={{ marginBottom: 24 }}>Para confirmar, escreva a palavra-passe que escolheu no registo.</p>
        <ConfirmEmailForm base={base} />
      </div>
    </div>
  );
}
