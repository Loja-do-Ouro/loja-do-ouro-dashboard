"use client";

// Falha inesperada (por exemplo, a base de dados indisponível por momentos): mensagem simples dentro do layout do
// site, sem detalhes técnicos.
export default function CreatorsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="cr-env">
      <div className="cr-auth">
        <p className="cr-chapeu">Algo correu mal</p>
        <h1 className="cr-d-l">Não foi possível abrir esta página</h1>
        <p className="cr-lead" style={{ margin: "16px 0 24px" }}>Tente de novo dentro de momentos. Se continuar, escreva para criadores@lojadoouro.pt.</p>
        <button type="button" className="cr-bt" onClick={() => reset()}>Tentar de novo</button>
      </div>
    </div>
  );
}
