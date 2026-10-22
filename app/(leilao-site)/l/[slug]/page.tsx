import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { lisbonDateTime } from "@/lib/leilao-rules";
import { auctionSession, pubEvent, siteBase } from "@/lib/leilao/site";
import { LotCard } from "../cards";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = await pubEvent(slug, "").catch(() => null);
  return { title: data?.event.title || "Leilão" };
}

export default async function AuctionEventPage({ params }: Props) {
  const { slug } = await params;
  const [base, session] = await Promise.all([siteBase(), auctionSession()]);
  const data = await pubEvent(slug, session).catch(() => null);
  if (!data) notFound();
  const { event, lots, settings } = data;
  const now = Date.now();
  const opens = new Date(event.opens_at).getTime();

  return (
    <>
      <section className="lx-hero" style={{ paddingBottom: 48 }}>
        <div className="lx-wrap">
          <div className="lx-crumbs" style={{ paddingTop: 0, color: "rgba(255,255,255,.7)" }}>
            <Link href={base || "/"}>Leilões</Link> / {event.title}
          </div>
          <span className="lx-eyebrow">{now < opens ? `Abre a ${lisbonDateTime(event.opens_at)}` : "Leilão online"}</span>
          <h1>{event.title}</h1>
          {event.intro && <p style={{ whiteSpace: "pre-line" }}>{event.intro}</p>}
          <p className="lx-small" style={{ marginTop: 18 }}>
            {lots.length} {lots.length === 1 ? "lote" : "lotes"} · o primeiro fecha a {lisbonDateTime(event.first_close_at)}
            {event.stagger_seconds ? ` e os seguintes de ${Math.round(event.stagger_seconds / 60) || 1} em ${Math.round(event.stagger_seconds / 60) || 1} min` : ""} (hora de Lisboa).
          </p>
        </div>
      </section>
      <section className="lx-section">
        <div className="lx-wrap">
          {lots.length === 0 ? (
            <div className="lx-card lx-empty"><p>Os lotes deste leilão ainda não estão disponíveis.</p></div>
          ) : (
            <div className="lx-lots">
              {lots.map((l) => <LotCard key={l.id} lot={l} base={base} now={now} endingMinutes={settings.ending_soon_minutes} />)}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
