"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { passwordAlert, PS_PASSWORD_MAX, PS_PASSWORD_MIN } from "@/lib/private-selection-rules";

// Formulário da senha partilhada: o alerta (passwordAlert, a mesma regra do servidor) aparece antes de a senha sair do
// browser, e o envio não acontece (noValidate, para a mensagem ser esta e não a do navegador). Enquanto se escreve,
// diz quantos caracteres faltam. O servidor e a BD voltam a verificar.
export function PasswordForm({
  action, activeCount, disabled, children,
}: {
  action: (form: FormData) => Promise<void>;
  activeCount: number;
  disabled: boolean;
  children?: ReactNode;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [alert, setAlert] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const problem = passwordAlert(password, confirm);
    if (!problem.message) return setAlert("");
    // Sem envio: o React não corre a ação de um formulário com preventDefault.
    event.preventDefault();
    setAlert(problem.message);
    (problem.field === "confirm" ? confirmRef.current : passwordRef.current)?.focus();
  };

  const missing = PS_PASSWORD_MIN - password.length;
  const hint = !password
    ? `Pelo menos ${PS_PASSWORD_MIN} caracteres.`
    : missing > 0
      ? `Faltam ${missing} ${missing === 1 ? "caractere" : "caracteres"} (mínimo ${PS_PASSWORD_MIN}).`
      : password !== password.trim()
        ? "Sem espaços no início nem no fim."
        : `${password.length} caracteres.`;
  const hintBad = Boolean(password) && (missing > 0 || password !== password.trim());
  const mismatch = Boolean(confirm) && confirm !== password;

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="form-grid">
      {children}
      {alert && (
        <div role="alert" className="wide notice error-notice">
          <span>{alert}</span>
        </div>
      )}
      <label>
        Nova senha
        <input
          ref={passwordRef} name="password" type="password" required minLength={PS_PASSWORD_MIN} maxLength={PS_PASSWORD_MAX}
          autoComplete="new-password" spellCheck={false} aria-invalid={hintBad || undefined} aria-describedby="ps-password-hint"
          value={password} onChange={(e) => { setPassword(e.target.value); setAlert(""); }}
        />
        <small id="ps-password-hint" className={hintBad ? "error-text" : "muted"}>{hint}</small>
      </label>
      <label>
        Repetir a nova senha
        <input
          ref={confirmRef} name="confirm_password" type="password" required minLength={PS_PASSWORD_MIN} maxLength={PS_PASSWORD_MAX}
          autoComplete="new-password" spellCheck={false} aria-invalid={mismatch || undefined} aria-describedby="ps-confirm-hint"
          value={confirm} onChange={(e) => { setConfirm(e.target.value); setAlert(""); }}
        />
        <small id="ps-confirm-hint" className={mismatch ? "error-text" : "muted"}>{mismatch ? "Ainda não coincide com a nova senha." : " "}</small>
      </label>
      <label className="check wide">
        <input type="checkbox" name="notify_all" />
        <span>Enviar a nova senha a todos os membros ativos ({activeCount})</span>
      </label>
      <div className="wide form-actions">
        <button type="submit" disabled={disabled}>Guardar senha</button>
        <small>Pelo menos {PS_PASSWORD_MIN} caracteres. Mudar a senha termina todas as sessões abertas na loja; sem a opção acima, ninguém recebe a nova senha e os membros só voltam a entrar com Reenviar. A senha nunca é mostrada aqui.</small>
      </div>
    </form>
  );
}
