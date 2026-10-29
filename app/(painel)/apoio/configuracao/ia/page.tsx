import Link from "next/link";
import { redirect } from "next/navigation";
import { homePath } from "@/lib/permissions";
import { aiConfigured } from "@/lib/support/ai";
import { sessionRpc } from "@/lib/support/db";
import {
  acceptance, isReviewModel, needsTuning, REVIEW_CRITERIA_MAX, REVIEW_DEFAULT_MODEL, REVIEW_MODE_LABEL, REVIEW_MODEL_LABEL, REVIEW_MODELS, REVIEW_MODES,
  type ReviewStats,
} from "@/lib/support/review-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { ReviewStatsList } from "@/components/support/review-stats";
import { saveReviewSettings } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "IA do apoio · Loja do Ouro" };

type ReviewSettings = { mode: string; model: string; monthly_budget: number; criteria: string; month: ReviewStats; two_weeks: ReviewStats };

// Definições da IA do Apoio ao Cliente que não cabem na página principal da configuração: por agora, a revisão da IA
// antes de enviar. Só o Super Admin.
export default async function SupportAiSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const [settings, mine] = await Promise.all([
    sessionRpc<ReviewSettings>(viewer.session, "ldo_support_review_settings").catch(() => null),
    sessionRpc<{ review_month: ReviewStats }>(viewer.session, "ldo_support_user_prefs").catch(() => null),
  ]);
  const ok = typeof q.ok === "string" ? q.ok.slice(0, 200) : undefined;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 600) : undefined;
  const rate = settings ? acceptance(settings.two_weeks) : null;

  return (
    <AppShell viewer={viewer} current="apoio-config" title="IA do apoio">
      <PageHeading eyebrow="APOIO AO CLIENTE" title="IA do apoio" text="Revisão das respostas da equipa antes de seguirem para o cliente. Só o Super Admin vê esta página.">
        <Link className="outline-button" href="/apoio/configuracao#ia">Configuração do apoio</Link>
      </PageHeading>

      <Panel title="Revisão da IA antes de enviar" eyebrow="QUALIDADE DAS RESPOSTAS" id="revisao">
        <Flash ok={ok} error={error} />
        {settings ? (
          <div className="two-col">
            <form action={saveReviewSettings} className="email-form review-form">
              <fieldset>
                <legend>Revisão da IA antes de enviar</legend>
                {REVIEW_MODES.map((m) => (
                  <label key={m} className="checkbox-label">
                    <input type="radio" name="mode" value={m} defaultChecked={settings.mode === m} required /> {REVIEW_MODE_LABEL[m]}
                  </label>
                ))}
              </fieldset>
              <label>
                Modelo da revisão
                <select name="model" defaultValue={isReviewModel(settings.model) ? settings.model : REVIEW_DEFAULT_MODEL}>
                  {REVIEW_MODELS.map((m) => <option key={m} value={m}>{REVIEW_MODEL_LABEL[m]}</option>)}
                </select>
              </label>
              <label>
                Orçamento mensal da revisão (US$)
                <input type="number" name="monthly_budget" required min={0} max={10000} step={1} defaultValue={settings.monthly_budget} />
              </label>
              <label>
                Critérios de qualidade e de bom atendimento
                <textarea name="criteria" required maxLength={REVIEW_CRITERIA_MAX} defaultValue={settings.criteria} />
                <small className="muted">Um critério por linha. A IA só aponta problemas reais segundo estes critérios; preferências de estilo não contam. Máximo {REVIEW_CRITERIA_MAX} caracteres.</small>
              </label>
              <div><button type="submit" className="secondary-button">Guardar</button></div>
            </form>
            <div>
              <h3 className="panel-subtitle">Este mês (totais da equipa)</h3>
              <ReviewStatsList s={settings.month} cost />
              <p className="panel-note">
                Aceitação das sugestões nos últimos 14 dias: {rate === null ? "ainda sem decisões" : `${rate}% (${settings.two_weeks.decididas} decisões)`}.
                {needsTuning(settings.two_weeks)
                  ? " Está abaixo de 20%: as sugestões estão a ajudar pouco. Torne os critérios mais claros ou mais exigentes."
                  : " Se ficar abaixo de 20% durante duas semanas, torne os critérios mais claros ou mais exigentes."}
              </p>
              {mine && (
                <>
                  <h3 className="panel-subtitle">As suas revisões este mês</h3>
                  <ReviewStatsList s={mine.review_month} />
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="error-text">Definições indisponíveis (falta a atualização na base de dados?).</p>
        )}
        {!aiConfigured() && <p className="error-text">Falta a chave da Anthropic (ANTHROPIC_API_KEY): sem ela, as respostas seguem sem revisão.</p>}
        <p className="panel-note">
          Quando alguém carrega em Enviar, a IA verifica a resposta em 1 a 3 segundos. Se estiver boa, segue logo; se puder melhorar, a IA mostra o que encontrou e uma sugestão, com as diferenças marcadas, e a pessoa escolhe entre enviar a sugestão, enviar a sua versão ou editar. Uma sugestão que acrescente preços, prazos, descontos, datas, contactos, códigos ou ligações é retirada antes de aparecer. Se a IA falhar ou não responder em 10 segundos, a resposta é enviada na mesma. Não conta para o limite diário de pedidos à IA (máximo de 300 revisões por pessoa e por dia) e tem orçamento próprio: ao atingi-lo, as respostas seguem sem revisão até ao mês seguinte.
        </p>
        <p className="panel-note">
          A resposta, as últimas mensagens da conversa e a base de conhecimento são enviadas à Anthropic para a revisão; do texto fica guardado só um código (hash), nunca a resposta nem a sugestão (registo apagado ao fim de 365 dias). Estas estatísticas não servem para avaliar pessoas: aqui aparecem só os totais da equipa, e cada pessoa vê as suas em A minha conta, onde também pode desligar a revisão no modo Opcional.
        </p>
      </Panel>
    </AppShell>
  );
}
