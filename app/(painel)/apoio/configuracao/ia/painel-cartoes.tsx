import Link from "next/link";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { Flash } from "@/components/shell";
import { aiConfigured } from "@/lib/support/ai";
import { sessionRpc } from "@/lib/support/db";
import {
  autoOkBlockers, CARD_BRAND_LABEL, CARD_BRANDS, CARD_ESTADOS, CARD_LIMITS, cardPii, cardWarnings, companyAllowlist, INTENT_LABEL, isIntent,
  KNOWLEDGE_INTENTS, lisbonToday, PII_LABEL, storeKeywords, type AutoCard, type CardEstado,
} from "@/lib/support/knowledge-rules";
import type { Viewer } from "@/lib/viewer";
import { archiveCard, mergeCard, publishCards, saveAndApprove, saveCard, saveKnowledgeSettings, setCardAuto } from "./cartoes-actions";

type Settings = {
  auto_proposals: boolean;
  monthly_budget: number;
  month: { custo: number; pedidos: number; erros: number; novos: number; existentes: number; nao_aproveitaveis: number; descartados: number };
  counts: { proposta: number; aprovada: number; arquivada: number; publicadas: number; por_publicar: number; auto_ok: number };
  published_at: string | null;
};
type Card = AutoCard & {
  loja: string | null; pergunta: string; variantes: string[]; fontes: number; ultima_vez: string; amostras: string[]; valido_ate: string | null;
  criada_por: "ia" | "pessoa"; aprovada_por: string | null; auto_ok_em: string | null; publicada_em: string | null;
};
type Store = { id: string; code: string; name: string; city: string | null };
type Target = Pick<AutoCard, "id" | "estado" | "intent" | "brand" | "loja_id" | "auto_ok"> & { pergunta: string };
type CardList = {
  cards: Card[]; stores: Store[]; targets: Target[]; knowledge: { title: string; body: string }[]; company?: string[]; staff_names?: string[];
};

const ESTADO_LABEL: Record<CardEstado, string> = { proposta: "Propostas", aprovada: "Aprovadas", arquivada: "Arquivadas" };
// "Juntar a…": só respostas do mesmo tema (corrija o tema primeiro se a IA o escolheu mal), no máximo 50.
const MERGE_TARGETS = 50;
const usd = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "USD" }).format(Number(v) || 0);
const day = (d: string) =>
  new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short" }).format(new Date(d.length === 10 ? `${d}T12:00:00Z` : d));
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Campos de um cartão (corrigir um existente ou escrever um novo).
function CardFields({ card, stores }: { card?: Card; stores: Store[] }) {
  return (
    <>
      <div className="knowledge-row">
        <select name="intent" defaultValue={card?.intent && isIntent(card.intent) ? card.intent : "outro"} aria-label="Tema">
          {KNOWLEDGE_INTENTS.map((i) => <option key={i} value={i}>{INTENT_LABEL[i]}</option>)}
        </select>
        <select name="brand" defaultValue={card?.brand || "ldo"} aria-label="Marca">
          {CARD_BRANDS.map((b) => <option key={b} value={b}>{CARD_BRAND_LABEL[b]}</option>)}
        </select>
        <select name="loja_id" defaultValue={card?.loja_id || ""} aria-label="Loja">
          <option value="">Sem loja concreta</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="muted">Válida até <input type="date" name="valido_ate" defaultValue={card?.valido_ate || ""} /></label>
      </div>
      <input name="pergunta" defaultValue={card?.pergunta} maxLength={CARD_LIMITS.pergunta} required minLength={5} placeholder="Pergunta genérica, como os clientes a fazem" aria-label="Pergunta" />
      <textarea name="variantes" defaultValue={card?.variantes.join("\n")} placeholder="Outras formas da mesma pergunta (uma por linha, até 5)" aria-label="Outras formas da pergunta" style={{ minHeight: 70 }} />
      <textarea name="resposta" defaultValue={card?.resposta} maxLength={CARD_LIMITS.resposta} required placeholder="Resposta da empresa, sem dados de clientes" aria-label="Resposta" />
    </>
  );
}

// Estado e pesquisa abertos no painel, para voltar ao mesmo sítio depois de cada ação.
function Back({ estado, search }: { estado: CardEstado; search: string }) {
  return (
    <>
      <input type="hidden" name="voltar" value={estado} />
      {search && <input type="hidden" name="voltar_q" value={search} />}
    </>
  );
}

// Base de conhecimento aprendida: definições, publicação e os cartões (propostas, aprovadas, arquivadas). Só o Super Admin.
export async function PainelCartoes({ viewer, q }: { viewer: Viewer; q: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const estado: CardEstado = CARD_ESTADOS.includes(one("cartoes") as CardEstado) ? (one("cartoes") as CardEstado) : "proposta";
  const search = one("cartoes_q").trim().slice(0, 200);
  const [settings, list] = await Promise.all([
    sessionRpc<Settings>(viewer.session, "ldo_support_knowledge_settings").catch(() => null),
    sessionRpc<CardList>(viewer.session, "ldo_support_knowledge_cards", { p_estado: estado, p_q: search || null }).catch(() => null),
  ]);
  const ok = one("cartoes_ok").slice(0, 300) || undefined;
  const error = one("cartoes_erro").slice(0, 900) || undefined;
  const knowledge = list ? list.knowledge.map((k) => `## ${k.title}\n${k.body}`).join("\n\n") : "";
  const allow = list ? companyAllowlist({ knowledge, stores: list.stores, extra: list.company || [] }) : null;
  const now = new Date();
  const today = lisbonToday(now);

  return (
    <Panel title="Base de conhecimento aprendida" eyebrow="RESPOSTAS APROVADAS" id="cartoes">
      <Flash ok={ok} error={error} />
      <p className="panel-note">Propostas da IA a partir das respostas da equipa, já sem nomes, contactos nem números de encomenda. Só são usadas depois de aprovadas.</p>
      {!settings || !list || !allow ? (
        <p className="error-text">Indisponível (falta a atualização na base de dados?).</p>
      ) : (
        <>
          <div className="two-col">
            <form action={saveKnowledgeSettings} className="email-form review-form">
              <label className="checkbox-label">
                <input type="checkbox" name="auto_proposals" defaultChecked={settings.auto_proposals} /> Propostas automáticas a partir das conversas
              </label>
              <small className="muted">Uma vez por dia, a IA lê até 12 conversas respondidas pela equipa no dashboard (resolvidas ou sem atividade há 72 horas) e propõe respostas. O botão &quot;Guardar como resposta aprovada&quot;, numa resposta enviada, funciona sempre.</small>
              <label>
                Orçamento mensal das propostas (US$)
                <input type="number" name="monthly_budget" required min={0} max={10000} step={1} defaultValue={settings.monthly_budget} />
              </label>
              <div><button type="submit" className="secondary-button">Guardar</button></div>
            </form>
            <div>
              <dl className="config-list">
                <dt>Este mês</dt>
                <dd>
                  {usd(settings.month.custo)} de {usd(settings.monthly_budget)} · {settings.month.pedidos} pedidos à IA{settings.month.erros ? ` (${settings.month.erros} com erro)` : ""}
                  <small className="muted block">{settings.month.novos} propostas novas · {settings.month.existentes} confirmações de respostas que já existiam · {settings.month.nao_aproveitaveis} sem pergunta geral · {settings.month.descartados} retiradas pelas regras de segurança</small>
                </dd>
                <dt>Respostas</dt>
                <dd>{settings.counts.proposta} propostas · {settings.counts.aprovada} aprovadas ({settings.counts.publicadas} em uso pela IA) · {settings.counts.auto_ok} marcadas para respostas automáticas · {settings.counts.arquivada} arquivadas</dd>
                <dt>Publicação</dt>
                <dd>{settings.published_at ? `Última a ${timestamp(settings.published_at)}` : "Ainda nada publicado."}</dd>
              </dl>
              <form action={publishCards}>
                <Back estado={estado} search={search} />
                <button type="submit" className="secondary-button" disabled={!settings.counts.por_publicar}>Publicar alterações ({settings.counts.por_publicar})</button>
              </form>
              <p className="panel-note">As propostas de resposta da IA só passam a usar as respostas aprovadas depois de publicar (no máximo {CARD_LIMITS.published} respostas e {CARD_LIMITS.publishedChars.toLocaleString("pt-PT")} caracteres). Arquivar retira uma resposta de imediato.</p>
            </div>
          </div>
          {!aiConfigured() && <p className="error-text">Falta a chave da Anthropic (ANTHROPIC_API_KEY): sem ela não há propostas.</p>}

          <div className="chips">
            {CARD_ESTADOS.map((e) => (
              <Link key={e} className={`chip${e === estado ? " active" : ""}`} href={`/apoio/configuracao/ia?cartoes=${e}#cartoes`}>
                {ESTADO_LABEL[e]} ({settings.counts[e]})
              </Link>
            ))}
          </div>
          <form action="/apoio/configuracao/ia#cartoes" className="inline-form">
            <input type="hidden" name="cartoes" value={estado} />
            <label>Procurar <input type="search" name="cartoes_q" defaultValue={search} maxLength={200} placeholder="ex.: horário Benfica" /></label>
            <button type="submit" className="secondary-button">Procurar</button>
          </form>

          <div className="knowledge-list">
            {!list.cards.length && <p className="muted">{search ? "Nenhuma resposta com estas palavras." : estado === "proposta" ? "Sem propostas por rever." : "Nenhuma resposta."}</p>}
            {list.cards.map((c) => {
              const warnings = cardWarnings(c);
              const pii = cardPii(c, allow, list.staff_names || []);
              const store = list.stores.find((s) => s.id === c.loja_id);
              const blockers = c.estado === "aprovada" && !c.auto_ok
                ? autoOkBlockers(c, { now, knowledge, others: list.targets, storeNames: store ? storeKeywords(store.name, list.stores.map((s) => s.name)) : [] })
                : [];
              const targets = list.targets.filter((t) => t.id !== c.id && t.intent === c.intent).slice(0, MERGE_TARGETS);
              const reviewBy = c.revisto_em ? plusDays(c.revisto_em, 90) : null;
              return (
                <details key={c.id} className="knowledge-item">
                  <summary>
                    {c.pergunta}
                    <small>
                      <span className="tag">{isIntent(c.intent) ? INTENT_LABEL[c.intent] : c.intent}</span>
                      <span className={`tag${c.estado === "aprovada" ? " green" : c.estado === "proposta" ? " gold" : ""}`}>{c.estado === "proposta" ? "Proposta" : c.estado === "aprovada" ? "Aprovada" : "Arquivada"}</span>
                      {/* As respostas automáticas ainda não existem: a marca só prepara o cartão para elas. */}
                      {c.auto_ok && <span className="tag green">Marcada para respostas automáticas</span>}
                      {c.fontes > 0 && <span className="tag">Confirmada em {c.fontes} {c.fontes === 1 ? "cliente" : "clientes"}</span>}
                      {c.loja && <span className="tag">{c.loja}</span>}
                      {c.brand !== "ldo" && <span className="tag">{CARD_BRAND_LABEL[c.brand as keyof typeof CARD_BRAND_LABEL] || c.brand}</span>}
                      {c.valido_ate && (c.valido_ate < today
                        ? <span className="pill warn">Expirou a {day(c.valido_ate)}</span>
                        : <span className="tag">Expira a {day(c.valido_ate)}</span>)}
                      {c.estado === "aprovada" && reviewBy && (reviewBy < today
                        ? <span className="pill warn">Rever até {day(reviewBy)} (já passou)</span>
                        : <span className="tag">Rever até {day(reviewBy)}</span>)}
                      {c.por_publicar && <span className="pill warn">Por publicar</span>}
                      {pii.length > 0 && <span className="pill warn">Possíveis dados pessoais: {pii.map((p) => PII_LABEL[p]).join(", ")}</span>}
                      {warnings.map((w) => <span key={w} className="pill warn">{w}</span>)}
                    </small>
                  </summary>
                  <small className="muted">
                    {c.criada_por === "pessoa" ? "Escrita pelo Super Admin" : "Proposta pela IA"} · última confirmação {timestamp(c.ultima_vez)}
                    {c.aprovada_por && c.aprovada_em ? ` · aprovada por ${c.aprovada_por} a ${timestamp(c.aprovada_em)}` : ""}
                    {c.publicada_em ? ` · publicada a ${timestamp(c.publicada_em)}` : ""}
                  </small>
                  {c.amostras.length > 0 && (
                    <small>
                      Conversas de origem (confirme antes de aprovar; deixam de aparecer depois de aprovar ou arquivar):{" "}
                      {c.amostras.map((id, i) => <span key={id}>{i ? " · " : ""}<Link href={`/apoio?conversa=${id}`}>conversa {i + 1}</Link></span>)}
                    </small>
                  )}
                  {/* Corrigir e aprovar no mesmo formulário: "Aprovar" guarda primeiro as correções que estiverem nos campos. */}
                  <form action={saveCard}>
                    <input type="hidden" name="id" value={c.id} />
                    <Back estado={estado} search={search} />
                    <CardFields card={c} stores={list.stores} />
                    <div className="knowledge-row">
                      <button type="submit" className="secondary-button">Guardar correções</button>
                      <button type="submit" formAction={saveAndApprove} className="secondary-button"
                        title={c.estado === "aprovada" ? "Guarda as correções e regista que a resposta foi revista e continua certa." : "Guarda as correções e aprova a resposta."}>
                        {c.estado === "proposta" ? "Aprovar" : c.estado === "arquivada" ? "Aprovar de novo" : "Confirmar que continua certa"}
                      </button>
                    </div>
                  </form>
                  <div className="knowledge-row">
                    {c.estado !== "arquivada" && (
                      <form action={archiveCard}>
                        <input type="hidden" name="id" value={c.id} />
                        <Back estado={estado} search={search} />
                        <button type="submit" className="secondary-button">Arquivar</button>
                      </form>
                    )}
                    {targets.length > 0 && (
                      <form action={mergeCard} className="knowledge-row">
                        <input type="hidden" name="id" value={c.id} />
                        <Back estado={estado} search={search} />
                        <select name="into" defaultValue="" aria-label="Juntar a outra resposta do mesmo tema" required>
                          <option value="" disabled>Juntar a…</option>
                          {targets.map((t) => <option key={t.id} value={t.id}>{short(t.pergunta, 70)}</option>)}
                        </select>
                        <button type="submit" className="secondary-button">Juntar</button>
                      </form>
                    )}
                  </div>
                  {c.estado === "aprovada" && (
                    <div className="knowledge-row">
                      <form action={setCardAuto}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="auto_ok" value={c.auto_ok ? "0" : "1"} />
                        {search && <input type="hidden" name="voltar_q" value={search} />}
                        <button type="submit" className="secondary-button" disabled={!c.auto_ok && blockers.length > 0}>
                          {c.auto_ok ? "Deixar de usar em respostas automáticas" : "Permitir em respostas automáticas"}
                        </button>
                      </form>
                      <small className="muted">
                        {c.auto_ok
                          ? `Marcada a ${c.auto_ok_em ? timestamp(c.auto_ok_em) : "—"}. As respostas automáticas ainda não existem: nada é enviado aos clientes.`
                          : blockers.length ? blockers.join(" ") : "Só marca a resposta para as respostas automáticas, que ainda não existem: nada é enviado aos clientes."}
                      </small>
                    </div>
                  )}
                </details>
              );
            })}
          </div>

          <form action={saveCard} className="knowledge-new">
            <strong>Nova resposta</strong>
            <Back estado={estado} search="" />
            <CardFields stores={list.stores} />
            <div className="knowledge-row"><button type="submit" className="secondary-button">Criar proposta</button></div>
          </form>
          <p className="panel-note">
            Não treinamos nenhum modelo com as conversas: a IA lê a conversa e propõe uma pergunta genérica e a resposta da equipa, e as mensagens dos clientes nunca são copiadas. Das fontes fica a contagem: a ligação às conversas de origem apaga-se ao aprovar, arquivar ou juntar (e ao fim de 30 dias). Antes de chegar aqui, cada proposta passa por regras no servidor: é retirada se tiver nomes, emails, telefones, moradas, perfis, códigos ou números que não sejam da empresa, números de encomenda, IBAN ou NIF, ou números, ligações e compromissos que a equipa não escreveu nessa conversa nem estão na base de conhecimento. As mesmas regras valem para as suas correções antes de aprovar e de publicar. &quot;Permitir em respostas automáticas&quot; só fica disponível 7 dias depois de aprovar (ou da última correção), com a resposta revista nos últimos 90 dias e, nos horários, moradas e contactos, com a loja indicada.
          </p>
        </>
      )}
    </Panel>
  );
}
