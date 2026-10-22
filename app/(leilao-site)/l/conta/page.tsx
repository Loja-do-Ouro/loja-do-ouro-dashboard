import Link from "next/link";
import { redirect } from "next/navigation";
import { CUSTOMER_LEVEL, lisbonDateTime } from "@/lib/leilao-rules";
import { aucMe, aucMy, auctionSession, pubSettings, siteBase } from "@/lib/leilao/site";
import { LotCard } from "../cards";
import { DeleteForm, PasswordForm, ProfileForm } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "A minha conta" };

const TABS = [
  ["licitacoes", "Licitações e favoritos"],
  ["dados", "Os meus dados"],
  ["privacidade", "Privacidade"],
] as const;

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [base, q, session] = await Promise.all([siteBase(), searchParams, auctionSession()]);
  const me = session ? await aucMe(session).catch(() => null) : null;
  if (!me) redirect(`${base}/conta/entrar?next=${encodeURIComponent(`${base}/conta`)}`);
  const tab = TABS.some(([k]) => k === q.tab) ? (q.tab as (typeof TABS)[number][0]) : "licitacoes";
  const [my, settings] = await Promise.all([tab === "licitacoes" ? aucMy(session).catch(() => null) : null, pubSettings()]);
  const now = Date.now();
  const lots = my?.lots ?? [];
  const open = lots.filter((l) => l.status === "ready");
  const won = lots.filter((l) => l.status === "closed" && l.result === "sold" && l.me_leading);
  const past = lots.filter((l) => l.status === "closed" && !(l.result === "sold" && l.me_leading));

  return (
    <div className="lx-wrap" style={{ padding: "40px 0 72px" }}>
      <span className="lx-eyebrow">A minha conta</span>
      <h1 style={{ marginBottom: 6 }}>Olá, {me.first_name}</h1>
      <p className="lx-muted">
        Nos leilões aparece como <strong>{me.alias}</strong> · conta {CUSTOMER_LEVEL[me.level]?.toLowerCase() || me.level}
        {me.level === "registered" && settings ? ` (licitações até ${settings.verified_threshold.toLocaleString("pt-PT")} €; acima disso pedimos a verificação da identidade)` : ""}.
      </p>

      <nav className="lx-tabs" aria-label="Secções da conta">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`${base}/conta?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>
        ))}
      </nav>

      {tab === "licitacoes" && (
        <div style={{ display: "grid", gap: 36 }}>
          {won.length > 0 && (
            <section>
              <h2>Lotes ganhos</h2>
              <div className="lx-alert lx-alert-ok" style={{ marginBottom: 18 }}>
                Parabéns! Enviámos as instruções de pagamento por email. Prazo: {settings?.payment_hours ?? 48} horas depois do fecho
                {won[0].payment_due_at ? ` (o mais próximo termina a ${lisbonDateTime(won[0].payment_due_at)})` : ""}.
              </div>
              <div className="lx-lots">{won.map((l) => <LotCard key={l.id} lot={l} base={base} now={now} endingMinutes={settings?.ending_soon_minutes ?? 60} />)}</div>
            </section>
          )}
          <section>
            <h2>A decorrer</h2>
            {open.length === 0 ? (
              <div className="lx-card lx-empty">
                <p>Ainda não licitou nem guardou lotes abertos. Guarde um lote nos favoritos para receber o aviso antes do fecho.</p>
                <Link className="lx-btn" href={base || "/"}>Ver leilões</Link>
              </div>
            ) : (
              <div className="lx-lots">{open.map((l) => <LotCard key={l.id} lot={l} base={base} now={now} endingMinutes={settings?.ending_soon_minutes ?? 60} />)}</div>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <h2>Terminados</h2>
              <div className="lx-lots">{past.map((l) => <LotCard key={l.id} lot={l} base={base} now={now} endingMinutes={settings?.ending_soon_minutes ?? 60} />)}</div>
            </section>
          )}
        </div>
      )}

      {tab === "dados" && (
        <div style={{ display: "grid", gap: 24, maxWidth: 820 }}>
          <section className="lx-card lx-card-pad">
            <h2>Dados pessoais</h2>
            <p className="lx-small lx-muted">Usamos estes dados para o contactar e faturar se ganhar um lote. A morada e o NIF são pedidos antes do pagamento.</p>
            <ProfileForm me={me} />
          </section>
          <section className="lx-card lx-card-pad">
            <h2>Palavra-passe</h2>
            <PasswordForm />
          </section>
        </div>
      )}

      {tab === "privacidade" && (
        <div style={{ display: "grid", gap: 24, maxWidth: 820 }}>
          <section className="lx-card lx-card-pad">
            <h2>Descarregar os meus dados</h2>
            <p className="lx-muted">
              Um ficheiro com os dados da conta, as licitações, os favoritos e os lotes ganhos (direito de acesso e de portabilidade, RGPD art. 15.º e 20.º).
            </p>
            <a className="lx-btn lx-btn-ghost" href="/api/l/export">Descarregar (JSON)</a>
          </section>
          <section className="lx-card lx-card-pad">
            <h2>Apagar a conta</h2>
            <p className="lx-muted">
              Retiramos o seu nome, email, telemóvel, NIF, data de nascimento e morada, e terminamos todas as sessões. As licitações ficam associadas apenas ao
              pseudónimo, porque são a prova dos contratos de compra (obrigação legal). As faturas são guardadas pelo prazo fiscal. Não é possível apagar a conta
              enquanto lidera um lote aberto ou tem uma compra por concluir.
            </p>
            <DeleteForm />
          </section>
          <p className="lx-small lx-muted">
            Mais informação na <Link href={`${base}/privacidade`}>política de privacidade</Link>. Para outros pedidos (retificação, oposição, limitação) escreva-nos
            {settings?.contact_email ? <> para <a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a></> : null}.
          </p>
        </div>
      )}
    </div>
  );
}
