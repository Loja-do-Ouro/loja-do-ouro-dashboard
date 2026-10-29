import { sessionRpc } from "@/lib/support/db";
import { historyDateLabel } from "@/lib/support/rules";
import { Panel } from "@/components/dashboard/ui";
import { Flash } from "@/components/shell";
import { saveHistory } from "./historico-actions";

type History = { history_from: string; history_date: string; hidden: number };

// Histórico visível: as conversas resolvidas sem atividade desde a data ficam ocultas (lista, pesquisa, IA); as por
// resolver ficam sempre. Nada é apagado.
export async function PainelHistorico({ session, q }: { session: string; q: Record<string, string | string[] | undefined> }) {
  const h = await sessionRpc<History>(session, "ldo_support_history_settings").catch(() => null);
  const error = typeof q.historico_erro === "string" ? q.historico_erro.slice(0, 300) : undefined;
  // Hoje em Lisboa (AAAA-MM-DD): a BD recusa datas no futuro.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
  return (
    <Panel title="Histórico visível" eyebrow="CONVERSAS" id="historico">
      <Flash ok={q.historico_ok ? "Data guardada." : undefined} error={error} />
      {h ? (
        <>
          <form action={saveHistory} className="inline-form">
            <label>
              Histórico visível a partir de
              <input type="date" name="history_from" required max={today} defaultValue={h.history_date} />
            </label>
            <button type="submit" className="secondary-button">Guardar</button>
          </form>
          <p className="panel-note">
            As conversas resolvidas sem atividade desde esta data ficam ocultas na lista, na pesquisa e na IA; as que estão por resolver ficam sempre visíveis. Não é apagado nada; uma conversa antiga volta a aparecer se o cliente escrever.
            {" "}Ocultas agora: {h.hidden} conversa{h.hidden === 1 ? "" : "s"} resolvida{h.hidden === 1 ? "" : "s"} sem atividade desde {historyDateLabel(h.history_from) ?? h.history_date}.
          </p>
        </>
      ) : (
        <p className="error-text">Definição indisponível (falta a atualização na base de dados?).</p>
      )}
    </Panel>
  );
}
