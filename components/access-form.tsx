"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { checkAccess, createPassword, type AccessInfo } from "@/app/(painel)/acesso/actions";

const REASONS: Record<string, string> = {
  missing: "Este endereço está incompleto. Abra de novo o link que recebeu por email (se o copiou, copie-o inteiro).",
  incomplete: "Este endereço está incompleto. Abra de novo o link que recebeu por email (se o copiou, copie-o inteiro).",
  invalid: "Este link já não é válido: foi substituído por um mais recente ou anulado. Peça ao administrador que lhe envie um novo acesso.",
  used: "Este link já foi usado. Entre com o seu nome de utilizador e a palavra-passe que escolheu.",
  expired: "Este link expirou (era válido 48 horas). Peça ao administrador que lhe envie um novo acesso.",
  locked: "Demasiadas tentativas falhadas. Aguarde 15 minutos antes de tentar novamente.",
  unavailable: "Não foi possível verificar o link. Tente novamente dentro de momentos.",
};

// O token chega depois de "#" no link do email: lê-se aqui, no browser, e sai logo da barra de endereço.
export function AccessForm() {
  const [token, setToken] = useState("");
  const [info, setInfo] = useState<AccessInfo | { ok: false; reason: "missing" } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const tokenRef = useRef("");

  useEffect(() => {
    // Também quando se cola um link novo no mesmo separador (só muda o "#").
    const read = () => {
      const t = window.location.hash.slice(1);
      if (t) {
        tokenRef.current = t;
        window.history.replaceState(null, "", window.location.pathname);
      }
      if (!tokenRef.current) return setInfo({ ok: false, reason: "missing" });
      setToken(tokenRef.current);
      setInfo(null);
      setError("");
      checkAccess(tokenRef.current).then(setInfo, () => setInfo({ ok: false, reason: "unavailable" }));
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  if (!info) return <p className="login-info" role="status">A verificar o link…</p>;
  if (!info.ok)
    return (
      <>
        <div className="login-error" role="alert">{REASONS[info.reason] || REASONS.invalid}</div>
        <a className="secondary-button access-login" href="/login">Ir para a página de entrada</a>
      </>
    );

  const submit = (form: FormData) =>
    start(async () => {
      setError("");
      const r = await createPassword(token, String(form.get("password") || ""), String(form.get("confirm") || ""));
      if (r && !r.ok) setError(r.error);
    });

  return (
    <>
      <div className="login-copy">
        <h1>{info.full_name ? `Olá, ${info.full_name.trim().split(/\s+/)[0]}` : "Criar palavra-passe"}</h1>
        <p>Escolha a palavra-passe para entrar na área de gestão. Este link é válido uma única vez.</p>
      </div>
      {error && <div className="login-error" role="alert">{error}</div>}
      <form className="login-form" action={submit}>
        <label>
          Utilizador
          <input name="username" autoComplete="username" value={info.username} readOnly />
        </label>
        <label>
          Nova palavra-passe (mínimo 8 caracteres)
          <input name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus />
        </label>
        <label>
          Repita a palavra-passe
          <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </label>
        <button type="submit" disabled={pending}>{pending ? "A guardar…" : "Guardar e entrar"}</button>
      </form>
    </>
  );
}
