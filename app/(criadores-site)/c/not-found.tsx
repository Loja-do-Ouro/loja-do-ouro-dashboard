import Link from "next/link";
import { siteBase } from "@/lib/criadores/site";

export default async function CreatorsNotFound() {
  const base = await siteBase();
  return (
    <div className="cr-env">
      <div className="cr-auth">
        <p className="cr-chapeu">Página não encontrada</p>
        <h1 className="cr-d-l">Este endereço não existe</h1>
        <p className="cr-lead" style={{ margin: "16px 0 24px" }}>A ligação pode estar incompleta ou a página pode ter mudado de sítio.</p>
        <div className="cr-acoes">
          <Link className="cr-bt" href={base || "/"}>Ir para o início</Link>
          <Link className="cr-lig" href={`${base}/conta/entrar`}>Entrar na conta</Link>
        </div>
      </div>
    </div>
  );
}
