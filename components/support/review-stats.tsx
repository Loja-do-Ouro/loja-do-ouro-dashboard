import { acceptance, type ReviewStats } from "@/lib/support/review-rules";

const usd = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(Number(v) || 0);

// Revisões da IA antes de enviar: totais de uma pessoa (A minha conta) ou da equipa (configuração). Nunca por pessoa
// ao lado dos colegas. cost: só o Super Admin vê o custo.
export function ReviewStatsList({ s, cost = false }: { s: ReviewStats; cost?: boolean }) {
  const rate = acceptance(s);
  const failed = s.timeout + s.erro;
  return (
    <dl className="config-list">
      <dt>Revisões</dt>
      <dd>{s.revisoes}{s.revisoes > 0 && <> · {s.aprovadas} aprovadas à primeira · {s.melhorar} com sugestões de melhoria</>}</dd>
      <dt>Sugestões</dt>
      <dd>
        {s.sugestoes} mostradas · {s.sugestao} enviadas tal como sugeridas · {s.editada} editadas · {s.propria} com a versão própria
        {rate !== null && <small className="muted block">Aceitação: {rate}% das sugestões com decisão ({s.decididas}).</small>}
        {s.descartadas > 0 && <small className="muted block">{s.descartadas} sugestão(ões) retirada(s) pelas regras de segurança (números, compromissos, ligações…).</small>}
      </dd>
      <dt>Sem revisão</dt>
      <dd>{s.sem_revisao} enviadas sem esperar · {failed} sem resposta da IA (a tempo ou de todo){s.erros ? ` · ${s.erros} com erro da IA` : ""}</dd>
      {cost && (<><dt>Custo estimado</dt><dd>{usd(s.custo)}</dd></>)}
    </dl>
  );
}
