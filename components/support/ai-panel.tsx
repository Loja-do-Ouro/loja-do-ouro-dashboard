"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Assistente de IA dentro da conversa: a colaboradora pede uma proposta de resposta ou faz perguntas
// (sobre o cliente, a loja, as políticas). A IA nunca envia nada: a proposta só passa para o campo de
// resposta quando a colaboradora carrega em "Usar na resposta", e só sai com "Enviar ao cliente".

type Item = {
  id: string; kind: "draft" | "chat"; question: string | null; status: "pending" | "done" | "error"; error: string | null;
  answer: string | null; draft: string | null; checks: string[]; sources: { tool: string; label: string }[]; cost_usd?: number; created_at: string;
};
type History = { configured: boolean; enabled: boolean; daily_limit: number; used_today: number; items: Item[] };
type Event = { type: "status"; text: string } | { type: "done"; item: Item } | { type: "error"; error: string };

const QUICK = [
  ["Resumir o caso", "Resume o caso: o que o cliente quer, o que já foi feito e o que falta."],
  ["Mais curta", "Reescreve a última proposta de resposta, mais curta."],
  ["Mais formal", "Reescreve a última proposta de resposta num tom mais formal."],
  ["Em inglês", "Traduz a última proposta de resposta para inglês."],
] as const;

const usd = (v: number) => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);

export function AiPanel({
  conversationId, visible, request, replyBlocked, onUseDraft, onBack,
}: {
  conversationId: string;
  // Separador à vista (o scroll para a última resposta só funciona com o painel visível).
  visible: boolean;
  // Pedido vindo do botão "Sugerir resposta" do campo de resposta (n muda a cada clique).
  request: { n: number } | null;
  replyBlocked: string;
  onUseDraft: (text: string, how: "replace" | "append") => void;
  onBack: () => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [loadError, setLoadError] = useState("");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState<{ question: string | null; kind: "draft" | "chat"; status: string; since: number } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const lastRequest = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/support/ai?conversa=${conversationId}`, { cache: "no-store" });
      const data = (r.headers.get("content-type") || "").includes("application/json") ? await r.json() : null;
      if (!r.ok || !data) throw new Error(data?.error || `Assistente indisponível (HTTP ${r.status}).`);
      setHistory(data as History);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Assistente indisponível.");
    }
  }, [conversationId]);
  useEffect(() => {
    load();
  }, [load]);

  // Um pedido que ainda corre no servidor (por exemplo depois de mudar de conversa) aparece quando terminar.
  const hasPending = Boolean(history?.items.some((i) => i.status === "pending"));
  useEffect(() => {
    if (!hasPending || running) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [hasPending, running, load]);

  // Segundos decorridos enquanto a IA trabalha.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const lastItem = history?.items.at(-1);
  useEffect(() => {
    const box = log.current;
    if (box && visible) box.scrollTop = box.scrollHeight;
  }, [visible, history?.items.length, lastItem?.id, lastItem?.status, running?.status, error]);

  // fromInput: pergunta escrita na caixa (só essa é limpa; os botões rápidos não apagam o que se está a escrever).
  const ask = useCallback(async (kind: "draft" | "chat", text: string, fromInput = false) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError("");
    setRunning({ question: text || null, kind, status: "A enviar o pedido…", since: Date.now() });
    let finished = false;
    let started = false;
    try {
      const r = await fetch("/api/support/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, kind, question: text }),
        cache: "no-store",
      });
      const type = r.headers.get("content-type") || "";
      if (r.status === 401 || (r.redirected && new URL(r.url).pathname === "/login")) throw new Error("Sessão terminada. Atualize a página e entre novamente.");
      if (!r.ok || !type.includes("ndjson") || !r.body) {
        const data = type.includes("application/json") ? await r.json().catch(() => null) : null;
        throw new Error(data?.error || `Pedido à IA recusado (HTTP ${r.status}).`);
      }
      started = true;
      if (fromInput) setQuestion("");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (e: Event) => {
        if (e.type === "status") setRunning((s) => (s ? { ...s, status: e.text } : s));
        else if (e.type === "done") {
          finished = true;
          setHistory((h) => (h ? { ...h, items: [...h.items.filter((i) => i.id !== e.item.id), e.item] } : h));
        } else {
          // O erro fica no próprio pedido (recarregado no fim); não se repete num aviso à parte.
          finished = true;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (line) handle(JSON.parse(line) as Event);
        }
      }
      if (!finished) setError("A ligação foi interrompida. Se a IA terminar, a resposta aparece aqui dentro de momentos.");
    } catch (e) {
      setError(
        started
          ? "A ligação foi interrompida. Se a IA terminar, a resposta aparece aqui dentro de momentos."
          : e instanceof TypeError
            ? "Sem ligação ao servidor. Verifique a rede e tente outra vez."
            : e instanceof Error ? e.message : "A IA não respondeu.",
      );
    } finally {
      runningRef.current = false;
      setRunning(null);
      load();
    }
  }, [conversationId, load]);

  // "Sugerir resposta" no campo de resposta.
  useEffect(() => {
    if (!request || lastRequest.current === request.n) return;
    lastRequest.current = request.n;
    ask("draft", "");
  }, [request, ask]);

  async function copy(item: Item) {
    try {
      await navigator.clipboard.writeText(item.draft || "");
      setCopied(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2000);
    } catch {
      setError("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  }

  const unavailable = !history ? "" : !history.configured
    ? "Assistente de IA por configurar: o Super Admin tem de criar a variável ANTHROPIC_API_KEY na Vercel (ver Configuração do apoio)."
    : !history.enabled ? "O assistente de IA está desligado na configuração do apoio." : "";
  const limitReached = Boolean(history && history.used_today >= history.daily_limit);
  const busy = Boolean(running) || !history || Boolean(unavailable) || limitReached;
  const send = () => {
    const q = question.trim();
    if (q && !busy) ask("chat", q, true);
  };
  void tick;

  return (
    <div className="ai-panel">
      <button type="button" className="support-back" onClick={onBack}>← Conversa</button>
      <div className="ai-log" ref={log}>
        {loadError && (
          <p className="support-error" role="alert">
            {loadError} <button type="button" className="secondary-button" onClick={() => { setLoadError(""); load(); }}>Tentar de novo</button>
          </p>
        )}
        {!history && !loadError && <p className="support-empty">A carregar…</p>}
        {history && !history.items.length && !running && (
          <div className="ai-intro">
            <strong>Assistente de IA</strong>
            <p>Peça uma proposta de resposta ou pergunte sobre o cliente, encomendas, produtos e políticas da loja. A IA consulta a conversa, a base de conhecimento, a loja online e respostas anteriores da equipa.</p>
          </div>
        )}
        {history?.items.map((i) => (
          <div key={i.id} className="ai-exchange">
            <p className="ai-q">{i.question || (i.kind === "draft" ? "Sugerir resposta" : "")}</p>
            <div className={`ai-a ${i.status}`}>
              {i.status === "pending" && <p className="muted">A IA ainda está a trabalhar neste pedido…</p>}
              {i.status === "error" && <p className="error-text">{i.error || "A IA não respondeu."}</p>}
              {i.answer && <p className="ai-text">{i.answer}</p>}
              {i.draft && (
                <div className="ai-draft">
                  <span className="eyebrow">Proposta de resposta ao cliente</span>
                  <p className="ai-text">{i.draft}</p>
                  <div className="ai-draft-actions">
                    <button type="button" onClick={() => onUseDraft(i.draft!, "replace")} disabled={Boolean(replyBlocked)} title={replyBlocked || "Coloca a proposta no campo de resposta (não envia)."}>Usar na resposta</button>
                    <button type="button" className="secondary-button" onClick={() => onUseDraft(i.draft!, "append")} disabled={Boolean(replyBlocked)} title={replyBlocked || "Acrescenta ao texto que já está no campo de resposta."}>Acrescentar</button>
                    <button type="button" className="secondary-button" onClick={() => copy(i)}>{copied === i.id ? "Copiado" : "Copiar"}</button>
                  </div>
                </div>
              )}
              {i.checks.length > 0 && (
                <ul className="ai-checks" aria-label="Confirmar antes de enviar">
                  {i.checks.map((c, n) => <li key={n}>{c}</li>)}
                </ul>
              )}
              {(i.sources.length > 0 || i.cost_usd !== undefined) && (
                <small className="ai-meta">
                  {i.sources.length > 0 && <>Consultou: {i.sources.map((s) => s.label).join(" · ")}</>}
                  {i.cost_usd !== undefined && Number(i.cost_usd) > 0 && <> · custo estimado {usd(Number(i.cost_usd))}</>}
                </small>
              )}
            </div>
          </div>
        ))}
        {running && (
          <div className="ai-exchange">
            <p className="ai-q">{running.question || (running.kind === "draft" ? "Sugerir resposta" : "")}</p>
            <div className="ai-a pending">
              <p className="ai-working"><span className="ai-dot" aria-hidden="true" /><span role="status">{running.status}</span> <small aria-hidden="true">{Math.round((Date.now() - running.since) / 1000)} s</small></p>
            </div>
          </div>
        )}
        {error && <p className="support-error" role="alert">{error}</p>}
      </div>
      <div className="ai-input">
        {unavailable ? (
          <p className="composer-blocked">{unavailable}</p>
        ) : (
          <>
            <div className="ai-quick">
              <button type="button" onClick={() => ask("draft", "")} disabled={busy}>✨ Sugerir resposta</button>
              {QUICK.map(([label, q]) => (
                <button key={label} type="button" className="secondary-button" onClick={() => ask("chat", q)} disabled={busy}>{label}</button>
              ))}
            </div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }}
              rows={3}
              maxLength={4000}
              placeholder="Pergunte à IA (ex.: «que anéis em ouro branco temos até 300 €?», «responde a dizer que já enviámos»)…"
              aria-label="Pergunta para a IA"
            />
            <div className="ai-send">
              <small>
                {history ? `${history.used_today}/${history.daily_limit} pedidos hoje` : ""}
                {limitReached ? " · limite diário atingido" : ""}
              </small>
              <button type="button" onClick={send} disabled={busy || !question.trim()}>{running ? "A pensar…" : "Perguntar"}</button>
            </div>
          </>
        )}
        <small className="ai-disclaimer">A IA pode errar: confirme antes de enviar. Nada é enviado ao cliente sem carregar em “Enviar ao cliente”. A conversa e os dados consultados são processados pela Anthropic (Claude).</small>
      </div>
    </div>
  );
}
