"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="loading-screen">
      <span className="wordmark">LOJA DO OURO</span>
      <h1>Não foi possível carregar esta vista</h1>
      <p>Os últimos dados guardados foram preservados.</p>
      <button onClick={reset}>Tentar novamente</button>
    </main>
  );
}
