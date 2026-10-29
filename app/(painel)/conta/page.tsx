import { canSupport } from "@/lib/permissions";
import { rpc } from "@/lib/supabase";
import type { ReviewStats } from "@/lib/support/review-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { ReviewStatsList } from "@/components/support/review-stats";
import { changePassword, saveReviewPref } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "A minha conta · Loja do Ouro" };

type Prefs = { ai_review: boolean; review_mode: string; review_month: ReviewStats };

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer({ allowPasswordChange: true });
  const q = await searchParams;
  const first = viewer.mustChangePassword;
  const error = typeof q.erro === "string" ? q.erro.slice(0, 300) : undefined;
  // Revisão da IA antes de enviar (Apoio ao Cliente): a preferência e as revisões da própria pessoa.
  const prefs = !first && canSupport(viewer) ? await rpc<Prefs>("ldo_support_user_prefs", { p_session: viewer.session }).catch(() => null) : null;
  const reviewError = typeof q.revisao_erro === "string" ? q.revisao_erro.slice(0, 300) : undefined;

  return (
    <AppShell viewer={viewer} current="conta" title="A minha conta">
      <PageHeading
        eyebrow="CONTA"
        title={first ? "Escolha a sua palavra-passe" : "A minha conta"}
        text={first ? "Está a usar uma palavra-passe temporária. Escolha uma nova para continuar." : `Utilizador: ${viewer.username}`}
      />
      <Flash ok={q.ok ? "Palavra-passe alterada. As outras sessões abertas foram terminadas." : undefined} error={error} />
      <div className="two-col sales-entry">
        <Panel title="Mudar palavra-passe" eyebrow="SEGURANÇA" note="Pelo menos 8 caracteres. Mudar a palavra-passe termina as sessões abertas noutros computadores.">
          <form action={changePassword} className="form-grid">
            <input type="hidden" name="username" value={viewer.username} autoComplete="username" />
            <label className="wide">
              Palavra-passe atual
              <input name="current_password" type="password" required autoComplete="current-password" />
            </label>
            <label>
              Nova palavra-passe
              <input name="new_password" type="password" required minLength={8} autoComplete="new-password" />
            </label>
            <label>
              Repetir a nova palavra-passe
              <input name="confirm_password" type="password" required minLength={8} autoComplete="new-password" />
            </label>
            <div className="wide form-actions">
              <button type="submit">Guardar palavra-passe</button>
            </div>
          </form>
        </Panel>
        {prefs && (
          <Panel title="Revisão da IA antes de enviar" eyebrow="APOIO AO CLIENTE" id="revisao">
            <Flash ok={q.revisao_ok ? "Preferência guardada." : undefined} error={reviewError} />
            {prefs.review_mode === "opcional" ? (
              <form action={saveReviewPref} className="inline-form">
                <label className="checkbox-label">
                  <input type="checkbox" name="ai_review" defaultChecked={prefs.ai_review} /> Rever as minhas respostas com a IA antes de enviar
                </label>
                <button type="submit" className="secondary-button">Guardar</button>
              </form>
            ) : (
              <p className="panel-note">
                {prefs.review_mode === "obrigatoria" ? "A revisão está ligada para toda a equipa (definida pelo Super Admin)." : "A revisão da IA está desligada na configuração do apoio."}
              </p>
            )}
            <h3 className="panel-subtitle">As suas revisões este mês</h3>
            <ReviewStatsList s={prefs.review_month} />
            <p className="panel-note">Só vê as suas revisões. Estes números servem para afinar a IA, não para avaliar pessoas.</p>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
