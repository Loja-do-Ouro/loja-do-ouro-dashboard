import { redirect } from "next/navigation";
import { canManageAuction, homePath } from "@/lib/permissions";
import { aucOverview } from "@/lib/leilao/db";
import { eur, formatIncrements, lisbonDateTime } from "@/lib/leilao-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { saveLegal, saveSettings } from "../actions";
import { auctionMessage } from "../messages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Regras do leilão · Loja do Ouro" };

export default async function AuctionSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canManageAuction(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const data = await aucOverview(viewer.session).catch(() => null);
  const s = data?.settings;
  const n = (v: number) => String(v).replace(".", ",");

  return (
    <AppShell viewer={viewer} current="leilao-definicoes" title="Regras do leilão">
      <PageHeading eyebrow="LEILÃO" title="Regras do leilão" text="Tudo o que define como se licita, quando se prolonga, quando há caução e que garantias se aplicam. As mudanças valem para as próximas licitações." />
      <Flash ok={auctionMessage(q.ok)} error={typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined} />
      {!s ? (
        <div className="notice error-notice">Regras indisponíveis (falta a atualização da base de dados?).</div>
      ) : (
        <form action={saveSettings} className="stack">
          <div className="two-col admin-layout">
            <Panel title="Licitação e fecho" eyebrow="ANTISNIPING E INCREMENTOS">
              <div className="form-grid">
                <label>
                  Janela de prolongamento (segundos antes do fecho)
                  <input name="extend_window_seconds" type="number" min={0} max={3600} required defaultValue={s.extend_window_seconds} />
                </label>
                <label>
                  Prolongar por (minutos)
                  <input name="extend_minutes" type="number" min={1} max={60} required defaultValue={s.extend_minutes} />
                </label>
                <label>
                  Intervalo entre lotes por omissão (segundos)
                  <input name="default_stagger_seconds" type="number" min={0} max={3600} required defaultValue={s.default_stagger_seconds} />
                </label>
                <label>
                  Aviso «a terminar» (minutos antes)
                  <input name="ending_soon_minutes" type="number" min={5} max={1440} required defaultValue={s.ending_soon_minutes} />
                </label>
                <label className="wide">
                  Incrementos («a partir de» e «incremento» em €, uma linha cada)
                  <textarea name="increments" rows={8} required defaultValue={formatIncrements(s.increments)} spellCheck={false} />
                </label>
                <p className="field-help wide">
                  Ex.: «500 25» = a partir de 500 €, cada licitação sobe pelo menos 25 €. Uma licitação nos últimos {s.extend_window_seconds} s põe o fecho a{" "}
                  {s.extend_minutes} min e avisa por email quem licitou nesse lote.
                </p>
              </div>
            </Panel>

            <Panel title="Caução, verificação e pagamento" eyebrow="SEGURANÇA">
              <div className="form-grid">
                <label>
                  Caução a partir de (€, base do lote)
                  <input name="deposit_threshold" inputMode="decimal" required defaultValue={n(s.deposit_threshold)} />
                </label>
                <label>
                  Caução (% da base)
                  <input name="deposit_percent" inputMode="decimal" required defaultValue={n(s.deposit_percent)} />
                </label>
                <label>
                  Caução mínima (€)
                  <input name="deposit_min" inputMode="decimal" required defaultValue={n(s.deposit_min)} />
                </label>
                <label>
                  Conta verificada para licitar a partir de (€)
                  <input name="verified_threshold" inputMode="decimal" required defaultValue={n(s.verified_threshold)} />
                </label>
                <label>
                  Prazo de pagamento do vencedor (horas)
                  <input name="payment_hours" type="number" min={1} max={336} required defaultValue={s.payment_hours} />
                </label>
                <p className="field-help wide">
                  A caução é cativa no cartão ou MB WAY (easypay) na primeira licitação e libertada se não ganhar. Hoje: lotes com base a partir de{" "}
                  {eur(s.deposit_threshold)} pedem {n(s.deposit_percent)}% (mínimo {eur(s.deposit_min)}). Identificação reforçada a partir de 3 000 € e
                  diligência completa a partir de 10 000 € (branqueamento de capitais).
                </p>
              </div>
            </Panel>
          </div>

          <Panel title="Garantias e autoridades" eyebrow="LEGAL (A VALIDAR COM O ADVOGADO)">
            <div className="form-grid">
              <label>
                Garantia das peças novas (meses)
                <input name="new_warranty_months" type="number" min={0} max={120} required defaultValue={s.new_warranty_months} />
              </label>
              <label>
                Garantia das peças usadas (meses)
                <input name="used_warranty_months" type="number" min={0} max={120} required defaultValue={s.used_warranty_months} />
              </label>
              <label>
                Aviso à ASAE/INCM (dias antes da abertura; 0 = não aplicar)
                <input name="authority_notice_days" type="number" min={0} max={90} required defaultValue={s.authority_notice_days} />
              </label>
              <p className="field-help wide">
                Garantia legal de 3 anos (DL 84/2021); nas usadas pode ser 18 meses por acordo expresso do cliente. O aviso às autoridades (RJOC, art. 65.º)
                só se aplica se o advogado o confirmar para quem leiloa bens próprios.
              </p>
            </div>
          </Panel>

          <div className="form-actions">
            <button type="submit">Guardar regras</button>
            {s.updated_at && <small className="muted">Última alteração {lisbonDateTime(s.updated_at)}</small>}
          </div>
        </form>
      )}

      {s && (
        <form action={saveLegal} className="stack" style={{ marginTop: 24 }}>
          <Panel title="Identificação legal e termos" eyebrow="SITE DO LEILÃO (RODAPÉ E PÁGINAS LEGAIS)">
            <div className="form-grid">
              <label>
                Denominação social
                <input name="company_name" maxLength={200} defaultValue={s.company_name || ""} />
              </label>
              <label>
                NIF da empresa
                <input name="company_nif" inputMode="numeric" maxLength={11} defaultValue={s.company_nif || ""} />
              </label>
              <label className="wide">
                Sede
                <input name="company_address" maxLength={400} defaultValue={s.company_address || ""} />
              </label>
              <label>
                Registo comercial (conservatória e número)
                <input name="company_registry" maxLength={200} defaultValue={s.company_registry || ""} />
              </label>
              <label>
                Título RJOC (comércio de metais preciosos)
                <input name="rjoc_title" maxLength={120} defaultValue={s.rjoc_title || ""} />
              </label>
              <label>
                Email de contacto
                <input name="contact_email" type="email" maxLength={254} defaultValue={s.contact_email || ""} />
              </label>
              <label>
                Telefone de contacto
                <input name="contact_phone" maxLength={40} defaultValue={s.contact_phone || ""} />
              </label>
              <label className="wide">
                Entidade de resolução alternativa de litígios (RAL)
                <input name="ral_entity" maxLength={400} defaultValue={s.ral_entity || ""} placeholder="Nome e site da entidade (a confirmar com o advogado)" />
              </label>
              <label>
                Versão dos termos
                <input name="terms_version" maxLength={40} required defaultValue={s.terms_version || ""} />
              </label>
              <p className="field-help wide">
                Mudar a versão dos termos obriga os novos registos a aceitar a versão nova (quem já tem conta fica com a data em que aceitou). Mude-a quando o
                advogado aprovar os textos (ex.: «2026-11-v1»).
              </p>
            </div>
          </Panel>
          <div className="form-actions">
            <button type="submit">Guardar identificação</button>
          </div>
        </form>
      )}
    </AppShell>
  );
}
