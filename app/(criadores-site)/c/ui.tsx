import type { ReactNode } from "react";
import { CREATOR_STATUS_SITE, VERIFICATION_LABEL, ibanTail, type CreatorStatus } from "@/lib/criadores-rules";
import type { CrVerification } from "@/lib/criadores/db";

// Peças comuns das páginas do site (servidor): avisos, etiquetas de estado e o cabeçalho de página. As etiquetas
// dizem sempre o estado por extenso (a cor nunca é o único sinal); «declarado» leva traço tracejado (§10.2).

export function Aviso({ tone = "info", title, children }: { tone?: "info" | "ok" | "erro"; title?: string; children?: ReactNode }) {
  const cls = tone === "ok" ? "cr-aviso cr-aviso-ok" : tone === "erro" ? "cr-aviso cr-aviso-erro" : "cr-aviso";
  return (
    <div className={cls} role={tone === "erro" ? "alert" : "status"}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

const STATUS_CLASS: Record<CreatorStatus, string> = {
  draft: "cr-anl", pending_review: "cr-anl", approved: "cr-ok", rejected: "cr-nao", suspended: "cr-nao", restricted: "cr-tinta", deleted: "cr-anl",
};

export function StatusTag({ status }: { status: CreatorStatus }) {
  return <span className={`cr-etq ${STATUS_CLASS[status] || "cr-anl"}`}>{CREATOR_STATUS_SITE[status] || status}</span>;
}

// Selo de uma rede (§5.11): «Não verificado» tracejado; «Verificado» e «Dados públicos» contínuos.
export function VerificationTag({ v }: { v: CrVerification }) {
  if (v === "declared") return <span className="cr-etq cr-etq-dec">{VERIFICATION_LABEL.declared}</span>;
  return <span className={`cr-etq ${v === "verified" ? "cr-ok" : v === "revoked" ? "cr-nao" : "cr-tinta"}`}>{VERIFICATION_LABEL[v]}</span>;
}

// Final do IBAN: «•••• 0154» à vista; o leitor de ecrã lê «terminado em 0154» (não «marca marca marca marca»).
export function IbanTail({ last4 }: { last4: string | null | undefined }) {
  const v = String(last4 || "").trim();
  return (
    <>
      <span aria-hidden="true">{ibanTail(v)}</span>
      <span className="cr-sr">terminado em {v}</span>
    </>
  );
}

export function PageHead({ chapeu, title, lead, children }: { chapeu?: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <header className="cr-abre">
      {chapeu && <p className="cr-chapeu">{chapeu}</p>}
      <h1 className="cr-d-l">{title}</h1>
      {lead && <p className="cr-lead">{lead}</p>}
      {children}
    </header>
  );
}

// Número com espaço nos milhares («18 412»), sempre em Archivo tabular.
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return new Intl.NumberFormat("pt-PT", { useGrouping: "always" } as Intl.NumberFormatOptions).format(Number(n)).replace(/\./g, " ");
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  return `${new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 }).format(Number(n))} %`;
}

// «Quarta-feira, 4 de novembro de 2026» (hora de Lisboa).
export function longDate(d: Date = new Date()): string {
  const s = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// «Bom dia» / «Boa tarde» / «Boa noite» pela hora de Lisboa.
export function greeting(d: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", hourCycle: "h23" }).format(d));
  return h >= 6 && h < 13 ? "Bom dia" : h >= 13 && h < 20 ? "Boa tarde" : "Boa noite";
}
