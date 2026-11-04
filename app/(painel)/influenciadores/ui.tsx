import "server-only";
import { cache } from "react";
import { AppShell } from "@/components/shell";
import { crOverview, type CrOverview } from "@/lib/criadores/db";
import {
  CREATOR_STATUS_LABEL, CREATOR_STATUS_TONE, PRIVACY_STATUS_LABEL, VERIFICATION_LABEL, type CreatorStatus, type Tone,
} from "@/lib/criadores-rules";
import type { Viewer } from "@/lib/viewer";

// Peças comuns às páginas de Influenciadores (backoffice). Seguem o estilo do resto do dashboard (AppShell, Panel,
// tabelas densas, pílulas), não o do site dos criadores.

// Contadores da visão geral, uma vez por pedido (o menu e a própria visão geral usam os mesmos). Uma falha da BD não
// impede a página de abrir: o menu fica sem contadores e a página mostra o seu próprio aviso.
export const loadOverview = cache(async (session: string): Promise<CrOverview | null> => crOverview(session).catch(() => null));

export async function CreatorsShell({
  viewer, current, title, children,
}: { viewer: Viewer; current: string; title: string; children: React.ReactNode }) {
  const o = await loadOverview(viewer.session);
  const badges: Record<string, number> = o
    ? { "influenciadores-criadores": o.profiles_pending, "influenciadores-privacidade": o.privacy_due_soon }
    : {};
  return (
    <AppShell viewer={viewer} current={current} title={title} badges={badges}>
      {children}
    </AppShell>
  );
}

// Só há duas cores de pílula no dashboard: verde (ok) e âmbar (atenção); o resto fica na cor neutra.
export const toneClass = (tone: Tone) => (tone === "ok" ? "pill ok" : tone === "warn" || tone === "bad" ? "pill warn" : "pill");

export function StatusPill({ status }: { status: CreatorStatus }) {
  return <span className={toneClass(CREATOR_STATUS_TONE[status] ?? "neutral")}>{CREATOR_STATUS_LABEL[status] ?? status}</span>;
}

export function PrivacyPill({ status, overdue }: { status: keyof typeof PRIVACY_STATUS_LABEL; overdue?: boolean }) {
  if (status === "open") return <span className="pill warn">{overdue ? "Em atraso" : PRIVACY_STATUS_LABEL.open}</span>;
  return <span className={status === "done" ? "pill ok" : "pill"}>{PRIVACY_STATUS_LABEL[status] ?? status}</span>;
}

// Selos das redes (§5.11): «Verificado» e «Dados públicos» com cor; «Não verificado» neutro.
export function VerificationTag({ v }: { v: keyof typeof VERIFICATION_LABEL }) {
  const cls = v === "verified" ? "tag green" : v === "public" ? "tag gold" : "tag";
  return <span className={cls}>{VERIFICATION_LABEL[v] ?? v}</span>;
}

const NUMBER = new Intl.NumberFormat("pt-PT");
export const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? NUMBER.format(n) : "—");
export const pct = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${String(Math.round(n * 10) / 10).replace(".", ",")}%` : "—";
