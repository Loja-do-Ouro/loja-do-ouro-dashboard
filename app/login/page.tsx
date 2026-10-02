import { safeRedirect } from "@/lib/session";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  config: "O login ainda não está configurado no servidor.",
  invalid: "Utilizador ou palavra-passe inválidos.",
  locked: "Demasiadas tentativas falhadas. Aguarde 15 minutos antes de tentar novamente.",
  unavailable: "Não foi possível verificar o acesso. Tente novamente dentro de momentos.",
  session: "A sessão terminou. Entre novamente.",
  noaccess: "Esta conta ainda não tem acessos atribuídos. Fale com o administrador.",
  password: "Palavra-passe alterada. Entre com a nova palavra-passe.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const redirect = safeRedirect(q.redirect);
  const error = typeof q.error === "string" ? q.error : "";
  const username = typeof q.u === "string" ? q.u : "";

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark">LO</div>
        <div className="login-copy">
          <span>LOJA DO OURO</span>
          <h1>Área de administração</h1>
          <p>Entre com o utilizador e a palavra-passe que recebeu do administrador.</p>
        </div>
        {error && <div className="login-error">{ERRORS[error] || ERRORS.invalid}</div>}
        {q.ok === "logout" && !error && <div className="login-info">Sessão terminada.</div>}
        <form className="login-form" method="post" action="/api/auth/login">
          <input type="hidden" name="redirect" value={redirect} />
          <label>
            Utilizador
            <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required defaultValue={username} />
          </label>
          <label>
            Palavra-passe
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Entrar</button>
        </form>
        <small>Loja do Ouro · área privada · em computadores partilhados, termine sempre a sessão no fim.</small>
      </section>
    </main>
  );
}
