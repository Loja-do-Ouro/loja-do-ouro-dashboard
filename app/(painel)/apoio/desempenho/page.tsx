import Link from "next/link";
import { redirect } from "next/navigation";
import { canSupport, homePath } from "@/lib/permissions";
import { sessionRpc } from "@/lib/support/db";
import { CHANNEL_LABEL, type Channel } from "@/lib/support/rules";
import { durationLabel, pct, reliable, reportPeriod, reportPeriods, SURVEY_RELIABLE } from "@/lib/support/survey-rules";
import { requireViewer } from "@/lib/viewer";
import { Panel, Table } from "@/components/dashboard/ui";
import { AppShell, PageHeading } from "@/components/shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Satisfação e desempenho · Loja do Ouro" };

// asked: resolvidas com pedido; declined: podia pedir e quem resolveu não pediu (modo Perguntar).
type Figures = {
  sent: number; answered: number; ratings: number; average: number | null; satisfied: number | null; resolved: number; asked: number; declined: number;
  median_minutes: number | null;
};
type Row = Figures & { id: string; name: string; me: boolean };
type FollowUp = {
  survey_id: string; conversation_id: string; rated_at: string; score: number; comment: string | null; channel: Channel; agent_name: string | null;
  contact: string | null; status: string;
};
// enabled: o pedido de avaliação já foi ligado alguma vez (enabled_at); antes disso não há resultados por pessoa. from: o
// início que contou (enabled_at quando o período começa antes).
type Report = {
  super: boolean; enabled: boolean; enabled_at: string | null; from: string; people: Row[]; team: Figures | null; follow_up: FollowUp[] | null;
};

const HEADERS = [
  "Colaborador", "Pedidos enviados", "Avaliações", "Média (1–5)", "Satisfeitos (4–5)", "Clientes que avaliaram (%)", "Resolvidas com resposta",
  "Resolvidas sem pedido de avaliação (%)", "Tempo mediano até responder",
];
const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("pt-PT", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v));
const percent = (v: number | null) => (v === null ? "—" : `${num(v, 1)}%`);
const when = (iso: string) =>
  new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

// Uma linha da tabela: média e satisfeitos só com 10 avaliações ou mais (a BD também os omite).
function cells(name: React.ReactNode, f: Figures): React.ReactNode[] {
  const enough = reliable(f.ratings);
  return [
    name,
    num(f.sent),
    num(f.ratings),
    enough ? num(f.average, 2) : "—",
    enough && f.satisfied !== null ? `${num(f.satisfied)} (${percent(pct(f.satisfied, f.ratings))})` : "—",
    percent(pct(f.answered, f.sent)),
    num(f.resolved),
    // Das resolvidas em que se podia pedir: quantas ficaram sem pedido por escolha de quem resolveu.
    percent(pct(f.declined, f.asked + f.declined)),
    durationLabel(f.median_minutes),
  ];
}

// Satisfação e desempenho do Apoio ao Cliente (menu APOIO AO CLIENTE). Cada pessoa vê só a sua linha; o Super Admin vê a
// equipa toda, os totais e as notas de 1 e 2 para acompanhar. Sem números da IA (não servem para avaliar pessoas).
export default async function SupportPerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!canSupport(viewer)) redirect(homePath(viewer) || "/api/auth/logout?error=noaccess");
  const q = await searchParams;
  const chosen = typeof q.periodo === "string" ? q.periodo : null;
  const periods = reportPeriods();
  const load = (x: { from: string; to: string }) =>
    sessionRpc<Report>(viewer.session, "ldo_support_ratings_report", { p_from: x.from, p_to: x.to }).catch(() => null);
  let period = reportPeriod(chosen);
  let report = await load(period);
  // Sem período escolhido e com menos de 10 avaliações este mês (a sua linha; para o Super Admin, a equipa): os últimos 12
  // meses, para os resultados aparecerem.
  const own = report?.super ? report.team : report?.people.find((r) => r.me);
  if (!chosen && report?.enabled && !reliable(own?.ratings ?? 0)) {
    const longer = reportPeriod("12m");
    const r = await load(longer);
    if (r) [period, report] = [longer, r];
  }
  const rows = report?.people || [];
  const few = rows.some((r) => !reliable(r.ratings)) || (report?.team ? !reliable(report.team.ratings) : false);

  return (
    <AppShell viewer={viewer} current="apoio-desempenho" title="Satisfação e desempenho">
      <PageHeading
        eyebrow="APOIO AO CLIENTE"
        title="Satisfação e desempenho"
        text="Avaliações dos clientes depois de cada conversa resolvida, por colaborador. Só contam conversas com resposta da equipa pelo dashboard."
      >
        <form method="get" className="inline-form">
          <label>
            Período
            <select name="periodo" defaultValue={period.key}>
              {!periods.some((p) => p.key === period.key) && <option value={period.key}>{period.label}</option>}
              {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <button type="submit" className="secondary-button">Ver</button>
        </form>
      </PageHeading>

      <Panel title={report?.super ? "Equipa" : "Os seus resultados"} eyebrow={period.label.toUpperCase()} id="resultados">
        {report && !report.enabled ? (
          <>
            <p className="panel-note">A satisfação por colaborador começa quando o Super Admin ligar o pedido de avaliação. Até lá não há resultados por pessoa.</p>
            {report.super && <p className="panel-note"><Link href="/apoio/configuracao/ia#avaliacao">Configurar o pedido de avaliação</Link></p>}
          </>
        ) : report ? (
          <>
            <Table
              headers={HEADERS}
              rows={[
                ...rows.map((r) => cells(r.me && !report.super ? "Eu" : `${r.name}${r.me ? " (eu)" : ""}`, r)),
                ...(report.super && report.team && rows.length > 1 ? [cells(<strong key="t">Equipa</strong>, report.team)] : []),
              ]}
              empty="Sem pedidos de avaliação nem respostas neste período."
            />
            {report.enabled_at && report.from === report.enabled_at && (
              <p className="panel-note">Só conta desde {day(report.enabled_at)}, quando o pedido de avaliação foi ligado.</p>
            )}
            {few && <p className="panel-note">Menos de {SURVEY_RELIABLE} avaliações: resultado ainda pouco fiável (a média e os satisfeitos só aparecem a partir de {SURVEY_RELIABLE}).</p>}
            <p className="panel-note">
              Pedidos enviados e clientes que avaliaram: pelos pedidos enviados no período. Avaliações, média e satisfeitos: pelas notas
              recebidas no período. A nota conta para quem fez mais respostas pelo dashboard na conversa (empate: quem respondeu por
              último); quem só resolveu não é avaliado. Resolvidas com resposta: conversas do Messenger, do Instagram, do email e do chat
              do site resolvidas no período, atribuídas da mesma forma. Resolvidas sem pedido de avaliação: das conversas em que se
              podia pedir, as que quem resolveu decidiu não pedir (modo Perguntar ao resolver). Tempo até responder: da primeira
              mensagem do cliente ainda sem resposta até à resposta pelo dashboard (mediana; uma resposta só com a nota não conta).
            </p>
            {report.super && <p className="panel-note"><Link href="/apoio/configuracao/ia#avaliacao">Configurar o pedido de avaliação</Link></p>}
          </>
        ) : (
          <p className="error-text">Resultados indisponíveis (falta a atualização na base de dados?).</p>
        )}
      </Panel>

      {report?.super && (
        <Panel title="A acompanhar (nota 1–2)" eyebrow="SÓ O SUPER ADMIN" id="acompanhar">
          <Table
            headers={["Quando", "Cliente", "Canal", "Atendimento de", "Nota", "Comentário", "Conversa"]}
            rows={(report.follow_up || []).map((f) => [
              when(f.rated_at),
              f.contact || "—",
              CHANNEL_LABEL[f.channel] || f.channel,
              f.agent_name || "—",
              `${f.score}/5`,
              f.comment || "—",
              <Link key={f.survey_id} href={`/apoio?conversa=${encodeURIComponent(f.conversation_id)}`}
                aria-label={`Abrir a conversa com ${f.contact || "o cliente"} (${when(f.rated_at)})`}>Abrir</Link>,
            ])}
            empty="Nenhuma nota de 1 ou 2 neste período."
          />
          <p className="panel-note">Uma nota de 1 ou 2 (só a nota) devolve a conversa a Novo, sem responsável, para alguém da equipa acompanhar.</p>
        </Panel>
      )}
    </AppShell>
  );
}
