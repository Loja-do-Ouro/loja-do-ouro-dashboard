import type { Metadata } from "next";
import { AccessForm } from "@/components/access-form";

export const dynamic = "force-dynamic";
// Sem Referer para fora e fora dos motores de busca.
export const metadata: Metadata = { title: "Criar palavra-passe · Loja do Ouro", referrer: "no-referrer", robots: { index: false, follow: false } };

// Link do email de acesso: a pessoa escolhe a palavra-passe e entra (app/acesso/actions.ts).
export default function AccessPage() {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <img src="/logo-loja-do-ouro.png" alt="Loja do Ouro" width="220" height="127" />
          <span>Área de gestão</span>
        </div>
        <AccessForm />
        <small>Área privada · em computadores partilhados, termine sempre a sessão no fim.</small>
      </section>
      <p className="login-foot">Loja do Ouro · Grupo · desde 2007</p>
    </main>
  );
}
