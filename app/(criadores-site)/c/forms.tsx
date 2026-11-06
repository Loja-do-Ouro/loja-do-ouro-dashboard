"use client";

import Link from "next/link";
import { createContext, useActionState, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PUBLIC_STOP_LABEL } from "@/lib/criadores-meta-rules";
import {
  CATEGORY_LABEL, CONTACT_PREFERENCE_LABEL, DISTRICTS, FORMAT_LABEL, LANGUAGE_LABEL, PLATFORM_LABEL, VAT_REGIME_LABEL,
} from "@/lib/criadores-rules";
import type { CrProfileGet, CrSocialAccount } from "@/lib/criadores/db";
import {
  acceptTermsAction, campaignNewsAction, deleteAccountAction, financeAction, ibanDecisionAction, ibanResendAction, loginAction,
  messageAction, passwordAction, privacyRequestAction, profileStepAction, publicProofAction, publicRenewAction, publicStartAction,
  publicStopAction, registerAction, resetAction, resetRequestAction, socialDeleteAction, socialSaveAction, submitProfileAction,
  verifyEmailAction, type FormState,
} from "./actions";
import { HashTokenMissing, useHashToken } from "./token-from-hash";

// Formulários do site dos criadores (componentes cliente). A resposta da ação volta ao próprio formulário (erro ou
// confirmação); num erro, o que foi escrito volta aos campos (menos as palavras-passe).
// [rev. R-B1] As caixas de consentimento são desmarcadas por omissão (defaultChecked={false}) e mostram o texto
// exato de CONSENT_TEXT, que a página calcula no servidor; o formulário só envia «on».

const PASSWORD_HELP = "Pelo menos 10 caracteres, com letras e números. Não use uma palavra-passe de outro sítio.";

// Erro ligado a um campo: o formulário que o souber (FormState.field) envolve-se em FieldErrors.Provider; o aviso
// ganha o id e o campo fica com aria-invalid e aria-describedby a apontar para ele.
const FieldErrors = createContext<{ field?: string; id?: string }>({});

// Aviso da resposta. Num erro, o foco e a vista vão para o aviso (quem carregou em «Guardar» no fundo de um formulário
// longo vê-o, e o leitor de ecrã não perde a posição); numa confirmação, só a vista.
function Message({ state }: { state: FormState }) {
  const ref = useRef<HTMLDivElement>(null);
  const { id } = useContext(FieldErrors);
  useEffect(() => {
    const el = ref.current;
    if (!el || (!state.error && !state.ok)) return;
    if (state.error) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center" });
  }, [state]);
  if (state.error) {
    return <div ref={ref} id={id} tabIndex={-1} className="cr-aviso cr-aviso-erro" role="alert"><p>{state.error}</p></div>;
  }
  if (state.ok) return <div ref={ref} tabIndex={-1} className="cr-aviso cr-aviso-ok" role="status"><p>{state.ok}</p></div>;
  return null;
}

// Valores do formulário: os da última tentativa falhada, ou os guardados.
function vals(state: FormState) {
  const v = state.values;
  const one = (x: string | string[] | undefined) => (Array.isArray(x) ? x[0] : x);
  return {
    text: (k: string, saved?: string | number | null) => (v ? one(v[k]) ?? "" : saved === null || saved === undefined ? "" : String(saved)),
    list: (k: string, saved: readonly string[] = []) => (v ? (v[k] === undefined ? [] : Array.isArray(v[k]) ? (v[k] as string[]) : [v[k] as string]) : [...saved]),
    on: (k: string, saved = false) => (v ? one(v[k]) === "on" : saved),
  };
}

// field: nome do campo no formulário; quando o erro da ação é desse campo, children recebe invalid = true e o
// describedBy inclui o aviso de erro.
function Campo({ label, help, children, className, field }: {
  label: string; help?: ReactNode; children: (id: string, describedBy?: string, invalid?: boolean) => ReactNode; className?: string; field?: string;
}) {
  const id = useId();
  const err = useContext(FieldErrors);
  const helpId = help ? `${id}-ajuda` : undefined;
  const invalid = Boolean(field && err.field === field && err.id);
  const describedBy = [invalid ? err.id : undefined, helpId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`cr-campo${className ? ` ${className}` : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children(id, describedBy, invalid || undefined)}
      {help && <span className="cr-ajuda" id={helpId}>{help}</span>}
    </div>
  );
}

// Caixa de consentimento ou declaração: uma por finalidade, desmarcada, com o tipo por baixo (§7.1, enxerto 4).
function Caixa({ name, text, kind, saved, required }: { name: string; text: ReactNode; kind: string; saved?: boolean; required?: boolean }) {
  return (
    <label className="cr-caixa">
      <input type="checkbox" name={name} defaultChecked={saved ?? false} required={required} />
      <span className="cr-txt">{text}<span className="cr-tipo">{kind}</span></span>
    </label>
  );
}

function Opcoes({ legend, name, labels, chosen, help }: { legend: string; name: string; labels: Record<string, string>; chosen: string[]; help?: string }) {
  return (
    <fieldset className="cr-fieldset">
      <legend>{legend}</legend>
      {help && <p className="cr-ajuda" style={{ marginTop: 0, marginBottom: 10 }}>{help}</p>}
      <div className="cr-opcoes">
        {Object.entries(labels).map(([value, label]) => (
          <label key={value} className="cr-opcao">
            <input type="checkbox" name={name} value={value} defaultChecked={chosen.includes(value)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Durante o envio o botão fica aria-disabled (não disabled): o foco continua no botão e um segundo clique é ignorado.
function Submit({ pending, children, busy, className = "cr-bt" }: { pending: boolean; children: ReactNode; busy: string; className?: string }) {
  return (
    <button type="submit" className={className} aria-disabled={pending || undefined}
      onClick={(e) => { if (pending) e.preventDefault(); }}>
      {pending ? busy : children}
    </button>
  );
}

// Países mais comuns (a BD aceita qualquer código ISO de 2 letras).
const COUNTRIES: [string, string][] = [
  ["PT", "Portugal"], ["ES", "Espanha"], ["FR", "França"], ["DE", "Alemanha"], ["GB", "Reino Unido"], ["IE", "Irlanda"], ["IT", "Itália"],
  ["BE", "Bélgica"], ["NL", "Países Baixos"], ["LU", "Luxemburgo"], ["CH", "Suíça"], ["BR", "Brasil"], ["AO", "Angola"],
  ["MZ", "Moçambique"], ["CV", "Cabo Verde"], ["US", "Estados Unidos"], ["CA", "Canadá"],
];

function CountrySelect({ id, name, value }: { id: string; name: string; value: string }) {
  const known = COUNTRIES.some(([c]) => c === value);
  return (
    <select id={id} name={name} className="cr-inp" defaultValue={value || "PT"}>
      {!known && value ? <option value={value}>{value}</option> : null}
      {COUNTRIES.map(([c, label]) => <option key={c} value={c}>{label}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------- conta

export function LoginForm({ base, next, notice }: { base: string; next: string; notice?: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  const v = vals(state);
  return (
    <form action={action} className="cr-form">
      {notice && !state.error && <div className="cr-aviso cr-aviso-ok" role="status"><p>{notice}</p></div>}
      <Message state={state} />
      <input type="hidden" name="next" value={next} />
      <Campo label="Email">{(id) => <input id={id} className="cr-inp" type="email" name="email" autoComplete="email" required defaultValue={v.text("email")} />}</Campo>
      <Campo label="Palavra-passe">{(id) => <input id={id} className="cr-inp" type="password" name="password" autoComplete="current-password" required />}</Campo>
      <Submit pending={pending} busy="A entrar…" className="cr-bt cr-bt-bloco">Entrar</Submit>
      <div className="cr-acoes" style={{ marginTop: 16 }}>
        <Link className="cr-lig" href={`${base}/conta/recuperar`}>Recuperar a palavra-passe</Link>
        <Link className="cr-lig" href={`${base}/conta/registo`}>Criar conta</Link>
      </div>
    </form>
  );
}

export function RegisterForm({ base, termsDoc, privacyDoc, texts }: {
  base: string; termsDoc: string; privacyDoc: string; texts: { adult: string; terms: string; privacy: string };
}) {
  const [state, action, pending] = useActionState(registerAction, {});
  const v = vals(state);
  if (state.ok) {
    return (
      <div className="cr-form">
        <Message state={state} />
        <p className="cr-pequeno">Já confirmou? <Link href={`${base}/conta/entrar`}>Entre na conta</Link>.</p>
      </div>
    );
  }
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="terms_doc" value={termsDoc} />
      <input type="hidden" name="privacy_doc" value={privacyDoc} />
      <Campo label="Nome" help="O seu nome civil, como no documento de identificação. Fica privado: o nome artístico indica-se depois.">
        {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" name="name" autoComplete="name" required maxLength={120} defaultValue={v.text("name")} />}
      </Campo>
      <Campo label="Email">{(id) => <input id={id} className="cr-inp" type="email" name="email" autoComplete="email" required maxLength={254} defaultValue={v.text("email")} />}</Campo>
      <Campo label="Palavra-passe" help={PASSWORD_HELP}>
        {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" type="password" name="password" autoComplete="new-password" required minLength={10} maxLength={128} />}
      </Campo>
      <div style={{ marginTop: 8 }}>
        <Caixa name="adult" text={texts.adult} kind="Obrigatório" saved={v.on("adult")} required />
        <Caixa name="terms" kind="Obrigatório" saved={v.on("terms")} required
          text={<>{texts.terms} <Link href={`${base}/termos`} target="_blank">Ler os Termos</Link></>} />
        <Caixa name="privacy" kind="Obrigatório: informação sobre os seus dados" saved={v.on("privacy")} required
          text={<>{texts.privacy} <Link href={`${base}/privacidade`} target="_blank">Ler a Política</Link></>} />
      </div>
      <div className="cr-fim">
        <span className="cr-pequeno">Enviamos um email para confirmar o endereço.</span>
        <Submit pending={pending} busy="A criar a conta…">Criar conta</Submit>
      </div>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(resetRequestAction, {});
  const v = vals(state);
  if (state.ok) return <Message state={state} />;
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <Campo label="Email da conta">{(id) => <input id={id} className="cr-inp" type="email" name="email" autoComplete="email" required defaultValue={v.text("email")} />}</Campo>
      <Submit pending={pending} busy="A enviar…" className="cr-bt cr-bt-bloco">Enviar a ligação</Submit>
    </form>
  );
}

// Nova palavra-passe com o token do #t= (rev. S-B11, S-M2: a palavra-passe passa também pelo HIBP).
export function ResetForm({ base }: { base: string }) {
  const { token, read } = useHashToken();
  const [state, action, pending] = useActionState(resetAction, {});
  if (!token) {
    return (
      <>
        <HashTokenMissing read={read} />
        {read && <Link className="cr-lig" href={`${base}/conta/recuperar`}>Pedir uma ligação nova</Link>}
      </>
    );
  }
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="token" value={token} />
      <Campo label="Nova palavra-passe" help={PASSWORD_HELP}>
        {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" type="password" name="password" autoComplete="new-password" required minLength={10} maxLength={128} />}
      </Campo>
      <Campo label="Repetir a nova palavra-passe">
        {(id) => <input id={id} className="cr-inp" type="password" name="password2" autoComplete="new-password" required minLength={10} maxLength={128} />}
      </Campo>
      <Submit pending={pending} busy="A guardar…" className="cr-bt cr-bt-bloco">Guardar a palavra-passe</Submit>
    </form>
  );
}

// Confirmar o email (rev. S-M1): o GET não chama a BD; a confirmação é um POST com a palavra-passe do registo.
export function ConfirmEmailForm({ base }: { base: string }) {
  const { token, read } = useHashToken();
  const [state, action, pending] = useActionState(verifyEmailAction, {});
  if (!token) return <HashTokenMissing read={read} />;
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="token" value={token} />
      <Campo label="Palavra-passe" help="A que escolheu no registo.">
        {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" type="password" name="password" autoComplete="current-password" required />}
      </Campo>
      <Submit pending={pending} busy="A confirmar…" className="cr-bt cr-bt-bloco">Confirmar o email</Submit>
      <p className="cr-pequeno" style={{ marginTop: 16 }}>
        Esqueceu-se da palavra-passe? <Link href={`${base}/conta/recuperar`}>Recupere-a</Link>: a recuperação também confirma o email.
      </p>
    </form>
  );
}

// Confirmar o IBAN pedido (rev. S-A1): dois POST, «Confirmar este IBAN» e «Não fui eu».
export function IbanDecisionForms() {
  const { token, read } = useHashToken();
  const [state, action, pending] = useActionState(ibanDecisionAction, {});
  useEffect(() => {
    if (state.go) window.location.replace(state.go);
  }, [state.go]);
  if (!token) return <HashTokenMissing read={read} />;
  if (state.ok) return <Message state={state} />;
  return (
    <div className="cr-form">
      <Message state={state} />
      <div className="cr-acoes">
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decisao" value="confirmar" />
          <Submit pending={pending} busy="A confirmar…">Confirmar este IBAN</Submit>
        </form>
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decisao" value="nao" />
          <Submit pending={pending} busy="A cancelar…" className="cr-bt cr-bt-perigo">Não fui eu</Submit>
        </form>
      </div>
      <p className="cr-pequeno" style={{ marginTop: 16 }}>
        «Não fui eu» apaga o IBAN pedido, termina todas as sessões da conta e pede-lhe uma palavra-passe nova.
      </p>
    </div>
  );
}

export function AcceptTermsForm({ docId, text }: { docId: string; text: string }) {
  const [state, action, pending] = useActionState(acceptTermsAction, {});
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="doc" value={docId} />
      <Caixa name="aceito" text={text} kind="Obrigatório para continuar" required />
      <div className="cr-fim">
        <span className="cr-pequeno">Até aceitar, as outras páginas da conta ficam em pausa.</span>
        <Submit pending={pending} busy="A guardar…">Aceito</Submit>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- perfil (bem-vindo e /perfil)

type Profile = CrProfileGet;

function StepFooter({ onboarding, pending, back }: { onboarding: boolean; pending: boolean; back?: string }) {
  return (
    <div className="cr-fim">
      {back ? <Link className="cr-lig" href={back}>Voltar ao passo anterior</Link> : <span />}
      <Submit pending={pending} busy="A guardar…">{onboarding ? "Guardar e continuar" : "Guardar"}</Submit>
    </div>
  );
}

export function AboutForm({ p, onboarding, back }: { p: Profile; onboarding?: boolean; back?: string }) {
  const [state, action, pending] = useActionState(profileStepAction, {});
  const v = vals(state);
  const x = p.profile;
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="step" value="about" />
      {onboarding && <input type="hidden" name="onboarding" value="1" />}
      <div className="cr-duas">
        <Campo label="Nome civil" help="Fica privado. É o nome que a equipa usa nos contratos e nos pagamentos.">
          {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" name="full_name" autoComplete="name" required maxLength={120} defaultValue={v.text("full_name", x?.full_name)} />}
        </Campo>
        <Campo label="Nome artístico (opcional)" help="Como assina nas redes, se for diferente.">
          {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" name="display_name" maxLength={80} defaultValue={v.text("display_name", x?.display_name)} />}
        </Campo>
        <Campo label="Cidade">
          {(id) => <input id={id} className="cr-inp" name="city" autoComplete="address-level2" required maxLength={100} defaultValue={v.text("city", x?.city)} />}
        </Campo>
        <Campo label="Distrito ou região (opcional)">
          {(id) => (
            <select id={id} className="cr-inp" name="district" defaultValue={v.text("district", x?.district)}>
              <option value="">—</option>
              {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </Campo>
        <Campo label="País">{(id) => <CountrySelect id={id} name="country" value={v.text("country", x?.country || "PT")} />}</Campo>
      </div>
      <Campo label="Apresentação (opcional)" help="Em poucas linhas: o que publica e para quem. Até 1500 caracteres.">
        {(id, d) => <textarea id={id} aria-describedby={d} className="cr-inp" name="bio" maxLength={1500} defaultValue={v.text("bio", x?.bio)} />}
      </Campo>
      <Opcoes legend="Idiomas em que publica" name="languages" labels={LANGUAGE_LABEL} chosen={v.list("languages", x?.languages?.length ? x.languages : ["pt"])} />
      <StepFooter onboarding={Boolean(onboarding)} pending={pending} back={back} />
    </form>
  );
}

export function ContactsForm({ p, onboarding, back }: { p: Profile; onboarding?: boolean; back?: string }) {
  const [state, action, pending] = useActionState(profileStepAction, {});
  const v = vals(state);
  const k = p.contacts;
  const preferred = v.text("preferred", k?.preferred || "email");
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="step" value="contacts" />
      {onboarding && <input type="hidden" name="onboarding" value="1" />}
      <Campo label="Telemóvel" help="Com o indicativo do país, por exemplo +351 912 345 678. Só a equipa o vê.">
        {(id, d) => <input id={id} aria-describedby={d} className="cr-inp cr-num" type="tel" name="phone" autoComplete="tel" required maxLength={30} defaultValue={v.text("phone", k?.phone)} />}
      </Campo>
      <label className="cr-opcao" style={{ borderTop: "1px solid var(--cr-fio)", marginBottom: 22 }}>
        <input type="checkbox" name="whatsapp" defaultChecked={v.on("whatsapp", Boolean(k?.whatsapp))} />
        <span>Tenho WhatsApp neste número</span>
      </label>
      <fieldset className="cr-fieldset">
        <legend>Como prefere que a equipa o contacte?</legend>
        <div className="cr-opcoes">
          {Object.entries(CONTACT_PREFERENCE_LABEL).map(([value, label]) => (
            <label key={value} className="cr-opcao">
              <input type="radio" name="preferred" value={value} defaultChecked={preferred === value} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <StepFooter onboarding={Boolean(onboarding)} pending={pending} back={back} />
    </form>
  );
}

export function ContentForm({ p, onboarding, back }: { p: Profile; onboarding?: boolean; back?: string }) {
  const [state, action, pending] = useActionState(profileStepAction, {});
  const v = vals(state);
  const x = p.profile;
  const stores = Object.fromEntries(p.available_stores.map((s) => [s.id, s.city && !s.name.includes(s.city) ? `${s.name} (${s.city})` : s.name]));
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="step" value="content" />
      {onboarding && <input type="hidden" name="onboarding" value="1" />}
      <Opcoes legend="Temas sobre que publica" name="categories" labels={CATEGORY_LABEL} chosen={v.list("categories", x?.categories)} help="Escolha os que mais se aproximam. Até 12." />
      <Opcoes legend="Formatos que faz" name="formats" labels={FORMAT_LABEL} chosen={v.list("formats", x?.formats)} />
      {p.available_stores.length > 0 && (
        <Opcoes legend="Lojas onde pode ir (opcional)" name="store_ids" labels={stores} chosen={v.list("store_ids", p.store_ids)}
          help="Para sessões fotográficas e eventos nas lojas da Loja do Ouro." />
      )}
      <div className="cr-duas">
        <Campo label="Até onde se desloca, em km (opcional)">
          {(id) => <input id={id} className="cr-inp cr-num" name="travel_radius_km" inputMode="numeric" maxLength={3} defaultValue={v.text("travel_radius_km", x?.travel_radius_km)} />}
        </Campo>
        <Campo label="Portefólio (opcional)" help="Endereço completo, a começar por https://">
          {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" type="url" name="portfolio_url" maxLength={300} placeholder="https://" defaultValue={v.text("portfolio_url", x?.portfolio_url)} />}
        </Campo>
      </div>
      <StepFooter onboarding={Boolean(onboarding)} pending={pending} back={back} />
    </form>
  );
}

const ONBOARDING_NETWORKS = [
  { platform: "instagram", label: "Instagram", user: "Utilizador", followers: "Seguidores" },
  { platform: "tiktok", label: "TikTok", user: "Utilizador", followers: "Seguidores" },
  { platform: "youtube", label: "YouTube", user: "Canal", followers: "Subscritores" },
] as const;

// Ajuda do campo do @ do Instagram quando a conta tem a leitura dos dados públicos (Redes e passo 4 do onboarding).
const PUBLIC_HANDLE_HELP = "Mudar o @ para a leitura dos dados públicos e apaga os números lidos; depois pode autorizar de novo com o @ novo.";

// Passo 4: as redes onde publica, declaradas (ficam «não verificado» até a equipa validar). publicLayer: a conta
// Instagram já tem a leitura dos dados públicos (autorizada em Redes, o que se pode fazer antes de enviar o perfil);
// mudar o @ aqui também para a leitura e apaga os números lidos (cr_social_upsert), por isso avisa como Redes.
export function NetworksForm({ p, back, publicLayer = false }: { p: Profile; back?: string; publicLayer?: boolean }) {
  const [state, action, pending] = useActionState(profileStepAction, {});
  const v = vals(state);
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <input type="hidden" name="step" value="networks" />
      <input type="hidden" name="onboarding" value="1" />
      {ONBOARDING_NETWORKS.map((n) => {
        const a = p.social_accounts.find((s) => s.platform === n.platform);
        const help = publicLayer && n.platform === "instagram" ? PUBLIC_HANDLE_HELP : undefined;
        return (
          <fieldset className="cr-linha-rede" key={n.platform}>
            <legend className="cr-nome">{n.label}</legend>
            <Campo label={n.user} help={help}>
              {(id, d) => (
                <div className="cr-prefixo"><span aria-hidden="true">@</span>
                  <input id={id} aria-describedby={d} className="cr-inp" name={`${n.platform}_handle`} autoCapitalize="none" spellCheck={false} maxLength={120} defaultValue={v.text(`${n.platform}_handle`, a?.handle)} />
                </div>
              )}
            </Campo>
            <Campo label={n.followers}>
              {(id) => <input id={id} className="cr-inp cr-num" name={`${n.platform}_followers`} inputMode="numeric" maxLength={14} defaultValue={v.text(`${n.platform}_followers`, a?.metrics?.followers)} />}
            </Campo>
            <Campo label="Ligação para o perfil (opcional)" className="cr-url">
              {(id) => <input id={id} className="cr-inp" type="url" name={`${n.platform}_url`} maxLength={300} placeholder="https://" defaultValue={v.text(`${n.platform}_url`, a?.profile_url)} />}
            </Campo>
          </fieldset>
        );
      })}
      <p className="cr-pequeno" style={{ marginTop: 12 }}>
        Para remover uma rede ou juntar outra (Facebook, Pinterest, blogue), use a página <strong>Redes</strong> depois de enviar o perfil.
      </p>
      <StepFooter onboarding pending={pending} back={back} />
    </form>
  );
}

export function SubmitProfileForm({ text }: { text: string }) {
  const [state, action, pending] = useActionState(submitProfileAction, {});
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <Caixa name="verdade" text={text} kind="Obrigatório" required />
      <div className="cr-fim">
        <span className="cr-pequeno">Uma pessoa da equipa revê o perfil e responde por email.</span>
        <Submit pending={pending} busy="A enviar…">Enviar para revisão</Submit>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- redes (/redes)

function MetricsFields({ v, a }: { v: ReturnType<typeof vals>; a?: CrSocialAccount }) {
  const m = a?.metrics;
  return (
    <div className="cr-tres">
      <Campo label="Seguidores">{(id) => <input id={id} className="cr-inp cr-num" name="followers" inputMode="numeric" maxLength={14} defaultValue={v.text("followers", m?.followers)} />}</Campo>
      <Campo label="Visualizações médias">{(id) => <input id={id} className="cr-inp cr-num" name="avg_views" inputMode="numeric" maxLength={14} defaultValue={v.text("avg_views", m?.avg_views)} />}</Campo>
      <Campo label="Gostos médios">{(id) => <input id={id} className="cr-inp cr-num" name="avg_likes" inputMode="numeric" maxLength={14} defaultValue={v.text("avg_likes", m?.avg_likes)} />}</Campo>
      <Campo label="Comentários médios">{(id) => <input id={id} className="cr-inp cr-num" name="avg_comments" inputMode="numeric" maxLength={14} defaultValue={v.text("avg_comments", m?.avg_comments)} />}</Campo>
      <Campo label="Audiência em Portugal (%)">{(id) => <input id={id} className="cr-inp cr-num" name="pt_audience_pct" inputMode="decimal" maxLength={6} defaultValue={v.text("pt_audience_pct", m?.pt_audience_pct)} />}</Campo>
      <Campo label="Interação média (%)" help="Gostos e comentários a dividir pelos seguidores.">
        {(id, d) => <input id={id} aria-describedby={d} className="cr-inp cr-num" name="engagement_pct" inputMode="decimal" maxLength={6} defaultValue={v.text("engagement_pct", m?.engagement_pct)} />}
      </Campo>
    </div>
  );
}

// publicLayer: a conta Instagram tem a leitura dos dados públicos (autorizada, em leitura ou com erro): mudar o @ ou
// apagar a conta para a leitura e apaga os números lidos (a BD faz a purga; aqui só se avisa).
export function SocialAccountForm({ a, publicLayer = false }: { a: CrSocialAccount; publicLayer?: boolean }) {
  const [state, action, pending] = useActionState(socialSaveAction, {});
  const [delState, delAction, delPending] = useActionState(socialDeleteAction, {});
  const v = vals(state);
  const verified = a.verification === "verified";
  return (
    <>
      <form action={action} className="cr-form" aria-label={`${PLATFORM_LABEL[a.platform]} @${a.handle}`}>
        <Message state={state} />
        <input type="hidden" name="id" value={a.id} />
        <input type="hidden" name="platform" value={a.platform} />
        <div className="cr-duas">
          <Campo label="Nome de utilizador" help={publicLayer ? PUBLIC_HANDLE_HELP : undefined}>
            {(id, d) => (
              <div className="cr-prefixo"><span aria-hidden="true">@</span>
                <input id={id} aria-describedby={d} className="cr-inp" name="handle" required readOnly={verified} autoCapitalize="none" spellCheck={false} maxLength={120} defaultValue={v.text("handle", a.handle)} />
              </div>
            )}
          </Campo>
          <Campo label="Ligação para o perfil (opcional)">
            {(id) => <input id={id} className="cr-inp" type="url" name="profile_url" maxLength={300} placeholder="https://" defaultValue={v.text("profile_url", a.profile_url)} />}
          </Campo>
        </div>
        <MetricsFields v={v} a={a} />
        <div className="cr-acoes">
          <Submit pending={pending} busy="A guardar…" className="cr-bt cr-bt-pq">Guardar</Submit>
        </div>
      </form>
      {!verified && (
        <form action={delAction} className="cr-form" style={{ marginTop: 12 }} aria-label={`Apagar ${PLATFORM_LABEL[a.platform]} @${a.handle}`}>
          <Message state={delState} />
          <input type="hidden" name="id" value={a.id} />
          <Submit pending={delPending} busy="A apagar…" className="cr-lig">Apagar esta conta e os números</Submit>
          {publicLayer && <span className="cr-ajuda" style={{ marginTop: 0 }}>Também para a leitura dos dados públicos e apaga os números lidos.</span>}
        </form>
      )}
    </>
  );
}

// ---------------------------------------------------------------- dados públicos do Instagram (fase 3A, /redes)
// Dar e retirar a autorização custa o mesmo: uma caixa e um botão (art. 7.º, n.º 3, do RGPD). O texto da caixa de
// autorização é o de CONSENT_TEXT, calculado no servidor com o @ da conta; do formulário só vai o id e o «on».

export function PublicStartForm({ accountId, text }: { accountId: string; text: string }) {
  const [state, action, pending] = useActionState(publicStartAction, {});
  const v = vals(state);
  return (
    <form action={action} className="cr-form" aria-label="Autorizar a leitura dos dados públicos do Instagram">
      <Message state={state} />
      <input type="hidden" name="id" value={accountId} />
      <Caixa name="autorizo" text={text} kind="Opcional" saved={v.on("autorizo")} />
      <Submit pending={pending} busy="A guardar…">Autorizar a leitura</Submit>
    </form>
  );
}

export function PublicProofForm({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(publicProofAction, {});
  return (
    <form action={action} className="cr-form" aria-label="Confirmar a conta do Instagram">
      <Message state={state} />
      <input type="hidden" name="id" value={accountId} />
      <Submit pending={pending} busy="A ler a biografia…">Confirmar a conta</Submit>
    </form>
  );
}

export function PublicRenewForm({ accountId }: { accountId: string }) {
  const [state, action, pending] = useActionState(publicRenewAction, {});
  return (
    <form action={action} className="cr-form" aria-label="Gerar um código novo">
      <Message state={state} />
      <input type="hidden" name="id" value={accountId} />
      <Submit pending={pending} busy="A gerar…" className="cr-bt cr-bt-sec">Gerar um código novo</Submit>
    </form>
  );
}

// Sem palavra-passe: retirar a autorização não pode custar mais do que dá-la.
export function PublicStopForm({ accountId, intro }: { accountId: string; intro?: string }) {
  const [state, action, pending] = useActionState(publicStopAction, {});
  return (
    <form action={action} className="cr-form" aria-label={PUBLIC_STOP_LABEL}>
      <Message state={state} />
      {intro && <p className="cr-pequeno">{intro}</p>}
      <input type="hidden" name="id" value={accountId} />
      <Caixa name="confirmo" text="Quero parar a leitura e apagar os números lidos do Instagram." kind="Confirmação" required />
      <Submit pending={pending} busy="A apagar…" className="cr-bt cr-bt-perigo">{PUBLIC_STOP_LABEL}</Submit>
    </form>
  );
}

// «Copiar o código» (opcional: o código também se seleciona à mão). O resultado é anunciado ao leitor de ecrã.
export function CopyCode({ code }: { code: string }) {
  const [done, setDone] = useState<"" | "ok" | "erro">("");
  return (
    <span className="cr-acoes">
      <button type="button" className="cr-bt cr-bt-sec cr-bt-pq"
        onClick={() => {
          if (!navigator.clipboard) return setDone("erro");
          navigator.clipboard.writeText(code).then(() => setDone("ok"), () => setDone("erro"));
        }}>
        Copiar o código
      </button>
      {/* Dentro de .cr-lista, .cr-meta não quebra a linha (nowrap): num telemóvel estreito o texto saía da caixa. */}
      <span className="cr-meta" role="status" style={{ whiteSpace: "normal" }}>{done === "ok" ? "Copiado." : done === "erro" ? "Não foi possível copiar: selecione o código à mão." : ""}</span>
    </span>
  );
}

export function NewSocialForm({ taken }: { taken: string[] }) {
  const [state, action, pending] = useActionState(socialSaveAction, {});
  const v = vals(state);
  const free = Object.entries(PLATFORM_LABEL).filter(([p]) => !taken.includes(p));
  if (!free.length) return <p className="cr-pequeno">Já declarou uma conta em cada rede.</p>;
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <div className="cr-duas">
        <Campo label="Rede">
          {(id) => (
            <select id={id} className="cr-inp" name="platform" defaultValue={v.text("platform", free[0][0])}>
              {free.map(([p, label]) => <option key={p} value={p}>{label}</option>)}
            </select>
          )}
        </Campo>
        <Campo label="Nome de utilizador">
          {(id) => (
            <div className="cr-prefixo"><span aria-hidden="true">@</span>
              <input id={id} className="cr-inp" name="handle" required autoCapitalize="none" spellCheck={false} maxLength={120} defaultValue={v.text("handle")} />
            </div>
          )}
        </Campo>
      </div>
      <Campo label="Ligação para o perfil (opcional)">
        {(id) => <input id={id} className="cr-inp" type="url" name="profile_url" maxLength={300} placeholder="https://" defaultValue={v.text("profile_url")} />}
      </Campo>
      <MetricsFields v={v} />
      <Submit pending={pending} busy="A guardar…">Juntar a conta</Submit>
    </form>
  );
}

// ---------------------------------------------------------------- mensagens

export function MessageForm() {
  const [state, action, pending] = useActionState(messageAction, {});
  const v = vals(state);
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <Campo label="Mensagem para a equipa" help="Texto simples, sem anexos. Até 4000 caracteres.">
        {(id, d) => <textarea id={id} aria-describedby={d} className="cr-inp" name="body" required maxLength={4000} defaultValue={v.text("body")} />}
      </Campo>
      <Submit pending={pending} busy="A enviar…">Enviar</Submit>
    </form>
  );
}

// ---------------------------------------------------------------- pagamentos (F3)

export type FinanceFormData = {
  fiscal: { fiscal_name: string; nif: string; fiscal_address: string; tax_country: string; vat_regime: string; withholding_waiver: boolean; activity_code?: string | null } | null;
  hasIban: boolean;
  email: string;
};

export function FinanceForm({ data, texts }: { data: FinanceFormData; texts: { iban_owner: string; vat_exempt: string; withholding_waiver: string } }) {
  const [state, action, pending] = useActionState(financeAction, {});
  const v = vals(state);
  const f = data.fiscal;
  const vat = v.text("vat_regime", f?.vat_regime || "");
  const waiver = v.text("withholding_waiver", f ? (f.withholding_waiver ? "sim" : "nao") : "");
  const ibanOpen = Boolean(state.values?.iban) || !data.hasIban;
  const errId = useId();
  return (
    <FieldErrors.Provider value={{ field: state.error ? state.field : undefined, id: errId }}>
    <form action={action} className="cr-form">
      <Message state={state} />
      <section className="cr-bloco" aria-labelledby="t-fiscais" style={{ marginTop: 0 }}>
        <div className="cr-bloco-cab"><h2 id="t-fiscais" className="cr-d-s">Dados fiscais</h2><span className="cr-meta">Cifrados; só quem trata dos pagamentos os vê</span></div>
        <div className="cr-duas">
          <Campo label="Nome fiscal" help="Como nas Finanças." field="fiscal_name">
            {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="cr-inp" name="fiscal_name" maxLength={200} defaultValue={v.text("fiscal_name", f?.fiscal_name)} />}
          </Campo>
          <Campo label="NIF" field="nif">
            {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="cr-inp cr-num" name="nif" inputMode="numeric" maxLength={20} autoComplete="off" defaultValue={v.text("nif", f?.nif)} />}
          </Campo>
          <Campo label="País de residência fiscal">{(id) => <CountrySelect id={id} name="tax_country" value={v.text("tax_country", f?.tax_country || "PT")} />}</Campo>
          <Campo label="Código de atividade (CAE ou CIRS, opcional)" field="activity_code">
            {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="cr-inp cr-num" name="activity_code" inputMode="numeric" maxLength={10} defaultValue={v.text("activity_code", f?.activity_code)} />}
          </Campo>
        </div>
        <Campo label="Morada fiscal" field="fiscal_address">
          {(id, d, inv) => <textarea id={id} aria-describedby={d} aria-invalid={inv} className="cr-inp" name="fiscal_address" maxLength={400} style={{ minHeight: 88 }} defaultValue={v.text("fiscal_address", f?.fiscal_address)} />}
        </Campo>
        <fieldset className="cr-fieldset">
          <legend>Regime de IVA</legend>
          <div className="cr-opcoes" style={{ gridTemplateColumns: "1fr" }}>
            {Object.entries(VAT_REGIME_LABEL).map(([value, label]) => (
              <label key={value} className="cr-opcao">
                <input type="radio" name="vat_regime" value={value} defaultChecked={vat === value} />
                <span>{value === "art53" ? <>{label}. <span className="cr-pequeno">Ao escolher, declara: «{texts.vat_exempt}»</span></> : label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="cr-fieldset">
          <legend>Retenção na fonte</legend>
          <div className="cr-opcoes" style={{ gridTemplateColumns: "1fr" }}>
            <label className="cr-opcao">
              <input type="radio" name="withholding_waiver" value="sim" defaultChecked={waiver === "sim"} />
              <span>Opto pela dispensa. <span className="cr-pequeno">Ao escolher, declara: «{texts.withholding_waiver}»</span></span>
            </label>
            <label className="cr-opcao">
              <input type="radio" name="withholding_waiver" value="nao" defaultChecked={waiver === "nao"} />
              <span>Não opto pela dispensa (há retenção na fonte nos pagamentos)</span>
            </label>
          </div>
        </fieldset>
      </section>

      <section className="cr-bloco" aria-labelledby="t-iban">
        <div className="cr-bloco-cab"><h2 id="t-iban" className="cr-d-s">{data.hasIban ? "Alterar o IBAN" : "Indicar o IBAN"}</h2><span className="cr-meta">Opcional até ser selecionado numa campanha paga</span></div>
        <details open={ibanOpen}>
          <summary className="cr-lig">{data.hasIban ? "Quero indicar outro IBAN" : "Indicar o IBAN agora"}</summary>
          <div style={{ paddingTop: 12 }}>
            <p className="cr-pequeno">Depois de guardar, enviamos um email para {data.email} para confirmar. Até confirmar, continua a valer o IBAN anterior; depois, os pagamentos esperam 72 horas.</p>
            <div className="cr-duas">
              <Campo label="IBAN" help="Com o código do país, por exemplo PT50 0002 0123 1234 5678 9015 4." field="iban">
                {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="cr-inp cr-num" name="iban" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={60} defaultValue={v.text("iban")} />}
              </Campo>
              <Campo label="Titular da conta" help="Como aparece no banco." field="holder">
                {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="cr-inp" name="holder" autoComplete="off" maxLength={200} defaultValue={v.text("holder")} />}
              </Campo>
            </div>
            <Caixa name="iban_owner" text={texts.iban_owner} kind="Obrigatório para indicar o IBAN" saved={v.on("iban_owner")} />
          </div>
        </details>
      </section>

      <div className="cr-fim">
        <Campo label="A sua palavra-passe" help="Por segurança, pedimo-la sempre que muda os dados de pagamento." className="cr-sem-margem" field="password">
          {(id, d, inv) => <input id={id} aria-describedby={d} aria-invalid={inv} className="cr-inp" type="password" name="password" autoComplete="current-password" required />}
        </Campo>
        <Submit pending={pending} busy="A guardar…">Guardar os dados de pagamento</Submit>
      </div>
    </form>
    </FieldErrors.Provider>
  );
}

export function IbanResendForm() {
  const [state, action, pending] = useActionState(ibanResendAction, {});
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <Submit pending={pending} busy="A enviar…" className="cr-bt cr-bt-sec cr-bt-pq">Reenviar o email</Submit>
    </form>
  );
}

// ---------------------------------------------------------------- definições

export function CampaignNewsForm({ granted, text }: { granted: boolean; text: string }) {
  const [state, action, pending] = useActionState(campaignNewsAction, {});
  const v = vals(state);
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <Caixa name="avisos" text={text} kind="Opcional" saved={v.on("avisos", granted)} />
      <Submit pending={pending} busy="A guardar…" className="cr-bt cr-bt-sec cr-bt-pq">Guardar a escolha</Submit>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordAction, {});
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <Campo label="Palavra-passe atual">{(id) => <input id={id} className="cr-inp" type="password" name="old" autoComplete="current-password" required />}</Campo>
      <div className="cr-duas">
        <Campo label="Nova palavra-passe" help={PASSWORD_HELP}>
          {(id, d) => <input id={id} aria-describedby={d} className="cr-inp" type="password" name="new" autoComplete="new-password" required minLength={10} maxLength={128} />}
        </Campo>
        <Campo label="Repetir a nova palavra-passe">
          {(id) => <input id={id} className="cr-inp" type="password" name="new2" autoComplete="new-password" required minLength={10} maxLength={128} />}
        </Campo>
      </div>
      <Submit pending={pending} busy="A guardar…" className="cr-bt cr-bt-sec">Mudar a palavra-passe</Submit>
    </form>
  );
}

const REQUEST_KINDS: [string, string][] = [
  ["rectification", "Corrigir dados que não consigo editar"],
  ["objection", "Opor-me a um tratamento"],
  ["restriction", "Limitar o tratamento dos meus dados"],
  ["human_review", "Pedir que uma pessoa reveja uma decisão"],
  ["other", "Outro pedido sobre os meus dados"],
];

export function PrivacyRequestForm() {
  const [state, action, pending] = useActionState(privacyRequestAction, {});
  const v = vals(state);
  if (state.ok) return <Message state={state} />;
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <Campo label="Tipo de pedido">
        {(id) => (
          <select id={id} className="cr-inp" name="kind" defaultValue={v.text("kind", "rectification")}>
            {REQUEST_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
      </Campo>
      <Campo label="O que pede" help="Diga que dados ou que decisão estão em causa.">
        {(id, d) => <textarea id={id} aria-describedby={d} className="cr-inp" name="details" required minLength={10} maxLength={4000} defaultValue={v.text("details")} />}
      </Campo>
      <Submit pending={pending} busy="A enviar…" className="cr-bt cr-bt-sec">Enviar o pedido</Submit>
    </form>
  );
}

export function DeleteForm() {
  const [state, action, pending] = useActionState(deleteAccountAction, {});
  return (
    <form action={action} className="cr-form">
      <Message state={state} />
      <div className="cr-duas">
        <Campo label="Palavra-passe">{(id) => <input id={id} className="cr-inp" type="password" name="password" autoComplete="current-password" required />}</Campo>
        <Campo label="Escreva APAGAR">{(id) => <input id={id} className="cr-inp" name="confirm" autoComplete="off" autoCapitalize="characters" required />}</Campo>
      </div>
      <Submit pending={pending} busy="A apagar…" className="cr-bt cr-bt-perigo">Apagar a minha conta</Submit>
    </form>
  );
}
