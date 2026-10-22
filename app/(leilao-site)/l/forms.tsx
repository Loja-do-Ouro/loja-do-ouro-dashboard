"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { Me } from "@/lib/leilao/site";
import {
  deleteAccountAction, loginAction, passwordAction, profileAction, registerAction, resetAction, resetRequestAction, withdrawalAction,
  type FormState,
} from "./actions";

// Formulários do site do leilão: a resposta da ação volta ao próprio formulário (erro ou confirmação) sem perder o
// que foi escrito, exceto as palavras-passe.

function Message({ state }: { state: FormState }) {
  if (state.error) return <div className="lx-alert lx-alert-err" role="alert">{state.error}</div>;
  if (state.ok) return <div className="lx-alert lx-alert-ok" role="status">{state.ok}</div>;
  return null;
}

const PASSWORD_HELP = "Pelo menos 10 caracteres, com letras e números.";

export function LoginForm({ base, next, notice }: { base: string; next: string; notice?: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="lx-form">
      {notice && !state.error && <div className="lx-alert lx-alert-ok">{notice}</div>}
      <Message state={state} />
      <input type="hidden" name="next" value={next} />
      <label className="lx-field">Email<input type="email" name="email" autoComplete="email" required defaultValue={state.values?.email} /></label>
      <label className="lx-field">Palavra-passe<input type="password" name="password" autoComplete="current-password" required /></label>
      <button className="lx-btn lx-btn-block" disabled={pending}>{pending ? "A entrar…" : "Entrar"}</button>
      <div className="lx-auth-links">
        <Link href={`${base}/conta/recuperar`}>Esqueci-me da palavra-passe</Link>
        <Link href={`${base}/conta/registo`}>Criar conta</Link>
      </div>
    </form>
  );
}

export function RegisterForm({ base }: { base: string }) {
  const [state, action, pending] = useActionState(registerAction, {});
  if (state.ok) {
    return (
      <div className="lx-form">
        <Message state={state} />
        <p className="lx-small lx-muted">Não chegou? Veja a pasta de spam ou tente entrar: se a conta ainda não estiver confirmada, enviamos nova ligação.</p>
        <Link className="lx-btn lx-btn-ghost lx-btn-block" href={`${base}/conta/entrar`}>Ir para a entrada</Link>
      </div>
    );
  }
  const v = state.values || {};
  return (
    <form action={action} className="lx-form">
      <Message state={state} />
      <label className="lx-field">Nome completo<small>Fica privado: nos leilões aparece só um pseudónimo.</small>
        <input name="name" autoComplete="name" required maxLength={120} defaultValue={v.name} />
      </label>
      <label className="lx-field">Email<input type="email" name="email" autoComplete="email" required defaultValue={v.email} /></label>
      <label className="lx-field">Telemóvel (opcional)<small>Com indicativo, ex.: +351 912 345 678. Só para o contactarmos se ganhar.</small>
        <input type="tel" name="phone" autoComplete="tel" defaultValue={v.phone} />
      </label>
      <label className="lx-field">Palavra-passe<small>{PASSWORD_HELP}</small>
        <input type="password" name="password" autoComplete="new-password" required minLength={10} />
      </label>
      <label className="lx-check"><input type="checkbox" name="adult" required /> <span>Tenho 18 anos ou mais.</span></label>
      <label className="lx-check">
        <input type="checkbox" name="terms" required />
        <span>
          Li e aceito o <Link href={`${base}/regulamento`} target="_blank">regulamento</Link> e os <Link href={`${base}/termos`} target="_blank">termos</Link>,
          incluindo a garantia de 18 meses nas peças usadas, e tomei conhecimento da <Link href={`${base}/privacidade`} target="_blank">política de privacidade</Link>.
        </span>
      </label>
      <label className="lx-check">
        <input type="checkbox" name="marketing" defaultChecked={v.marketing === "on"} />
        <span>Quero receber por email os próximos leilões e novidades da Loja do Ouro (opcional; pode cancelar a qualquer momento).</span>
      </label>
      <button className="lx-btn lx-btn-block" disabled={pending}>{pending ? "A criar conta…" : "Criar conta"}</button>
      <div className="lx-auth-links"><span className="lx-muted">Já tem conta?</span><Link href={`${base}/conta/entrar`}>Entrar</Link></div>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(resetRequestAction, {});
  return (
    <form action={action} className="lx-form">
      <Message state={state} />
      {!state.ok && (
        <>
          <label className="lx-field">Email da conta<input type="email" name="email" autoComplete="email" required defaultValue={state.values?.email} /></label>
          <button className="lx-btn lx-btn-block" disabled={pending}>{pending ? "A enviar…" : "Enviar ligação"}</button>
        </>
      )}
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetAction, {});
  return (
    <form action={action} className="lx-form">
      <Message state={state} />
      <input type="hidden" name="t" value={token} />
      <label className="lx-field">Nova palavra-passe<small>{PASSWORD_HELP}</small><input type="password" name="password" autoComplete="new-password" required minLength={10} /></label>
      <label className="lx-field">Repetir<input type="password" name="password2" autoComplete="new-password" required minLength={10} /></label>
      <button className="lx-btn lx-btn-block" disabled={pending}>{pending ? "A guardar…" : "Guardar palavra-passe"}</button>
    </form>
  );
}

export function ProfileForm({ me }: { me: Me }) {
  const [state, action, pending] = useActionState(profileAction, {});
  const locked = me.level === "verified" || me.level === "vip";
  return (
    <form action={action} className="lx-form">
      <Message state={state} />
      <div className="lx-form-2">
        <label className="lx-field">Nome completo<input name="name" required maxLength={120} defaultValue={me.name} readOnly={locked} /></label>
        <label className="lx-field">Email<input type="email" value={me.email} readOnly aria-readonly="true" /></label>
        <label className="lx-field">Telemóvel<input type="tel" name="phone" defaultValue={me.phone || ""} placeholder="+351 912 345 678" /></label>
        <label className="lx-field">NIF<small>Para a fatura.</small><input name="nif" inputMode="numeric" defaultValue={me.nif || ""} readOnly={locked} /></label>
        <label className="lx-field">Data de nascimento<input type="date" name="birth_date" defaultValue={me.birth_date || ""} /></label>
        <span />
        <label className="lx-field">Morada<input name="line1" autoComplete="address-line1" defaultValue={me.address.line1 || ""} /></label>
        <label className="lx-field">Complemento<input name="line2" autoComplete="address-line2" defaultValue={me.address.line2 || ""} /></label>
        <label className="lx-field">Código postal<input name="postal_code" autoComplete="postal-code" defaultValue={me.address.postal_code || ""} /></label>
        <label className="lx-field">Localidade<input name="city" autoComplete="address-level2" defaultValue={me.address.city || ""} /></label>
      </div>
      {locked && <p className="lx-small lx-muted" style={{ margin: 0 }}>A sua identidade foi verificada: para mudar o nome ou o NIF fale connosco.</p>}
      <label className="lx-check">
        <input type="checkbox" name="marketing" defaultChecked={me.marketing_consent} />
        <span>Quero receber por email os próximos leilões e novidades da Loja do Ouro.</span>
      </label>
      <div><button className="lx-btn" disabled={pending}>{pending ? "A guardar…" : "Guardar dados"}</button></div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordAction, {});
  return (
    <form action={action} className="lx-form">
      <Message state={state} />
      <label className="lx-field">Palavra-passe atual<input type="password" name="old" autoComplete="current-password" required /></label>
      <div className="lx-form-2">
        <label className="lx-field">Nova palavra-passe<small>{PASSWORD_HELP}</small><input type="password" name="new" autoComplete="new-password" required minLength={10} /></label>
        <label className="lx-field">Repetir<small>&nbsp;</small><input type="password" name="new2" autoComplete="new-password" required minLength={10} /></label>
      </div>
      <div><button className="lx-btn lx-btn-ghost" disabled={pending}>{pending ? "A guardar…" : "Mudar palavra-passe"}</button></div>
    </form>
  );
}

export function DeleteForm() {
  const [state, action, pending] = useActionState(deleteAccountAction, {});
  return (
    <form action={action} className="lx-form">
      <Message state={state} />
      <div className="lx-form-2">
        <label className="lx-field">Palavra-passe<input type="password" name="password" autoComplete="current-password" required /></label>
        <label className="lx-field">Escreva APAGAR<input name="confirm" autoComplete="off" required /></label>
      </div>
      <div><button className="lx-btn lx-btn-danger" disabled={pending}>{pending ? "A apagar…" : "Apagar a minha conta"}</button></div>
    </form>
  );
}

export function WithdrawalForm({ name, email }: { name?: string; email?: string }) {
  const [state, action, pending] = useActionState(withdrawalAction, {});
  if (state.ok) return <Message state={state} />;
  const v = state.values || {};
  return (
    <form action={action} className="lx-form">
      <Message state={state} />
      <div className="lx-form-2">
        <label className="lx-field">Nome<input name="name" required defaultValue={v.name ?? name} /></label>
        <label className="lx-field">Email<input type="email" name="email" required defaultValue={v.email ?? email} /></label>
        <label className="lx-field">Lote ou peça<small>Ex.: «Lote 12, anel em ouro».</small><input name="lot" required defaultValue={v.lot} /></label>
        <label className="lx-field">Data em que recebeu<small>&nbsp;</small><input type="date" name="received" defaultValue={v.received} /></label>
      </div>
      <label className="lx-field">Mensagem (opcional)<textarea name="message" maxLength={2000} defaultValue={v.message} /></label>
      <div><button className="lx-btn lx-btn-dark" disabled={pending}>{pending ? "A enviar…" : "Desistir da compra"}</button></div>
    </form>
  );
}
