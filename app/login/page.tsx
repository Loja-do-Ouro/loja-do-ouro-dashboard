export const dynamic = "force-dynamic";

function safeRedirect(value?: string | string[]) {
  const v = typeof value === "string" ? value : "/";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const redirect = safeRedirect(q.redirect);
  const error = typeof q.error === "string" ? q.error : "";

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-mark">LO</div>
        <div className="login-copy">
          <span>LOJA DO OURO</span>
          <h1>Área de administração</h1>
          <p>Acesso reservado à gestão. Os dados comerciais e de marketing permanecem protegidos por sessão segura.</p>
        </div>
        {error && (
          <div className="login-error">
            {error === "config"
              ? "A autenticação ainda não está configurada no servidor."
              : error === "locked"
                ? "Demasiadas tentativas falhadas. Aguarde 15 minutos antes de tentar novamente."
                : "Utilizador ou palavra-passe inválidos."}
          </div>
        )}
        <form className="login-form" method="post" action="/api/auth/login">
          <input type="hidden" name="redirect" value={redirect} />
          <label>
            Utilizador
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            Palavra-passe
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Entrar no dashboard</button>
        </form>
        <small>Loja do Ouro · área privada</small>
      </section>
    </main>
  );
}
