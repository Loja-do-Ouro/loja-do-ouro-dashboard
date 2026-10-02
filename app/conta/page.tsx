import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { changePassword } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "A minha conta · Loja do Ouro" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ allowPasswordChange: true });
  const q = await searchParams;
  const first = viewer.mustChangePassword;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;

  return (
    <AppShell viewer={viewer} current="conta" title="A minha conta">
      <PageHeading
        eyebrow="CONTA"
        title={first ? "Escolha a sua palavra-passe" : "A minha conta"}
        text={first ? "Está a usar uma palavra-passe temporária. Escolha uma nova para continuar." : `Utilizador: ${viewer.username}`}
      />
      <Flash ok={q.ok ? "Palavra-passe alterada. As outras sessões abertas foram terminadas." : undefined} error={error} />
      <div className="two-col sales-entry">
        <Panel title="Mudar palavra-passe" eyebrow="SEGURANÇA" note="Pelo menos 8 caracteres. Mudar a palavra-passe termina as sessões abertas noutros computadores.">
          <form action={changePassword} className="form-grid">
            <input type="hidden" name="username" value={viewer.username} autoComplete="username" />
            <label className="wide">
              Palavra-passe atual
              <input name="current_password" type="password" required autoComplete="current-password" />
            </label>
            <label>
              Nova palavra-passe
              <input name="new_password" type="password" required minLength={8} autoComplete="new-password" />
            </label>
            <label>
              Repetir a nova palavra-passe
              <input name="confirm_password" type="password" required minLength={8} autoComplete="new-password" />
            </label>
            <div className="wide form-actions">
              <button type="submit">Guardar palavra-passe</button>
            </div>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
