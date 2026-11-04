import { siteBase } from "@/lib/criadores/site";
import { ResetForm } from "../../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nova palavra-passe", referrer: "no-referrer" };

// Ligação do email de recuperação (e de «Não fui eu» no IBAN): /conta/nova-palavra-passe#t=… [rev. S-B11]. O GET não
// chama a BD; o token é lido do fragmento no browser e segue no POST.
export default async function NewPasswordPage() {
  const base = await siteBase();
  return (
    <div className="cr-env">
      <div className="cr-auth">
        <p className="cr-chapeu">A sua conta</p>
        <h1 className="cr-d-l">Nova palavra-passe</h1>
        <p className="cr-pequeno" style={{ marginBottom: 24 }}>Ao guardar, terminamos as sessões abertas noutros dispositivos.</p>
        <ResetForm base={base} />
      </div>
    </div>
  );
}
