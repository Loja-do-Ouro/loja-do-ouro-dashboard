import { redirect } from "next/navigation";
import { homePath } from "@/lib/permissions";
import { encryptionProblem } from "@/lib/support/crypto";
import { sessionRpc } from "@/lib/support/db";
import { storeSheetConfigured, storeSheetRedirectUri, storeSheetUrl } from "@/lib/store-sheet";
import { requireViewer } from "@/lib/viewer";
import { timestamp } from "@/components/dashboard/format";
import { Panel } from "@/components/dashboard/ui";
import { AppShell, Flash, PageHeading } from "@/components/shell";
import { disconnect, importNow, setSpreadsheet } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const metadata = { title: "Folha das lojas · Loja do Ouro" };

type Run = {
  id: number; trigger: string; started_at: string; finished_at: string | null; status: string; days_changed: number; rows_inserted: number;
  rows_removed: number; skipped: { store_code: string; day: string; reason: string }[]; issues: { tab: string; row: number | null; message: string }[];
  detail: string | null;
};
type Status = {
  connection: { spreadsheet_id: string; email: string | null; status: "not_connected" | "active" | "reconnect"; status_detail: string | null; connected_at: string | null; connected_by: string | null; running: boolean };
  runs: Run[];
  days: { count: number; from: string | null; to: string | null };
};

// Resultado da ligação à Google (código no URL, vindo de /api/admin/folha-lojas/*).
const LINK_FLASH: Record<string, [boolean, string]> = {
  ligado: [true, "Folha ligada. Carregue em Importar agora para a primeira importação, ou espere pela da madrugada."],
  "sem-acesso": [false, "Só o Super Admin pode ligar a folha das lojas."],
  "por-configurar": [false, "Faltam GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ou SUPPORT_ENCRYPTION_KEY na Vercel."],
  endereco: [false, "A folha liga-se no endereço de produção do dashboard (o registado na Google). Carregue em Ligar folha aqui."],
  recusado: [false, "A autorização foi cancelada na Google. Nada foi alterado."],
  invalido: [false, "O pedido de ligação expirou ou não é válido. Carregue de novo em Ligar folha."],
  "sem-folha": [false, "A conta escolhida não consegue abrir a folha. Use uma conta com quem a folha está partilhada."],
  "sem-permissao": [false, "Falta aceitar a leitura das folhas de cálculo no ecrã da Google. Volte a ligar e deixe essa opção marcada."],
  "conta-apoio": [false, "Essa é a conta da caixa do apoio, ligada ao Gmail do dashboard. Use a sua conta (com acesso à folha)."],
  erro: [false, "A Google não concluiu a ligação. Tente de novo; se repetir, veja os registos da Vercel."],
};
const TRIGGER: Record<string, string> = { noite: "Madrugada", antes_alerta: "Antes do alerta das 22h", manual: "Importar agora", cron: "Manual (segredo)" };
const RUN_STATUS: Record<string, [string, string]> = { completed: ["Concluída", "ok"], partial: ["Com avisos", "warn"], failed: ["Falhou", "warn"], running: ["A correr", ""] };
const SKIP_REASON: Record<string, string> = {
  form: "dia com registos do formulário (prevalecem)", edited: "registos corrigidos ou apagados por um Gestor (não tocados)", invalid: "loja desconhecida ou data futura",
  correction_lost: "voltou a vir da folha depois de o formulário ser retirado; uma correção de um Gestor feita antes ficou só no histórico",
};

export default async function StoreSheetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.isSuper) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const status = await sessionRpc<Status>(viewer.session, "ldo_store_sheet_status").catch(() => null);
  const link = typeof q.ligacao === "string" ? LINK_FLASH[q.ligacao] : undefined;
  const ok = link ? (link[0] ? link[1] : undefined) : typeof q.ok === "string" ? q.ok.slice(0, 300) : undefined;
  const error = link ? (link[0] ? undefined : link[1]) : typeof q.erro === "string" ? q.erro.slice(0, 600) : undefined;
  const here = process.env.VERCEL_ENV === "production" || !process.env.VERCEL_ENV;
  const c = status?.connection;
  const last = status?.runs[0];

  return (
    <AppShell viewer={viewer} current="folha-lojas" title="Folha das lojas">
      <PageHeading eyebrow="ADMINISTRAÇÃO" title="Folha das lojas" text="Vendas e atendimentos das lojas físicas lidos da folha Google “Análise de Vendas”, todas as madrugadas e antes do alerta das 22h." />
      <Flash ok={ok} error={error} />
      {!status ? (
        <div className="notice error-notice">Estado indisponível (falta a atualização da base de dados?).</div>
      ) : (
        <>
          <div className="two-col">
            <Panel title="Ligação" eyebrow="GOOGLE SHEETS (SÓ LEITURA)">
              <dl className="config-list">
                <dt>Folha</dt>
                <dd><a href={storeSheetUrl(c!.spreadsheet_id)} target="_blank" rel="noopener noreferrer">Análise de Vendas</a> <small className="muted block"><code>{c!.spreadsheet_id}</code></small></dd>
                <dt>Ligação</dt>
                <dd>
                  {c!.status === "active" ? <span className="pill ok">Ligada</span> : c!.status === "reconnect" ? <span className="pill warn">Voltar a ligar</span> : <span className="pill">Por ligar</span>}
                  {c!.email && <small className="muted block">Conta {c!.email}{c!.connected_by ? ` · por ${c!.connected_by}` : ""}{c!.connected_at ? `, ${timestamp(c!.connected_at)}` : ""}</small>}
                  {c!.status_detail && <small className="block error-text">{c!.status_detail}</small>}
                </dd>
                <dt>Cliente OAuth</dt><dd>{storeSheetConfigured() ? <span className="pill ok">Configurado</span> : <span className="pill warn">Em falta</span>} <small className="muted">GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (os do Gmail)</small></dd>
                <dt>Cifra das chaves</dt><dd>{encryptionProblem() ? <span className="pill warn">Em falta</span> : <span className="pill ok">Configurada</span>}</dd>
                <dt>Redirect URI</dt><dd><code>{storeSheetRedirectUri()}</code></dd>
                <dt>Dias importados</dt><dd>{status.days.count ? `${status.days.count} (de ${status.days.from} a ${status.days.to})` : "nenhum ainda"}</dd>
              </dl>
              {here ? (
                <form method="post" action="/api/admin/folha-lojas/connect" className="inline-form">
                  <button type="submit" className="secondary-button" disabled={!storeSheetConfigured() || Boolean(encryptionProblem())}>{c!.status === "not_connected" ? "Ligar folha" : "Voltar a ligar folha"}</button>
                </form>
              ) : (
                <p className="panel-note">A folha liga-se no dashboard de produção, o endereço registado na Google.</p>
              )}
              {c!.status !== "not_connected" && (
                <form action={disconnect} className="knowledge-row">
                  <label className="checkbox-label"><input type="checkbox" name="confirm" required /> Confirmo</label>
                  <button type="submit" className="secondary-button">Desligar a folha</button>
                </form>
              )}
              <form action={setSpreadsheet} className="inline-form">
                <label>
                  Outra folha (link ou identificador)
                  <input name="spreadsheet" defaultValue={c!.spreadsheet_id} maxLength={300} />
                </label>
                <button type="submit" className="secondary-button">Guardar</button>
              </form>
            </Panel>

            <Panel title="Importação" eyebrow="MADRUGADA E ANTES DO ALERTA">
              <p>
                Última: {last ? <>{timestamp(last.started_at)} · {TRIGGER[last.trigger] || last.trigger} · <span className={`pill ${RUN_STATUS[last.status]?.[1] || ""}`}>{RUN_STATUS[last.status]?.[0] || last.status}</span></> : "nenhuma ainda"}
              </p>
              <form action={importNow}>
                <button type="submit" className="secondary-button" disabled={c!.status !== "active" || c!.running}>{c!.running ? "A importar…" : "Importar agora"}</button>
              </form>
              <p className="panel-note">
                Todas as madrugadas (à 01h de Lisboa; na noite da mudança para a hora de verão, às 02h) e antes do alerta das 22h, o dashboard lê os separadores das lojas e compara cada loja/dia com a última versão importada: só os dias que mudaram são substituídos, e os dias que saíram da folha são retirados. Um dia em que a loja registou no formulário do dashboard fica com o formulário. Um dia em que um Gestor corrigiu ou apagou registos da folha não é tocado. Se o separador de uma loja desaparecer ou mudar de colunas, nada dessa loja é alterado; se deixar de ter pelo menos metade dos dias já importados, nada é apagado nem alterado até ao último dia já importado (só entram os dias seguintes). Em ambos os casos fica um aviso abaixo. Mudar de folha obriga a ligar de novo.
              </p>
            </Panel>
          </div>

          <Panel title="Últimas importações" eyebrow="HISTÓRICO">
            <div className="table-scroll">
              <table className="left-table">
                <thead><tr><th>Quando</th><th>Origem</th><th>Estado</th><th>Dias atualizados</th><th>Registos gravados</th><th>Substituídos ou retirados</th><th>Detalhe</th></tr></thead>
                <tbody>
                  {status.runs.map((r) => (
                    <tr key={r.id}>
                      <td>{timestamp(r.started_at)}</td>
                      <td>{TRIGGER[r.trigger] || r.trigger}</td>
                      <td><span className={`pill ${RUN_STATUS[r.status]?.[1] || ""}`}>{RUN_STATUS[r.status]?.[0] || r.status}</span></td>
                      <td>{r.days_changed}</td>
                      <td>{r.rows_inserted}</td>
                      <td>{r.rows_removed}</td>
                      <td>
                        {r.detail && <small className="muted block">{r.detail}</small>}
                        {r.skipped.length > 0 && (
                          <details>
                            <summary>{r.skipped.length} dia(s) mantido(s) ou com nota</summary>
                            <ul>{r.skipped.slice(0, 50).map((s, i) => <li key={i}>{s.store_code} · {s.day}: {SKIP_REASON[s.reason] || s.reason}</li>)}</ul>
                          </details>
                        )}
                        {r.issues.filter((s) => s.row === null).slice(0, 20).map((s, i) => <small key={i} className="block error-text">{s.tab}: {s.message}</small>)}
                        {r.issues.some((s) => s.row !== null) && (
                          <details>
                            <summary>{r.issues.filter((s) => s.row !== null).length} aviso(s) de linhas da folha</summary>
                            <ul>{r.issues.filter((s) => s.row !== null).slice(0, 80).map((s, i) => <li key={i}>{s.tab}, linha {s.row}: {s.message}</li>)}</ul>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!status.runs.length && <tr><td colSpan={7} className="muted">Ainda não houve importações.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
