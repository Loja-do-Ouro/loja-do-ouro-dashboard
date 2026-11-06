import { PUBLIC_SHOW_AVERAGES, mediaKindLabel, publicSummary } from "@/lib/criadores-meta-rules";
import { lisbonDate, lisbonDateTime } from "@/lib/criadores-rules";
import type { CrPublicCreator } from "@/lib/criadores/db";
import { stopCreatorPublic } from "../../actions";
import { num } from "../../ui";

// Bloco «Dados públicos (lidos da Meta)» da ficha, separador Redes (fase 3A). Só números públicos, lidos com a
// autorização do criador: sem o código da biografia, sem imagens nem ligações da Meta. Não servem para indicadores
// nem para IA, não ordenam nem pontuam criadores e não decidem candidaturas.

type Account = NonNullable<CrPublicCreator["account"]>;
type Request = { id: string; received_at: string };

const STATE: Record<string, { label: string; cls: string }> = {
  proof: { label: "Por confirmar (código na biografia)", cls: "pill" },
  active: { label: "Em leitura", cls: "pill ok" },
  error: { label: "Erro: conta não encontrada", cls: "pill warn" },
};

export function PublicBlock({ p, creatorId, manage, requests }: { p: Account; creatorId: string; manage: boolean; requests: Request[] }) {
  const state = p.state ? STATE[p.state] : null;
  const last = p.history[0] ?? null;
  const summary = PUBLIC_SHOW_AVERAGES ? publicSummary(p.media) : null;
  const when = [
    p.consented_at ? `autorizado a ${lisbonDateTime(p.consented_at)}` : null,
    p.state === "proof" && p.code_expires_at ? `código válido até ${lisbonDateTime(p.code_expires_at)}` : null,
    p.verified_at ? `confirmado a ${lisbonDateTime(p.verified_at)}` : null,
    p.last_read_at ? `última leitura ${lisbonDateTime(p.last_read_at)}` : p.state !== "proof" ? "ainda sem leituras" : null,
    p.next_at && p.state !== "proof" ? `próxima ${lisbonDateTime(p.next_at)}` : null,
  ].filter(Boolean);
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: "0 0 6px" }}>
        Dados públicos (lidos da Meta) {state && <span className={state.cls}>{state.label}</span>}
      </h4>
      <small className="muted block">{when.join(" · ")}</small>
      {p.last_error && (
        <small className="muted block">
          {p.last_error === "not_found" ? "A Meta não devolve a conta (não é profissional ou o @ mudou)" : "Erro temporário da Meta"}
          {p.last_error_at ? ` desde ${lisbonDateTime(p.last_error_at)}` : ""} · {p.attempts} {p.attempts === 1 ? "falha seguida" : "falhas seguidas"}
        </small>
      )}
      {p.state !== "proof" && (
        <div className="mini-stats" style={{ marginTop: 10 }}>
          <div>
            <span>Seguidores</span>
            <strong>{num(last?.followers)}</strong>
          </div>
          <div>
            <span>Publicações</span>
            <strong>{num(last?.media_count)}</strong>
          </div>
          {summary && summary.posts >= 3 && (
            <>
              <div>
                <span>Gostos (média de {summary.posts})</span>
                <strong>{num(summary.likes)}</strong>
              </div>
              <div>
                <span>Comentários (média de {summary.posts})</span>
                <strong>{num(summary.comments)}</strong>
              </div>
              <div>
                <span>Visualizações de reels (média de {summary.reels})</span>
                <strong>{num(summary.reelViews)}</strong>
              </div>
            </>
          )}
        </div>
      )}
      {p.history.length > 0 && (
        <div className="table-scroll" tabIndex={0} aria-label="Leituras dos dados públicos" style={{ marginTop: 10 }}>
          <table className="left-table">
            <caption className="muted" style={{ textAlign: "left" }}>Leituras (as últimas 30)</caption>
            <thead>
              <tr>
                <th>Data</th>
                <th>Seguidores</th>
                <th>Publicações</th>
              </tr>
            </thead>
            <tbody>
              {p.history.slice(0, 30).map((s) => (
                <tr key={s.taken_on}>
                  <td>{lisbonDate(s.taken_on)}</td>
                  <td>{num(s.followers)}</td>
                  <td>{num(s.media_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.media.length > 0 && (
        <div className="table-scroll" tabIndex={0} aria-label="Publicações lidas" style={{ marginTop: 10 }}>
          <table className="left-table">
            <caption className="muted" style={{ textAlign: "left" }}>Publicações (as 25 mais recentes)</caption>
            <thead>
              <tr>
                <th>Publicada</th>
                <th>Tipo</th>
                <th>Gostos</th>
                <th>Comentários</th>
                <th>Visualizações</th>
                <th>Lida a</th>
              </tr>
            </thead>
            <tbody>
              {p.media.slice(0, 25).map((m, i) => (
                <tr key={`${m.posted_at}-${i}`}>
                  <td>{lisbonDateTime(m.posted_at)}</td>
                  <td>{mediaKindLabel(m)}</td>
                  <td>{num(m.like_count)}</td>
                  <td>{num(m.comments_count)}</td>
                  <td>{num(m.view_count)}</td>
                  <td>{lisbonDate(m.read_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="field-help" style={{ marginTop: 10 }}>
        Números públicos, lidos com a autorização do criador. Não servem para indicadores nem para IA, não ordenam nem pontuam criadores e não decidem
        candidaturas. «—» = a Meta não devolveu o número (gostos escondidos; as visualizações só existem nos reels).
      </p>
      {manage && requests.length > 0 && (
        <form action={stopCreatorPublic} className="form-grid danger-zone">
          <input type="hidden" name="id" value={creatorId} />
          <label className="wide">
            Pedido de retirada do consentimento
            <select name="request_id" required>
              {requests.map((r) => (
                <option key={r.id} value={r.id}>Pedido RGPD de {lisbonDate(r.received_at)}</option>
              ))}
            </select>
          </label>
          <label className="check wide">
            <input type="checkbox" name="confirm" required />
            <span>Confirmo: para a leitura, apaga já os números lidos do Instagram e regista a retirada da autorização. Não se pode desfazer.</span>
          </label>
          <div className="wide form-actions">
            <button type="submit" className="danger-button">
              Parar a leitura a pedido{requests.length === 1 ? ` (pedido RGPD de ${lisbonDate(requests[0].received_at)})` : ""}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
