import Link from "next/link";
import { siteBase } from "@/lib/leilao/site";

export default async function AuctionNotFound() {
  const base = await siteBase();
  return (
    <div className="lx-wrap lx-auth">
      <div className="lx-card lx-card-pad lx-empty">
        <span className="lx-eyebrow">Página não encontrada</span>
        <h1>Este endereço não existe</h1>
        <p>O leilão ou o lote pode ter terminado há mais tempo ou ter sido retirado.</p>
        <Link className="lx-btn" href={base || "/"}>Ver leilões</Link>
      </div>
    </div>
  );
}
